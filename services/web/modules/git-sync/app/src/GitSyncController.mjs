import crypto from 'node:crypto'
import Settings from '@overleaf/settings'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import PrivilegeLevels from '../../../../app/src/Features/Authorization/PrivilegeLevels.mjs'
import ProjectCreationHandler from '../../../../app/src/Features/Project/ProjectCreationHandler.mjs'
import ProjectDeleter from '../../../../app/src/Features/Project/ProjectDeleter.mjs'
import { DeletedProjectReasons } from '../../../../app/src/Features/Project/DeletedProjectReasons.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import { GithubConnection, GitProjectLink } from './GitSyncModels.mjs'
import { encryptSecret, decryptSecret } from './GitCrypto.mjs'
import {
  exchangeCode,
  getRepositories,
  getRepository,
  getUser,
} from './GithubApi.mjs'
import { pullProject, pushProject } from './GitSyncService.mjs'

const activeProjects = new Set()

function callbackUrl() {
  return new URL('/oauth/github/callback', Settings.siteUrl).toString()
}

function isConfigured() {
  return Boolean(
    Settings.githubSyncClientId &&
      Settings.githubSyncClientSecret &&
      Settings.gitIntegrationEncryptionKey
  )
}

function requireConfiguration(res) {
  if (isConfigured()) return true
  res.status(503).json({
    message:
      'GitHub Sync is not configured. Set GITHUB_SYNC_CLIENT_ID, GITHUB_SYNC_CLIENT_SECRET, and GIT_INTEGRATION_ENCRYPTION_KEY.',
  })
  return false
}

function currentUserId(req) {
  return SessionManager.getLoggedInUserId(req.session)
}

async function getConnection(userId) {
  return await GithubConnection.findOne({ userId })
}

async function requireProjectOwner(req, res) {
  const privilege =
    await AuthorizationManager.promises.getPrivilegeLevelForProject(
      currentUserId(req),
      req.params.projectId
    )
  if (privilege !== PrivilegeLevels.OWNER) {
    res.status(403).json({ message: 'Only the project owner can use GitHub Sync' })
    return false
  }
  return true
}

async function oauthStart(req, res) {
  if (!requireConfiguration(res)) return
  const state = crypto.randomBytes(32).toString('base64url')
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  req.session.githubOauth = {
    state,
    codeVerifier,
    returnTo:
      typeof req.query.returnTo === 'string' &&
      req.query.returnTo.startsWith('/')
        ? req.query.returnTo
        : '/project',
  }
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', Settings.githubSyncClientId)
  url.searchParams.set('redirect_uri', callbackUrl())
  url.searchParams.set('scope', 'repo')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  res.redirect(url.toString())
}

async function oauthCallback(req, res) {
  if (!requireConfiguration(res)) return
  const oauth = req.session.githubOauth
  delete req.session.githubOauth
  if (
    !oauth ||
    typeof req.query.state !== 'string' ||
    req.query.state !== oauth.state ||
    typeof req.query.code !== 'string'
  ) {
    return res.status(400).send('Invalid GitHub OAuth state')
  }
  const accessToken = await exchangeCode(req.query.code, oauth.codeVerifier)
  const githubUser = await getUser(accessToken)
  await GithubConnection.findOneAndUpdate(
    { userId: currentUserId(req) },
    {
      $set: {
        githubUserId: githubUser.id,
        login: githubUser.login,
        token: encryptSecret(accessToken),
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  )
  res.redirect(oauth.returnTo)
}

async function status(req, res) {
  if (!isConfigured()) {
    return res.json({ connected: false, configured: false })
  }
  const connection = await getConnection(currentUserId(req))
  res.json({
    connected: Boolean(connection),
    configured: true,
    login: connection?.login,
  })
}

async function repositories(req, res) {
  if (!requireConfiguration(res)) return
  const connection = await getConnection(currentUserId(req))
  if (!connection) {
    return res.status(401).json({ message: 'GitHub account is not connected' })
  }
  const repos = await getRepositories(decryptSecret(connection.token))
  res.json({
    repositories: repos.map(repo => ({
      id: repo.id,
      fullName: repo.full_name,
      private: repo.private,
      defaultBranch: repo.default_branch,
      cloneUrl: repo.clone_url,
      canPush: Boolean(repo.permissions?.push),
    })),
  })
}

async function disconnect(req, res) {
  const userId = currentUserId(req)
  await Promise.all([
    GithubConnection.deleteOne({ userId }),
    GitProjectLink.deleteMany({ ownerId: userId }),
  ])
  res.sendStatus(204)
}

async function getLink(req, res) {
  if (!(await requireProjectOwner(req, res))) return
  if (!isConfigured()) {
    return res.json({ connected: false, configured: false, link: null })
  }
  const [connection, link] = await Promise.all([
    getConnection(currentUserId(req)),
    GitProjectLink.findOne({ projectId: req.params.projectId }),
  ])
  res.json({
    connected: Boolean(connection),
    configured: true,
    login: connection?.login,
    link: link
      ? {
          repositoryFullName: link.repositoryFullName,
          branch: link.branch,
          lastSyncedAt: link.lastSyncedAt,
          lastSyncDirection: link.lastSyncDirection,
          lastSyncedCommit: link.lastSyncedCommit,
        }
      : null,
  })
}

async function saveLink(req, res) {
  if (!requireConfiguration(res)) return
  if (!(await requireProjectOwner(req, res))) return
  const userId = currentUserId(req)
  const connection = await getConnection(userId)
  if (!connection) {
    return res.status(401).json({ message: 'GitHub account is not connected' })
  }
  const repository = await getRepository(
    decryptSecret(connection.token),
    req.body.repositoryFullName
  )
  if (!repository.permissions?.push) {
    return res.status(403).json({ message: 'Repository write access is required' })
  }
  const branch = req.body.branch || repository.default_branch
  const link = await GitProjectLink.findOneAndUpdate(
    { projectId: req.params.projectId },
    {
      $set: {
        ownerId: userId,
        repositoryFullName: repository.full_name,
        cloneUrl: repository.clone_url,
        branch,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, new: true }
  )
  res.json({
    repositoryFullName: link.repositoryFullName,
    branch: link.branch,
  })
}

async function unlink(req, res) {
  if (!(await requireProjectOwner(req, res))) return
  await GitProjectLink.deleteOne({ projectId: req.params.projectId })
  res.sendStatus(204)
}

async function runSync(req, res, direction) {
  if (!requireConfiguration(res)) return
  if (!(await requireProjectOwner(req, res))) return
  const projectId = req.params.projectId
  if (activeProjects.has(projectId)) {
    return res.status(409).json({ message: 'A GitHub sync is already running' })
  }
  const [connection, link, user] = await Promise.all([
    getConnection(currentUserId(req)),
    GitProjectLink.findOne({ projectId }),
    UserGetter.promises.getUser(currentUserId(req), {
      email: 1,
      first_name: 1,
      last_name: 1,
    }),
  ])
  if (!connection || !link) {
    return res.status(400).json({ message: 'Link a GitHub repository first' })
  }
  activeProjects.add(projectId)
  try {
    const token = decryptSecret(connection.token)
    let commit
    let changed = true
    if (direction === 'pull') {
      commit = await pullProject(link, token, currentUserId(req))
    } else {
      const result = await pushProject(link, token, {
        name: [user.first_name, user.last_name].filter(Boolean).join(' '),
        email: user.email,
        message: req.body.message,
      })
      ;({ commit, changed } = result)
    }
    link.lastSyncedCommit = commit
    link.lastSyncedAt = new Date()
    link.lastSyncDirection = direction
    await link.save()
    res.json({ commit, changed, syncedAt: link.lastSyncedAt })
  } catch (error) {
    res.status(502).json({
      message:
        error.code === 'ENOENT'
          ? 'Git is not installed in the ShareLaTeX image'
          : error.message || 'GitHub sync failed',
    })
  } finally {
    activeProjects.delete(projectId)
  }
}

async function pull(req, res) {
  await runSync(req, res, 'pull')
}

async function push(req, res) {
  await runSync(req, res, 'push')
}

async function importRepository(req, res) {
  if (!requireConfiguration(res)) return
  const userId = currentUserId(req)
  const connection = await getConnection(userId)
  if (!connection) {
    return res.status(401).json({ message: 'GitHub account is not connected' })
  }
  const token = decryptSecret(connection.token)
  const repository = await getRepository(token, req.body.repositoryFullName)
  const project = await ProjectCreationHandler.promises.createBlankProject(
    userId,
    req.body.projectName || repository.name
  )
  const link = await GitProjectLink.create({
    projectId: project._id,
    ownerId: userId,
    repositoryFullName: repository.full_name,
    cloneUrl: repository.clone_url,
    branch: req.body.branch || repository.default_branch,
  })
  try {
    const commit = await pullProject(link, token, userId)
    link.lastSyncedCommit = commit
    link.lastSyncedAt = new Date()
    link.lastSyncDirection = 'pull'
    await link.save()
    res.status(201).json({ projectId: project._id.toString() })
  } catch (error) {
    await Promise.allSettled([
      GitProjectLink.deleteOne({ _id: link._id }),
      ProjectDeleter.promises.deleteProject(project._id, {
        deletedReason: DeletedProjectReasons.GITHUB_IMPORT_FAILURE,
      }),
    ])
    res.status(502).json({ message: error.message || 'GitHub import failed' })
  }
}

export default {
  oauthStart,
  oauthCallback,
  status,
  repositories,
  disconnect,
  getLink,
  saveLink,
  unlink,
  pull,
  push,
  importRepository,
}
