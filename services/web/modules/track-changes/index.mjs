import ProjectEditorHandler from '../../app/src/Features/Project/ProjectEditorHandler.mjs'
import TrackChangesRouter from './app/src/TrackChangesRouter.mjs'

/** @import { WebModule } from "../../types/web-module" */

/** @type {WebModule} */
const TrackChangesModule = {
  router: TrackChangesRouter,
  start() {
    ProjectEditorHandler.trackChangesAvailable = true
  },
}

export default TrackChangesModule
