import Settings from '@overleaf/settings'
import CompileManager from '../Compile/CompileManager.mjs'
import ClsiManager from '../Compile/ClsiManager.mjs'
import { getOutputFileURL } from '../Compile/ClsiURLHelpers.mjs'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import logger from '@overleaf/logger'
import Path from 'node:path'
import {
  fetchJsonWithResponse,
  fetchStreamWithResponse,
  RequestFailedError,
} from '@overleaf/fetch-utils'
import { pipeline } from 'node:stream/promises'
import OError from '@overleaf/o-error'
import FormData from 'form-data'
import { FileTooLargeError, DocumentConversionError } from '../Errors/Errors.js'
import archiver from 'archiver'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function extractClsiUserFacingError(error) {
  try {
    const parsed = JSON.parse(error.body)
    if (typeof parsed?.error === 'string') {
      return parsed.error
    }
  } catch {
    // body wasn't JSON
  }
  return undefined
}

async function convertDocumentToLaTeXZipArchive(path, userId, conversionType) {
  if (Settings.useLocalPandocConversions) {
    return await convertDocumentLocally(path, conversionType)
  }

  const clsiUrl = new URL(Settings.apis.clsi.url)
  const limits = await CompileManager.promises._getUserCompileLimits(userId)

  // Uncomment this and remove the line below when the deploy is done.
  // clsiUrl.pathname = '/convert/document-to-latex'
  clsiUrl.pathname =
    conversionType === 'docx'
      ? '/convert/docx-to-latex'
      : '/convert/document-to-latex'
  clsiUrl.searchParams.set('compileBackendClass', limits.compileBackendClass)
  clsiUrl.searchParams.set('compileGroup', limits.compileGroup)
  clsiUrl.searchParams.set('type', conversionType)

  const formData = new FormData()
  formData.append('qqfile', fs.createReadStream(path))

  logger.debug(
    { clsiUrl: clsiUrl.toString(), conversionType },
    'sending document to CLSI for conversion'
  )

  const outputFileName = crypto.randomUUID() + '_document-conversion' + '.zip'
  const outputPath = Path.join(Settings.path.dumpFolder, outputFileName)
  let outputStream
  const abortController = new AbortController()

  try {
    const { stream, response } = await fetchStreamWithResponse(clsiUrl, {
      method: 'POST',
      body: formData,
      signal: abortController.signal,
    })

    const contentLength = parseInt(response.headers.get('Content-Length'), 10)
    if (contentLength > Settings.maxUploadSize) {
      abortController.abort()
      stream.destroy()
      throw new FileTooLargeError({
        message: 'converted document archive too large',
        info: {
          size: contentLength,
        },
      })
    }

    outputStream = fs.createWriteStream(outputPath)

    await pipeline(stream, outputStream)
    logger.debug({ outputPath }, 'received converted file from CLSI')
  } catch (error) {
    logger.debug({ err: error }, 'error during document conversion')
    outputStream?.destroy()
    // Make sure to clean up the output file if conversion didn't work
    await fsPromises.unlink(outputPath).catch(() => {})

    if (error instanceof FileTooLargeError) {
      throw error
    }

    if (error?.response?.status === 422) {
      throw new DocumentConversionError(
        extractClsiUserFacingError(error)
      ).withCause(error)
    }

    throw new OError('document conversion failed').withCause(error)
  }

  return outputPath
}

async function convertDocumentLocally(inputPath, conversionType) {
  const workingDirectory = await fsPromises.mkdtemp(
    Path.join(os.tmpdir(), 'overleaf-document-import-')
  )
  const outputPath = Path.join(
    Settings.path.dumpFolder,
    `${crypto.randomUUID()}_document-conversion.zip`
  )
  try {
    const outputTex = Path.join(workingDirectory, 'main.tex')
    const from = conversionType === 'docx' ? 'docx' : 'markdown'
    await execFileAsync(
      'pandoc',
      [
        inputPath,
        `--from=${from}`,
        '--to=latex',
        '--standalone',
        '--extract-media=.',
        '--wrap=preserve',
        `--output=${outputTex}`,
      ],
      {
        cwd: workingDirectory,
        timeout: 2 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      }
    )
    await createZipArchive(workingDirectory, outputPath)
    return outputPath
  } catch (error) {
    await fsPromises.unlink(outputPath).catch(() => {})
    const details =
      error.code === 'ENOENT'
        ? 'Pandoc is not installed in the ShareLaTeX image'
        : error.stderr?.trim() || error.message
    throw new DocumentConversionError(details).withCause(error)
  } finally {
    await fsPromises.rm(workingDirectory, {
      recursive: true,
      force: true,
    })
  }
}

async function createZipArchive(sourceDirectory, outputPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(sourceDirectory, false)
    archive.finalize()
  })
}

/**
 * @param {string} projectId
 * @param {string} userId
 * @param {string} type
 * @param {Object} options
 * @param {boolean} options.compileFromHistory
 * @param {string} options.rootResourcePath
 * @return {Promise<{conversionId: string, buildId: string, clsiServerId: string|null, file: string}>}
 */
async function convertProjectToDocument(projectId, userId, type, options) {
  const limits = await CompileManager.promises._getUserCompileLimits(userId)
  try {
    return await convertProjectToDocumentOnce(
      projectId,
      userId,
      type,
      limits,
      options
    )
  } catch (err) {
    if (
      options.compileFromHistory &&
      err instanceof RequestFailedError &&
      err.response.status === 409
    ) {
      let baseHistoryVersion = -1
      try {
        ;({ baseHistoryVersion } = JSON.parse(err.body))
      } catch {}
      return await convertProjectToDocumentOnce(
        projectId,
        userId,
        type,
        limits,
        { ...options, baseHistoryVersion }
      )
    }
    throw err
  }
}

async function convertProjectToDocumentOnce(
  projectId,
  userId,
  type,
  limits,
  options
) {
  const clsiRequest = await ClsiManager.promises.buildDocumentConversionRequest(
    projectId,
    userId,
    options
  )

  const clsiUrl = new URL(Settings.apis.clsi.url)
  clsiUrl.pathname = `/project/${projectId}/user/${userId}/download/project-to-document`
  clsiUrl.searchParams.set('type', type)
  clsiUrl.searchParams.set('responseFormat', 'json')
  clsiUrl.searchParams.set('compileBackendClass', limits.compileBackendClass)
  clsiUrl.searchParams.set('compileGroup', limits.compileGroup)

  logger.debug(
    { clsiUrl: clsiUrl.toString(), projectId, userId, type },
    'sending project to CLSI for document conversion'
  )

  let json, response
  try {
    ;({ json, response } = await fetchJsonWithResponse(clsiUrl, {
      method: 'POST',
      json: clsiRequest,
    }))
  } catch (error) {
    if (error?.response?.status === 422) {
      throw new DocumentConversionError(
        extractClsiUserFacingError(error)
      ).withCause(error)
    }
    throw error
  }
  const { conversionId, buildId, file } = json
  const clsiServerId = ClsiManager.CLSI_COOKIES_ENABLED
    ? ClsiManager.getClsiServerIdFromResponse(response)
    : undefined

  return { conversionId, buildId, clsiServerId, file }
}

async function streamConvertedProjectDocument({
  conversionId,
  buildId,
  clsiServerId,
  file,
}) {
  const downloadUrl = getOutputFileURL(
    conversionId,
    null,
    buildId,
    file,
    clsiServerId ?? undefined
  )

  const { stream, response } = await fetchStreamWithResponse(downloadUrl)
  const contentLength = parseInt(response.headers.get('Content-Length'), 10)

  return { stream, contentLength }
}

export default {
  promises: {
    convertDocumentToLaTeXZipArchive,
    convertProjectToDocument,
    streamConvertedProjectDocument,
  },
}
