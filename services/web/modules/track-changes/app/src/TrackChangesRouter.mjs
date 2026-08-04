import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import TrackChangesController from './TrackChangesController.mjs'

function apply(webRouter) {
  const login = AuthenticationController.requireLogin()
  const canRead = AuthorizationMiddleware.ensureUserCanReadProject
  const notRestricted = AuthorizationMiddleware.blockRestrictedUserFromProject
  const canResolve =
    AuthorizationMiddleware.ensureUserCanDeleteOrResolveThread

  webRouter.get(
    '/project/:project_id/threads',
    login,
    notRestricted,
    canRead,
    TrackChangesController.getThreads
  )
  webRouter.get(
    '/project/:project_id/ranges',
    login,
    notRestricted,
    canRead,
    TrackChangesController.getProjectRanges
  )
  webRouter.get(
    '/project/:project_id/changes/users',
    login,
    notRestricted,
    canRead,
    TrackChangesController.getChangesUsers
  )
  webRouter.post(
    '/project/:project_id/thread/:thread_id/messages',
    login,
    notRestricted,
    canRead,
    TrackChangesController.sendComment
  )
  webRouter.post(
    '/project/:project_id/doc/:doc_id/thread/:thread_id/resolve',
    login,
    notRestricted,
    canRead,
    canResolve,
    TrackChangesController.resolveThread
  )
  webRouter.post(
    '/project/:project_id/doc/:doc_id/thread/:thread_id/reopen',
    login,
    notRestricted,
    canRead,
    canResolve,
    TrackChangesController.reopenThread
  )
  webRouter.delete(
    '/project/:project_id/doc/:doc_id/thread/:thread_id',
    login,
    notRestricted,
    canRead,
    canResolve,
    TrackChangesController.deleteThread
  )
  webRouter.post(
    '/project/:project_id/thread/:thread_id/messages/:message_id/edit',
    login,
    notRestricted,
    canRead,
    TrackChangesController.editMessage
  )
  webRouter.delete(
    '/project/:project_id/thread/:thread_id/messages/:message_id',
    login,
    notRestricted,
    canRead,
    canResolve,
    TrackChangesController.deleteMessage
  )
  webRouter.delete(
    '/project/:project_id/thread/:thread_id/own-messages/:message_id',
    login,
    notRestricted,
    canRead,
    TrackChangesController.deleteOwnMessage
  )
  webRouter.post(
    '/project/:project_id/doc/:doc_id/changes/accept',
    login,
    notRestricted,
    canRead,
    AuthorizationMiddleware.ensureUserCanWriteOrReviewProjectContent,
    TrackChangesController.acceptChanges
  )
}

export default { apply }
