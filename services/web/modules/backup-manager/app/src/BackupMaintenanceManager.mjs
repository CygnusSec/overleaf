import fs from 'node:fs/promises'
import Path from 'node:path'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'

let maintenanceActive = false
let checking = false
let previousSiteIsOpen
let previousEditorIsOpen

async function markerExists() {
  try {
    await fs.access(
      Path.join(
        Settings.backupStoragePath || '/var/lib/overleaf/backups',
        '.maintenance'
      )
    )
    return true
  } catch {
    return false
  }
}

async function check() {
  if (checking) return
  checking = true
  try {
    const active = await markerExists()
    if (active && !maintenanceActive) {
      previousSiteIsOpen = Settings.siteIsOpen !== false
      previousEditorIsOpen = Settings.editorIsOpen !== false
      Settings.siteIsOpen = false
      Settings.editorIsOpen = false
      maintenanceActive = true
      await EditorRealTimeController.emitToAll(
        'forceDisconnect',
        'The editor is temporarily unavailable while a server backup is created.',
        5
      )
      logger.warn({}, 'backup maintenance mode enabled')
    } else if (!active && maintenanceActive) {
      Settings.siteIsOpen = previousSiteIsOpen
      Settings.editorIsOpen = previousEditorIsOpen
      maintenanceActive = false
      logger.warn({}, 'backup maintenance mode disabled')
    }
  } catch (error) {
    logger.error({ err: error }, 'could not update backup maintenance mode')
  } finally {
    checking = false
  }
}

export function start() {
  if (!Settings.backupManagerEnabled) return
  void check()
  const timer = setInterval(check, 2000)
  timer.unref()
}
