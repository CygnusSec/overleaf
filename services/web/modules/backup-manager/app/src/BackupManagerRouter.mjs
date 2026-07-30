import crypto from 'node:crypto'
import fs from 'node:fs'
import multer from 'multer'
import Settings from '@overleaf/settings'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import BackupManagerController from './BackupManagerController.mjs'

const storage = multer.diskStorage({
  destination(req, file, callback) {
    const target =
      Settings.backupStoragePath || '/var/lib/overleaf/backups'
    fs.mkdirSync(target, { recursive: true })
    callback(null, target)
  },
  filename(req, file, callback) {
    callback(
      null,
      `imported-backup-${Date.now()}-${crypto.randomUUID()}.tar.gz.gpg`
    )
  },
})

const upload = multer({
  storage,
  limits: { files: 1, fileSize: 100 * 1024 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    callback(null, file.originalname.endsWith('.tar.gz.gpg'))
  },
})

export default {
  apply(webRouter) {
    const admin = AuthorizationMiddleware.ensureUserIsSiteAdmin
    webRouter.get('/admin/backups', admin, BackupManagerController.index)
    webRouter.post(
      '/admin/backups/create',
      admin,
      BackupManagerController.create
    )
    webRouter.post(
      '/admin/backups/status/clear',
      admin,
      BackupManagerController.clearStatus
    )
    webRouter.post(
      '/admin/backups/cancel',
      admin,
      BackupManagerController.cancel
    )
    webRouter.post(
      '/admin/backups/schedule',
      admin,
      BackupManagerController.updateSchedule
    )
    webRouter.get(
      '/admin/backups/:name/download',
      admin,
      BackupManagerController.download
    )
    webRouter.post(
      '/admin/backups/:name/delete',
      admin,
      BackupManagerController.remove
    )
    webRouter.post(
      '/admin/backups/import',
      admin,
      upload.single('backup'),
      BackupManagerController.uploaded
    )
  },
}
