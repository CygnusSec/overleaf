import { expressify } from '@overleaf/promise-utils'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import RateLimiterMiddleware from '../../../../app/src/Features/Security/RateLimiterMiddleware.mjs'
import { RateLimiter } from '../../../../app/src/infrastructure/RateLimiter.mjs'
import AiAssistantController from './AiAssistantController.mjs'

const aiRequestRateLimiter = new RateLimiter('ai-assistant-request', {
  points: 30,
  duration: 60,
})
const aiConnectionTestRateLimiter = new RateLimiter(
  'ai-assistant-connection-test',
  { points: 10, duration: 60 }
)

export default {
  apply(webRouter) {
    const login = AuthenticationController.requireLogin()
    webRouter.get(
      '/api/ai/providers',
      login,
      expressify(AiAssistantController.catalog)
    )
    webRouter.get(
      '/api/ai/connections',
      login,
      expressify(AiAssistantController.listConnections)
    )
    webRouter.post(
      '/api/ai/connections',
      login,
      expressify(AiAssistantController.createConnection)
    )
    webRouter.post(
      '/api/ai/connections/test',
      login,
      RateLimiterMiddleware.rateLimit(aiConnectionTestRateLimiter),
      expressify(AiAssistantController.testConnection)
    )
    webRouter.put(
      '/api/ai/connections/:connectionId',
      login,
      expressify(AiAssistantController.updateConnection)
    )
    webRouter.delete(
      '/api/ai/connections/:connectionId',
      login,
      expressify(AiAssistantController.deleteConnection)
    )
    webRouter.get(
      '/api/ai/codex',
      login,
      expressify(AiAssistantController.getCodexStatus)
    )
    webRouter.put(
      '/api/ai/codex',
      login,
      expressify(AiAssistantController.updateCodexSettings)
    )
    webRouter.post(
      '/api/ai/codex/login',
      login,
      RateLimiterMiddleware.rateLimit(aiConnectionTestRateLimiter),
      expressify(AiAssistantController.beginCodexLogin)
    )
    webRouter.get(
      '/api/ai/codex/login/:loginId',
      login,
      expressify(AiAssistantController.getCodexLoginResult)
    )
    webRouter.delete(
      '/api/ai/codex',
      login,
      expressify(AiAssistantController.disconnectCodex)
    )
    webRouter.post(
      '/project/:project_id/ai/run',
      login,
      RateLimiterMiddleware.rateLimit(aiRequestRateLimiter, {
        params: ['project_id'],
      }),
      AuthorizationMiddleware.ensureUserCanReadProject,
      expressify(AiAssistantController.run)
    )
    webRouter.get(
      '/project/:project_id/ai/conversation',
      login,
      AuthorizationMiddleware.ensureUserCanReadProject,
      expressify(AiAssistantController.getConversation)
    )
    webRouter.delete(
      '/project/:project_id/ai/conversation',
      login,
      AuthorizationMiddleware.ensureUserCanReadProject,
      expressify(AiAssistantController.clearConversation)
    )
    webRouter.post(
      '/project/:project_id/ai/apply',
      login,
      RateLimiterMiddleware.rateLimit(aiRequestRateLimiter, {
        params: ['project_id'],
      }),
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      expressify(AiAssistantController.applyProjectChanges)
    )
    webRouter.get(
      '/admin/ai-providers',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      expressify(AiAssistantController.adminPage)
    )
    webRouter.post(
      '/admin/ai-providers',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      expressify(AiAssistantController.saveSystemProvider)
    )
    webRouter.post(
      '/admin/ai-providers/:providerId',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      expressify(AiAssistantController.saveSystemProvider)
    )
    webRouter.post(
      '/admin/ai-providers/:providerId/delete',
      AuthorizationMiddleware.ensureUserIsSiteAdmin,
      expressify(AiAssistantController.deleteSystemProvider)
    )
  },
}
