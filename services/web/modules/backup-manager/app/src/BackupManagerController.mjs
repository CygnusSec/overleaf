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

async function readCurrentRunLog() {
  const target = Path.join(storagePath(), 'current-run.log')
  let handle
  try {
    const stat = await fs.stat(target)
    const length = Math.min(stat.size, 32 * 1024)
    handle = await fs.open(target, 'r')
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, stat.size - length)
    return buffer.toString('utf8')
  } catch {
    return ''
  } finally {
    await handle?.close()
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

function localIsoTimestamp() {
  const date = new Date()
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offsetMinutes)
  const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0')
  const minutes = String(absoluteOffset % 60).padStart(2, '0')
  const localTime = new Date(date.getTime() + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, -1)
  return `${localTime}${sign}${hours}:${minutes}`
}

function formatHostTimestamp(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

async function writeStatus(status) {
  const target = Path.join(storagePath(), 'last-run.json')
  const temporary = `${target}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(status)}\n`, {
    mode: 0o660,
  })
  await fs.rename(temporary, target)
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
      createdAtDisplay: formatHostTimestamp(stat.mtime),
      hasChecksum: await fs
        .access(Path.join(storagePath(), `${entry.name}.sha256`))
        .then(() => true)
        .catch(() => false),
    })
  }
  return archives.sort((a, b) => b.createdAt - a.createdAt)
}

async function index(req, res) {
  const [archives, schedule, lastRun, schedulerAvailable, currentRunLog] =
    await Promise.all([
      listArchives(),
      readSchedule(),
      readLastRun(),
      schedulerIsAvailable(),
      readCurrentRunLog(),
    ])
  res.render(
    Path.resolve(import.meta.dirname, '../views/backup-manager.pug'),
    {
      title: 'Backup & Restore',
      archives,
      schedule,
      lastRun,
      currentRunLog,
      lastRunDisplayTime: formatHostTimestamp(
        lastRun?.finishedAt || lastRun?.startedAt || lastRun?.requestedAt
      ),
      queueStalled:
        lastRun?.status === 'queued' &&
        Date.now() - Date.parse(lastRun.requestedAt) > 60_000,
      schedulerAvailable,
      enabled: Settings.backupManagerEnabled,
      encryptionConfigured: encryptionConfigured(),
      backupStoragePath: storagePath(),
      notice: req.query.notice,
      error: req.query.error,
    }
  )
}

async function clearStatus(req, res) {
  await Promise.all([
    fs.unlink(Path.join(storagePath(), 'last-run.json')).catch(() => {}),
    fs.unlink(Path.join(storagePath(), 'current-run.log')).catch(() => {}),
  ])
  return redirectWithMessage(res, 'notice', 'Backup status cleared')
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
    await writeStatus({
        status: 'queued',
        requestedAt: localIsoTimestamp(),
        message: 'Waiting for the backup service to start this request.',
    })
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

async function cancel(req, res) {
  const lastRun = await readLastRun()
  const requestDirectory = Path.join(storagePath(), '.requests')

  if (lastRun?.status === 'running') {
    await fs.writeFile(Path.join(storagePath(), '.cancel'), '', {
      mode: 0o660,
    })
    return redirectWithMessage(
      res,
      'notice',
      'Cancellation requested. Waiting for the backup process to stop.'
    )
  }

  const entries = await fs.readdir(requestDirectory).catch(() => [])
  await Promise.all(
    entries
      .filter(
        name => name.startsWith('create-') || name.startsWith('.pending-')
      )
      .map(name => fs.unlink(Path.join(requestDirectory, name)).catch(() => {}))
  )
  await writeStatus({
    status: 'cancelled',
    finishedAt: localIsoTimestamp(),
    message: 'Queued backup cancelled by an administrator.',
  })
  return redirectWithMessage(res, 'notice', 'Queued backup cancelled')
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
  cancel,
  clearStatus,
  updateSchedule,
  download,
  remove,
  uploaded,
}
