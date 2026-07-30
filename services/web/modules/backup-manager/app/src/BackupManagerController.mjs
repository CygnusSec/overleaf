import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import Path from 'node:path'
import Settings from '@overleaf/settings'

const ARCHIVE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.tar\.gz\.gpg$/
const SCHEDULER_HEARTBEAT_MAX_AGE_MS = 90_000

function storagePath() {
  return Settings.backupStoragePath || '/var/lib/overleaf/backups'
}

function encryptionConfigured() {
  return Boolean(
    Settings.backupEncryptionPassphrase &&
      !Settings.backupEncryptionPassphrase.startsWith('replace-with-')
  )
}

function safeArchiveName(value) {
  if (typeof value !== 'string' || !ARCHIVE_PATTERN.test(value)) {
    throw new Error('Invalid backup archive name')
  }
  return value
}

async function readSchedule() {
  try {
    return JSON.parse(
      await fs.readFile(Path.join(storagePath(), 'schedule.json'), 'utf8')
    )
  } catch {
    return {
      enabled: false,
      frequency: 'daily',
      hour: 2,
      minute: 0,
      weekday: 0,
      retention: 7,
    }
  }
}

async function readLastRun() {
  try {
    return JSON.parse(
      await fs.readFile(Path.join(storagePath(), 'last-run.json'), 'utf8')
    )
  } catch {
    return null
  }
}

async function schedulerIsAvailable() {
  try {
    const stat = await fs.stat(
      Path.join(storagePath(), '.scheduler-heartbeat')
    )
    return Date.now() - stat.mtimeMs <= SCHEDULER_HEARTBEAT_MAX_AGE_MS
  } catch {
    return false
  }
}

function redirectWithMessage(res, type, message) {
  res.redirect(`/admin/backups?${type}=${encodeURIComponent(message)}`)
}

async function listArchives() {
  await fs.mkdir(storagePath(), { recursive: true })
  const entries = await fs.readdir(storagePath(), { withFileTypes: true })
  const archives = []
  for (const entry of entries) {
    if (!entry.isFile() || !ARCHIVE_PATTERN.test(entry.name)) continue
    const stat = await fs.stat(Path.join(storagePath(), entry.name))
    archives.push({
      name: entry.name,
      size: stat.size,
      createdAt: stat.mtime,
      hasChecksum: await fs
        .access(Path.join(storagePath(), `${entry.name}.sha256`))
        .then(() => true)
        .catch(() => false),
    })
  }
  return archives.sort((a, b) => b.createdAt - a.createdAt)
}

async function index(req, res) {
  const [archives, schedule, lastRun, schedulerAvailable] = await Promise.all([
    listArchives(),
    readSchedule(),
    readLastRun(),
    schedulerIsAvailable(),
  ])
  res.render(
    Path.resolve(import.meta.dirname, '../views/backup-manager.pug'),
    {
      title: 'Backup & Restore',
      archives,
      schedule,
      lastRun,
      schedulerAvailable,
      enabled: Settings.backupManagerEnabled,
      encryptionConfigured: encryptionConfigured(),
      backupStoragePath: storagePath(),
      notice: req.query.notice,
      error: req.query.error,
    }
  )
}

async function create(req, res) {
  if (!Settings.backupManagerEnabled) {
    return redirectWithMessage(res, 'error', 'Backup Manager is disabled')
  }
  if (!encryptionConfigured()) {
    return redirectWithMessage(
      res,
      'error',
      'Configure BACKUP_ENCRYPTION_PASSPHRASE first'
    )
  }
  if (!(await schedulerIsAvailable())) {
    return redirectWithMessage(
      res,
      'error',
      'Backup service is not running. Start it with: docker compose up -d backup-manager'
    )
  }

  try {
    const requestDirectory = Path.join(storagePath(), '.requests')
    await fs.mkdir(requestDirectory, { recursive: true })
    const requestId = `${Date.now()}-${crypto.randomUUID()}`
    const pendingRequest = Path.join(requestDirectory, `.pending-${requestId}`)
    await fs.writeFile(pendingRequest, '', {
      flag: 'wx',
      mode: 0o660,
    })
    await fs.writeFile(
      Path.join(storagePath(), 'last-run.json'),
      `${JSON.stringify({
        status: 'queued',
        requestedAt: new Date().toISOString(),
        message: 'Waiting for the backup service to start this request.',
      })}\n`,
      { mode: 0o660 }
    )
    await fs.rename(
      pendingRequest,
      Path.join(requestDirectory, `create-${requestId}`)
    )
    return redirectWithMessage(
      res,
      'notice',
      'Backup request queued. This page will update automatically.'
    )
  } catch (error) {
    return redirectWithMessage(
      res,
      'error',
      `Could not queue backup: ${error.message}`
    )
  }
}

async function updateSchedule(req, res) {
  if (!Settings.backupManagerEnabled || !encryptionConfigured()) {
    return res.redirect(
      '/admin/backups?error=Enable Backup Manager and configure encryption first'
    )
  }
  const frequency = req.body.frequency === 'weekly' ? 'weekly' : 'daily'
  const schedule = {
    enabled: req.body.enabled === 'true',
    frequency,
    hour: Math.min(Math.max(Number.parseInt(req.body.hour, 10) || 0, 0), 23),
    minute: Math.min(
      Math.max(Number.parseInt(req.body.minute, 10) || 0, 0),
      59
    ),
    weekday: Math.min(
      Math.max(Number.parseInt(req.body.weekday, 10) || 0, 0),
      6
    ),
    retention: Math.min(
      Math.max(Number.parseInt(req.body.retention, 10) || 7, 1),
      365
    ),
  }
  await fs.mkdir(storagePath(), { recursive: true })
  const target = Path.join(storagePath(), 'schedule.json')
  const temporary = `${target}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(schedule, null, 2)}\n`, {
    mode: 0o600,
  })
  await fs.rename(temporary, target)
  res.redirect('/admin/backups?notice=Backup schedule updated')
}

async function download(req, res) {
  const name = safeArchiveName(req.params.name)
  res.download(Path.join(storagePath(), name), name)
}

async function remove(req, res) {
  const name = safeArchiveName(req.params.name)
  await Promise.all([
    fs.unlink(Path.join(storagePath(), name)),
    fs.unlink(Path.join(storagePath(), `${name}.sha256`)).catch(() => {}),
  ])
  res.redirect('/admin/backups?notice=Backup deleted')
}

async function uploaded(req, res) {
  if (!req.file) {
    return res.redirect('/admin/backups?error=Select a backup archive')
  }
  res.redirect('/admin/backups?notice=Backup archive imported')
}

export default {
  index,
  create,
  updateSchedule,
  download,
  remove,
  uploaded,
}
