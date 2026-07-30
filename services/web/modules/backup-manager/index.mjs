import BackupManagerRouter from './app/src/BackupManagerRouter.mjs'
import {
  start as startBackupMaintenanceManager,
} from './app/src/BackupMaintenanceManager.mjs'

startBackupMaintenanceManager()

/** @import { WebModule } from "../../types/web-module" */

/** @type {WebModule} */
const BackupManagerModule = {
  router: BackupManagerRouter,
}

export default BackupManagerModule
