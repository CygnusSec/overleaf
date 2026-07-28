import Settings from '@overleaf/settings'
import { expressify } from '@overleaf/promise-utils'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import GitSyncController from './GitSyncController.mjs'

function apply(webRouter) {
  if (!Settings.enableGitSync) return
  const login = AuthenticationController.requireLogin()

  webRouter.get('/oauth/github', login, expressify(GitSyncController.oauthStart))
  webRouter.get(
    '/oauth/github/callback',
    login,
    expressify(GitSyncController.oauthCallback)
  )
  webRouter.get(
    '/api/github/status',
    login,
    expressify(GitSyncController.status)
  )
  webRouter.get(
    '/api/github/repositories',
    login,
    expressify(GitSyncController.repositories)
  )
  webRouter.delete(
    '/api/github/connection',
    login,
    expressify(GitSyncController.disconnect)
  )
  webRouter.post(
    '/api/github/import',
    login,
    expressify(GitSyncController.importRepository)
  )
  webRouter.get(
    '/project/:projectId/github-sync',
    login,
    expressify(GitSyncController.getLink)
  )
  webRouter.put(
    '/project/:projectId/github-sync',
    login,
    expressify(GitSyncController.saveLink)
  )
  webRouter.delete(
    '/project/:projectId/github-sync',
    login,
    expressify(GitSyncController.unlink)
  )
  webRouter.post(
    '/project/:projectId/github-sync/pull',
    login,
    expressify(GitSyncController.pull)
  )
  webRouter.post(
    '/project/:projectId/github-sync/push',
    login,
    expressify(GitSyncController.push)
  )
}

export default { apply }
