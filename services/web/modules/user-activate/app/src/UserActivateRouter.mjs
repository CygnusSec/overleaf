import logger from '@overleaf/logger'
import UserActivateController from './UserActivateController.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init UserActivate router')

    webRouter.get(
      '/admin/user',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      (req, res) => res.redirect('/admin/register')
    )

    webRouter.get('/user/activate', UserActivateController.activateAccountPage)
    AuthenticationController.addEndpointToLoginWhitelist('/user/activate')

    webRouter.get(
      '/admin/register',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserActivateController.registerNewUser
    )
    webRouter.post(
      '/admin/register',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserActivateController.register
    )
    webRouter.get(
      '/admin/users',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserActivateController.listUsers
    )
    webRouter.put(
      '/admin/users/:userId',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserActivateController.updateManagedUser
    )
    webRouter.post(
      '/admin/users/:userId/status',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserActivateController.setUserSuspended
    )
    webRouter.delete(
      '/admin/users/:userId',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      UserActivateController.deleteManagedUser
    )
  },
}
