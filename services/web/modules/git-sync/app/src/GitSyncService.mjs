import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import UpdateMerger from '../../../../app/src/Features/ThirdPartyDataStore/UpdateMerger.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'

const execFileAsync = promisify(execFile)
const MAX_FILES = 2000
const MAX_FILE_SIZE = 50 * 1024 * 1024

async function git(args, cwd, extraEnv = {}) {
  return await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      ...extraEnv,
    },
  })
}

function validateCloneUrl(cloneUrl) {
  const url = new URL(cloneUrl)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
    throw new Error('Only HTTPS GitHub repositories are supported')
  }
  return url.toString()
}

function githubAuthEnv(token) {
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(
      `x-access-token:${token}`
    ).toString('base64')}`,
  }
}

async function cloneRepository(link, token, root) {
  const repositoryDir = path.join(root, 'repository')
  await git(
    [
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--branch',
      link.branch,
      validateCloneUrl(link.cloneUrl),
      repositoryDir,
    ],
    root,
    githubAuthEnv(token)
  )
  return repositoryDir
}

async function listRepositoryFiles(root) {
  const result = []
  async function walk(directory, relative = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!relative && entry.name === '.git') continue
      const nextRelative = relative
        ? path.posix.join(relative, entry.name)
        : entry.name
      const absolute = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic links are not supported: ${nextRelative}`)
      }
      if (entry.isDirectory()) {
        await walk(absolute, nextRelative)
      } else if (entry.isFile()) {
        const stat = await fs.stat(absolute)
        if (stat.size > MAX_FILE_SIZE) {
          throw new Error(`File exceeds 50 MB: ${nextRelative}`)
        }
        result.push({ path: nextRelative, absolute })
        if (result.length > MAX_FILES) {
          throw new Error(`Repository exceeds the ${MAX_FILES} file limit`)
        }
      }
    }
  }
  await walk(root)
  return result
}

async function getCurrentProjectPaths(projectId) {
  const { docs, files } =
    await ProjectEntityHandler.promises.getAllEntities(projectId)
  return new Set([
    ...docs.map(item => item.path.replace(/^\//, '')),
    ...files.map(item => item.path.replace(/^\//, '')),
  ])
}

async function importDirectory(projectId, userId, repositoryDir) {
  const repositoryFiles = await listRepositoryFiles(repositoryDir)
  const incomingPaths = new Set(repositoryFiles.map(file => file.path))
  for (const currentPath of await getCurrentProjectPaths(projectId)) {
    if (!incomingPaths.has(currentPath)) {
      await UpdateMerger.promises.deleteUpdate(
        userId,
        projectId,
        currentPath,
        'github'
      )
    }
  }
  for (const file of repositoryFiles) {
    await UpdateMerger.promises.mergeUpdate(
      userId,
      projectId,
      file.path,
      createReadStream(file.absolute),
      'github'
    )
  }
}

async function exportProject(projectId, repositoryDir) {
  for (const entry of await fs.readdir(repositoryDir, { withFileTypes: true })) {
    if (entry.name !== '.git') {
      await fs.rm(path.join(repositoryDir, entry.name), {
        recursive: true,
        force: true,
      })
    }
  }
  const [docs, files] = await Promise.all([
    ProjectEntityHandler.promises.getAllDocs(projectId),
    ProjectEntityHandler.promises.getAllFiles(projectId),
  ])
  for (const [filePath, doc] of Object.entries(docs)) {
    const target = path.join(repositoryDir, filePath.replace(/^\//, ''))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, doc.lines.join('\n'))
  }
  for (const [filePath, file] of Object.entries(files)) {
    const target = path.join(repositoryDir, filePath.replace(/^\//, ''))
    await fs.mkdir(path.dirname(target), { recursive: true })
    const result = await HistoryManager.promises.requestBlobWithProjectId(
      projectId,
      file.hash
    )
    await pipeline(result.stream, createWriteStream(target))
  }
}

async function withRepository(link, token, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'overleaf-github-'))
  try {
    const repositoryDir = await cloneRepository(link, token, root)
    return await callback(repositoryDir, githubAuthEnv(token))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

export async function pullProject(link, token, userId) {
  return await withRepository(link, token, async repositoryDir => {
    const { stdout } = await git(['rev-parse', 'HEAD'], repositoryDir)
    await importDirectory(link.projectId.toString(), userId, repositoryDir)
    return stdout.trim()
  })
}

export async function pushProject(link, token, user) {
  return await withRepository(link, token, async (repositoryDir, authEnv) => {
    await exportProject(link.projectId.toString(), repositoryDir)
    await git(['config', 'user.name', user.name || user.email], repositoryDir)
    await git(['config', 'user.email', user.email], repositoryDir)
    await git(['add', '--all'], repositoryDir)
    const { stdout: status } = await git(['status', '--porcelain'], repositoryDir)
    if (!status.trim()) {
      const { stdout } = await git(['rev-parse', 'HEAD'], repositoryDir)
      return { commit: stdout.trim(), changed: false }
    }
    await git(
      ['commit', '-m', user.message || 'Update from Overleaf'],
      repositoryDir
    )
    await git(
      ['push', 'origin', `HEAD:${link.branch}`],
      repositoryDir,
      authEnv
    )
    const { stdout } = await git(['rev-parse', 'HEAD'], repositoryDir)
    return { commit: stdout.trim(), changed: true }
  })
}
