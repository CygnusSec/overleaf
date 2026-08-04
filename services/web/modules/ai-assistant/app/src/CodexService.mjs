import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import Settings from '@overleaf/settings'
import { AiProviderError } from './AiProviderService.mjs'

const clients = new Map()
const SAFE_USER_ID = /^[a-f0-9]{24}$/i
const SAFE_ENV_KEYS = [
  'PATH',
  'TMPDIR',
  'TZ',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
]

function codexEnvironment(home) {
  const env = { CODEX_HOME: home, HOME: home }
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

function codexHome(userId) {
  const id = String(userId)
  if (!SAFE_USER_ID.test(id)) throw new Error('Invalid user id')
  return path.join(
    Settings.aiCodexDataPath || '/var/lib/overleaf/codex',
    id
  )
}

async function ensureHome(userId) {
  const home = codexHome(userId)
  await fs.mkdir(home, { recursive: true, mode: 0o700 })
  await fs.chmod(home, 0o700)
  return home
}

class CodexClient {
  constructor(home) {
    this.home = home
    this.nextId = 1
    this.pending = new Map()
    this.loginResults = new Map()
  }

  async start() {
    this.process = spawn(
      Settings.aiCodexExecutable || 'codex',
      ['app-server', '--stdio'],
      {
        env: codexEnvironment(this.home),
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    )
    this.process.stderr.on('data', data => {
      console.warn('[ai-assistant] Codex app-server:', String(data).trim())
    })
    this.process.once('exit', error => {
      clients.delete(this.home)
      for (const { reject } of this.pending.values()) {
        reject(new Error(`Codex app-server stopped (${error ?? 'unknown'})`))
      }
      this.pending.clear()
    })
    readline.createInterface({ input: this.process.stdout }).on('line', line => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.id !== undefined) {
        const request = this.pending.get(message.id)
        if (!request) return
        this.pending.delete(message.id)
        if (message.error) request.reject(new Error(message.error.message))
        else request.resolve(message.result)
      } else if (message.method === 'account/login/completed') {
        this.loginResults.set(message.params?.loginId, message.params)
      }
    })
    await this.request('initialize', {
      clientInfo: {
        name: 'overleaf-ai-assistant',
        title: 'Overleaf AI Assistant',
        version: '1.0.0',
      },
      capabilities: {},
    })
    this.notify('initialized', {})
    this.expiry = setTimeout(() => this.stop(), 10 * 60 * 1000)
    return this
  }

  stop() {
    clearTimeout(this.expiry)
    clients.delete(this.home)
    this.process?.kill('SIGTERM')
  }

  request(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex request timed out: ${method}`))
      }, Settings.aiRequestTimeoutMs || 120000)
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.process.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  notify(method, params = {}) {
    this.process.stdin.write(`${JSON.stringify({ method, params })}\n`)
  }
}

async function clientFor(userId) {
  const home = await ensureHome(userId)
  const existing = clients.get(home)
  if (existing) return existing
  const promise = new CodexClient(home).start()
  clients.set(home, promise)
  try {
    return await promise
  } catch (error) {
    clients.delete(home)
    throw new AiProviderError(
      `Codex runtime is unavailable: ${error.message}`,
      502
    )
  }
}

export async function codexStatus(userId) {
  if (!Settings.enableCodexLogin) return { enabled: false, connected: false }
  const home = await ensureHome(userId)
  const result = await runCodexCommand(home, ['login', 'status'])
  return {
    enabled: true,
    connected: result.code === 0,
    unavailable: result.code === -1,
    accountLabel: result.stdout.trim() || null,
  }
}

export async function startCodexLogin(userId) {
  if (!Settings.enableCodexLogin) {
    throw new AiProviderError('Codex login is disabled', 503)
  }
  const client = await clientFor(userId)
  return await client.request('account/login/start', {
    type: 'chatgptDeviceCode',
  })
}

export async function codexLoginResult(userId, loginId) {
  const home = codexHome(userId)
  const client = await clients.get(home)
  if (!client) return { status: 'expired' }
  const completed = client.loginResults.get(loginId)
  if (!completed) return { status: 'pending' }
  client.loginResults.delete(loginId)
  client.stop()
  return completed.success
    ? { status: 'completed' }
    : {
        status: 'failed',
        message: completed.error || 'ChatGPT sign-in failed',
      }
}

export async function logoutCodex(userId) {
  const home = await ensureHome(userId)
  const client = await clients.get(home)
  client?.stop()
  const result = await runCodexCommand(home, ['logout'])
  if (result.code !== 0) {
    throw new AiProviderError(
      result.stderr.trim() || 'Could not disconnect Codex',
      502
    )
  }
}

function runCodexCommand(home, args) {
  return new Promise(resolve => {
    const child = spawn(Settings.aiCodexExecutable || 'codex', args, {
      env: codexEnvironment(home),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ code: -1, stdout, stderr: 'Codex command timed out' })
    }, 10000)
    child.stdout.on('data', data => {
      stdout = `${stdout}${data}`.slice(-4000)
    })
    child.stderr.on('data', data => {
      stderr = `${stderr}${data}`.slice(-4000)
    })
    child.once('error', error =>
      finish({ code: -1, stdout, stderr: error.message })
    )
    child.once('exit', code => finish({ code: code ?? -1, stdout, stderr }))
  })
}

function execCodex(home, args, prompt, outputFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(Settings.aiCodexExecutable || 'codex', args, {
      env: codexEnvironment(home),
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new AiProviderError('Codex request timed out', 504))
    }, Settings.aiRequestTimeoutMs || 120000)
    child.stderr.on('data', data => {
      stderr = `${stderr}${data}`.slice(-4000)
    })
    child.once('error', error => {
      clearTimeout(timer)
      reject(new AiProviderError(`Could not start Codex: ${error.message}`, 502))
    })
    child.once('exit', async code => {
      clearTimeout(timer)
      if (code !== 0) {
        return reject(
          new AiProviderError(
            stderr.trim() || `Codex exited with status ${code}`,
            502
          )
        )
      }
      try {
        resolve(await fs.readFile(outputFile, 'utf8'))
      } catch {
        reject(new AiProviderError('Codex returned an empty response', 502))
      }
    })
    child.stdin.end(prompt)
  })
}

export async function runCodex({ userId, model, prompt }) {
  const home = await ensureHome(userId)
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'overleaf-codex-'))
  const outputFile = path.join(temp, 'response.txt')
  try {
    return await execCodex(
      home,
      [
        '--ask-for-approval',
        'never',
        '--disable',
        'shell_tool',
        '--disable',
        'unified_exec',
        '--disable',
        'apps',
        '--disable',
        'browser_use',
        '--disable',
        'computer_use',
        '--disable',
        'multi_agent',
        '--disable',
        'image_generation',
        'exec',
        '-',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--color',
        'never',
        '--output-last-message',
        outputFile,
        ...(model ? ['--model', model] : []),
        '--cd',
        temp,
      ],
      prompt,
      outputFile
    )
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
}
