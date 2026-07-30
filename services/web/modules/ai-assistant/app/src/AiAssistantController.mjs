import Settings from '@overleaf/settings'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import SafePath from '../../../../app/src/Features/Project/SafePath.mjs'
import {
  AiCodexSettings,
  AiConversation,
  AiSystemProvider,
  AiUserConnection,
} from './AiModels.mjs'
import { decryptCredential, encryptCredential } from './AiCrypto.mjs'
import {
  AiProviderError,
  getCatalogProvider,
  parseAssistantResponse,
  providerCatalog,
  runProvider,
  systemPrompt,
  userPrompt,
} from './AiProviderService.mjs'
import {
  codexLoginResult,
  codexStatus,
  logoutCodex,
  runCodex,
  startCodexLogin,
} from './CodexService.mjs'

function userId(req) {
  return SessionManager.getLoggedInUserId(req.session)
}

function validObjectId(value) {
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)
}

function requireEnabled(res) {
  if (Settings.enableAiAssistant && Settings.aiCredentialEncryptionKey) {
    return true
  }
  res.status(503).json({ message: 'AI Assistant is not configured' })
  return false
}

function publicConnection(item) {
  return {
    id: item._id.toString(),
    providerId: item.providerId,
    displayName: item.displayName,
    model: item.model,
    enabled: item.enabled,
    lastUsedAt: item.lastUsedAt,
  }
}

function sendProviderError(res, error) {
  if (!(error instanceof AiProviderError)) throw error

  const status =
    error.statusCode === 400 ||
    error.statusCode === 401 ||
    error.statusCode === 403 ||
    error.statusCode === 404 ||
    error.statusCode === 422
      ? 422
      : error.statusCode === 429
        ? 429
        : error.statusCode === 504
          ? 504
          : 502

  return res.status(status).json({ message: error.message })
}

function codexModels() {
  const models = Array.isArray(Settings.aiCodexModels)
    ? Settings.aiCodexModels.map(String).filter(Boolean).slice(0, 100)
    : []
  return Array.from(
    new Set([Settings.aiCodexDefaultModel, ...models].filter(Boolean))
  )
}

function publicMessages(conversation) {
  return (conversation?.messages || []).map(message => ({
    id: message._id.toString(),
    role: message.role,
    content: message.content,
    mode: message.mode,
    createdAt: message.createdAt,
  }))
}

async function appendConversationMessages(query, messages) {
  const update = {
    $push: {
      messages: {
        $each: messages,
        $slice: -100,
      },
    },
    $set: { updatedAt: new Date() },
    $setOnInsert: { createdAt: new Date() },
  }
  try {
    return await AiConversation.findOneAndUpdate(query, update, {
      upsert: true,
      new: true,
    })
  } catch (error) {
    // Two browser tabs can create the same project conversation concurrently.
    if (error?.code !== 11000) throw error
    return await AiConversation.findOneAndUpdate(query, update, { new: true })
  }
}

export async function getConversation(req, res) {
  if (!requireEnabled(res)) return
  const conversation = await AiConversation.findOne({
    userId: userId(req),
    projectId: req.params.project_id,
  })
  res.json({ messages: publicMessages(conversation) })
}

export async function clearConversation(req, res) {
  if (!requireEnabled(res)) return
  await AiConversation.deleteOne({
    userId: userId(req),
    projectId: req.params.project_id,
  })
  res.sendStatus(204)
}

async function publicCodexStatus(req) {
  const [status, preferences] = await Promise.all([
    codexStatus(userId(req)),
    AiCodexSettings.findOne({ userId: userId(req) }),
  ])
  const models = codexModels()
  return {
    ...status,
    models,
    model:
      (preferences && models.includes(preferences.model)
        ? preferences.model
        : null) ||
      models[0] ||
      '',
  }
}

export async function catalog(req, res) {
  if (!requireEnabled(res)) return
  res.json({ providers: providerCatalog() })
}

export async function listConnections(req, res) {
  if (!requireEnabled(res)) return
  const enabledProviderIds = new Set(providerCatalog().map(item => item.id))
  const [personal, shared] = await Promise.all([
    AiUserConnection.find({ userId: userId(req) }).sort({ displayName: 1 }),
    AiSystemProvider.find({ enabled: true }).sort({ name: 1 }),
  ])
  let codex
  try {
    codex = await publicCodexStatus(req)
  } catch (error) {
    console.error('[ai-assistant] Could not read Codex status', error)
    codex = {
      enabled: Settings.enableCodexLogin,
      connected: false,
      unavailable: true,
    }
  }
  res.json({
    personal: personal
      .filter(item => enabledProviderIds.has(item.providerId))
      .map(publicConnection),
    shared: shared.map(item => ({
      id: `system:${item._id}`,
      displayName: item.name,
      model: item.model,
      shared: true,
    })),
    codex,
  })
}

export async function getCodexStatus(req, res) {
  if (!requireEnabled(res)) return
  res.json(await publicCodexStatus(req))
}

export async function updateCodexSettings(req, res) {
  if (!requireEnabled(res)) return
  const model = String(req.body.model || '').trim()
  if (!codexModels().includes(model)) {
    return res.status(422).json({ message: 'Invalid Codex model' })
  }
  await AiCodexSettings.updateOne(
    { userId: userId(req) },
    { $set: { model, updatedAt: new Date() } },
    { upsert: true }
  )
  res.json(await publicCodexStatus(req))
}

export async function beginCodexLogin(req, res) {
  if (!requireEnabled(res)) return
  try {
    res.json(await startCodexLogin(userId(req)))
  } catch (error) {
    return sendProviderError(res, error)
  }
}

export async function getCodexLoginResult(req, res) {
  if (!requireEnabled(res)) return
  const loginId = String(req.params.loginId || '')
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(loginId)) return res.sendStatus(404)
  res.json(await codexLoginResult(userId(req), loginId))
}

export async function disconnectCodex(req, res) {
  if (!requireEnabled(res)) return
  await logoutCodex(userId(req))
  res.sendStatus(204)
}

export async function createConnection(req, res) {
  if (!requireEnabled(res)) return
  const provider = getCatalogProvider(req.body.providerId)
  const apiKey = String(req.body.apiKey || '').trim()
  const displayName = String(req.body.displayName || provider?.name || '')
    .trim()
    .slice(0, 80)
  const model = String(req.body.model || provider?.defaultModel || '')
    .trim()
    .slice(0, 150)
  if (
    !provider ||
    !apiKey ||
    apiKey.length > 20000 ||
    !displayName ||
    !model
  ) {
    return res.status(422).json({ message: 'Invalid AI connection' })
  }
  try {
    const item = await AiUserConnection.create({
      userId: userId(req),
      providerId: provider.id,
      displayName,
      credential: encryptCredential(apiKey),
      model,
    })
    res.status(201).json(publicConnection(item))
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message:
          'A connection with this provider and connection name already exists',
      })
    }
    throw error
  }
}

export async function testConnection(req, res) {
  if (!requireEnabled(res)) return
  const provider = getCatalogProvider(req.body.providerId)
  const apiKey = String(req.body.apiKey || '').trim()
  const model = String(req.body.model || provider?.defaultModel || '')
    .trim()
    .slice(0, 150)
  if (!provider || !apiKey || apiKey.length > 20000 || !model) {
    return res.status(422).json({ message: 'Invalid AI connection' })
  }
  try {
    await runProvider({
      adapter: provider.adapter,
      baseUrl: provider.baseUrl,
      apiKey,
      model,
      prompt: 'Reply with the single word OK.',
      content: '',
      selection: '',
      mode: 'ask',
    })
  } catch (error) {
    return sendProviderError(res, error)
  }
  res.json({ ok: true })
}

export async function updateConnection(req, res) {
  if (!requireEnabled(res)) return
  if (!validObjectId(req.params.connectionId)) return res.sendStatus(404)
  const updates = { updatedAt: new Date() }
  if (typeof req.body.displayName === 'string') {
    updates.displayName = req.body.displayName.trim().slice(0, 80)
  }
  if (typeof req.body.model === 'string') {
    updates.model = req.body.model.trim().slice(0, 150)
  }
  if (typeof req.body.enabled === 'boolean') updates.enabled = req.body.enabled
  if (typeof req.body.apiKey === 'string' && req.body.apiKey.trim()) {
    if (req.body.apiKey.trim().length > 20000) {
      return res.status(422).json({ message: 'API key is too large' })
    }
    updates.credential = encryptCredential(req.body.apiKey.trim())
  }
  const item = await AiUserConnection.findOneAndUpdate(
    { _id: req.params.connectionId, userId: userId(req) },
    { $set: updates },
    { new: true }
  )
  if (!item) return res.sendStatus(404)
  res.json(publicConnection(item))
}

export async function deleteConnection(req, res) {
  if (!requireEnabled(res)) return
  if (!validObjectId(req.params.connectionId)) return res.sendStatus(404)
  await AiUserConnection.deleteOne({
    _id: req.params.connectionId,
    userId: userId(req),
  })
  res.sendStatus(204)
}

export async function run(req, res) {
  if (!requireEnabled(res)) return
  const content = String(req.body.content || '')
  const selection = String(req.body.selection || '')
  const prompt = String(req.body.prompt || '').trim()
  const mode = req.body.mode === 'ask' ? 'ask' : 'edit'
  if (
    !prompt ||
    prompt.length > 20000 ||
    selection.length > 50000 ||
    content.length > (Settings.aiMaxDocumentChars || 200000)
  ) {
    return res.status(422).json({ message: 'Invalid AI request' })
  }
  let runtime
  let personal
  const connectionId = String(req.body.connectionId || '')
  const isCodex = connectionId === 'codex'
  if (isCodex) {
    const status = await publicCodexStatus(req)
    if (!status.connected) {
      return res.status(401).json({
        message: 'Connect Codex with ChatGPT in Account settings first',
      })
    }
    runtime = { model: status.model }
  } else if (connectionId.startsWith('system:')) {
    const id = req.body.connectionId.slice(7)
    if (!validObjectId(id)) {
      return res.status(404).json({ message: 'AI provider not found' })
    }
    const shared = await AiSystemProvider.findOne({ _id: id, enabled: true })
    if (!shared) return res.status(404).json({ message: 'AI provider not found' })
    runtime = {
      adapter: shared.adapter,
      baseUrl: shared.baseUrl.replace(/\/$/, ''),
      apiKey: shared.credential
        ? decryptCredential(shared.credential)
        : '',
      model: shared.model,
    }
  } else {
    if (!validObjectId(req.body.connectionId)) {
      return res.status(404).json({ message: 'AI connection not found' })
    }
    personal = await AiUserConnection.findOne({
      _id: req.body.connectionId,
      userId: userId(req),
      enabled: true,
    })
    if (!personal) {
      return res.status(404).json({ message: 'AI connection not found' })
    }
    const provider = getCatalogProvider(personal.providerId)
    if (!provider) {
      return res.status(409).json({ message: 'AI provider is disabled' })
    }
    runtime = {
      adapter: provider.adapter,
      baseUrl: provider.baseUrl,
      apiKey: decryptCredential(personal.credential),
      model: personal.model,
    }
  }
  let result
  const conversation = await AiConversation.findOne({
    userId: userId(req),
    projectId: req.params.project_id,
  })
  let history = (conversation?.messages || []).slice(-12).map(message => ({
    role: message.role,
    content: message.content.slice(0, 20000),
  }))
  while (
    history.length > 2 &&
    history.reduce((size, message) => size + message.content.length, 0) > 40000
  ) {
    // Messages are persisted as user/assistant pairs.
    history = history.slice(2)
  }
  try {
    if (isCodex) {
      const text = await runCodex({
        userId: userId(req),
        model: runtime.model,
        prompt: `${systemPrompt(mode)}\n\nConversation so far:\n${history
          .map(message => `${message.role}: ${message.content}`)
          .join('\n\n')}\n\n${userPrompt({
          prompt,
          content,
          selection,
          mode,
        })}`,
      })
      result = parseAssistantResponse(text, mode)
    } else {
      result = await runProvider({
        ...runtime,
        prompt,
        content,
        selection,
        mode,
        history,
      })
    }
  } catch (error) {
    return sendProviderError(res, error)
  }
  if (
    typeof result.replacement === 'string' &&
    result.replacement.length > (Settings.aiMaxDocumentChars || 200000)
  ) {
    return res.status(422).json({ message: 'AI response is too large' })
  }
  if (personal) {
    personal.lastUsedAt = new Date()
    await personal.save()
  }
  const assistantContent = String(
    mode === 'ask'
      ? result.answer
      : result.explanation || 'An edit proposal was generated.'
  ).slice(0, 50000)
  const updatedConversation = await appendConversationMessages(
    { userId: userId(req), projectId: req.params.project_id },
    [
      { role: 'user', content: prompt, mode },
      { role: 'assistant', content: assistantContent, mode },
    ]
  )
  res.json({
    ...result,
    messages: publicMessages(updatedConversation).slice(-2),
  })
}

export async function applyProjectChanges(req, res) {
  if (!requireEnabled(res)) return
  const projectId = req.params.project_id
  const files = Array.isArray(req.body.files) ? req.body.files : []
  const folders = Array.isArray(req.body.folders) ? req.body.folders : []
  const maxChars = Settings.aiMaxDocumentChars || 200000

  if (
    files.length > 20 ||
    folders.length > 20 ||
    files.some(
      item =>
        !item ||
        typeof item.name !== 'string' ||
        typeof item.content !== 'string' ||
        item.name.length > 149 ||
        item.content.length > maxChars ||
        !SafePath.isCleanFilename(item.name.trim())
    ) ||
    folders.some(
      name =>
        typeof name !== 'string' ||
        !name ||
        name.length > 149 ||
        !SafePath.isCleanFilename(name.trim())
    )
  ) {
    return res.status(422).json({ message: 'Invalid AI file operations' })
  }

  const project = await ProjectGetter.promises.getProject(projectId, {
    rootFolder: 1,
  })
  const rootFolderId = project?.rootFolder?.[0]?._id
  if (!rootFolderId) return res.sendStatus(404)
  const root = project.rootFolder[0]
  const requestedNames = [
    ...folders.map(name => name.trim()),
    ...files.map(item => item.name.trim()),
  ]
  const existingNames = new Set([
    ...(root.docs || []).map(item => item.name),
    ...(root.fileRefs || []).map(item => item.name),
    ...(root.folders || []).map(item => item.name),
  ])
  if (
    new Set(requestedNames).size !== requestedNames.length ||
    requestedNames.some(name => existingNames.has(name))
  ) {
    return res.status(409).json({
      message:
        'One or more proposed files or folders already exist in the project root',
    })
  }

  const actorId = userId(req)
  const created = []
  for (const name of folders) {
    const folder = await EditorController.promises.addFolder(
      projectId,
      rootFolderId,
      name.trim(),
      'ai-assistant',
      actorId
    )
    created.push({ type: 'folder', id: folder._id, name: name.trim() })
  }
  for (const item of files) {
    const name = item.name.trim()
    const doc = await EditorController.promises.addDoc(
      projectId,
      rootFolderId,
      name,
      item.content.split('\n'),
      'ai-assistant',
      actorId
    )
    created.push({ type: 'doc', id: doc._id, name })
  }
  res.status(201).json({ created })
}

export async function adminPage(req, res) {
  if (!requireEnabled(res)) return
  const providers = await AiSystemProvider.find().sort({ name: 1 })
  res.render(
    new URL('../views/admin-ai.pug', import.meta.url).pathname,
    { title: 'AI Providers', providers }
  )
}

export async function saveSystemProvider(req, res) {
  if (!requireEnabled(res)) return
  const name = String(req.body.name || '').trim().slice(0, 80)
  const baseUrl = String(req.body.baseUrl || '').trim()
  const model = String(req.body.model || '').trim().slice(0, 150)
  const adapter = req.body.adapter === 'ollama' ? 'ollama' : 'openai-compatible'
  if (!name || !baseUrl || !model) {
    return res.status(422).send('Name, endpoint and model are required')
  }
  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch {
    return res.status(422).send('Invalid endpoint')
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    return res.status(422).send('Invalid endpoint')
  }
  const data = {
    name,
    adapter,
    baseUrl: parsed.toString().replace(/\/$/, ''),
    model,
    enabled: req.body.enabled === 'on',
    updatedAt: new Date(),
    updatedBy: userId(req),
  }
  const apiKey = String(req.body.apiKey || '').trim()
  if (apiKey.length > 20000) {
    return res.status(422).send('API key is too large')
  }
  if (apiKey) {
    data.credential = encryptCredential(apiKey)
  }
  if (req.params.providerId) {
    if (!validObjectId(req.params.providerId)) return res.sendStatus(404)
    await AiSystemProvider.updateOne(
      { _id: req.params.providerId },
      { $set: data }
    )
  } else {
    await AiSystemProvider.create(data)
  }
  res.redirect('/admin/ai-providers')
}

export async function deleteSystemProvider(req, res) {
  if (!validObjectId(req.params.providerId)) return res.sendStatus(404)
  await AiSystemProvider.deleteOne({ _id: req.params.providerId })
  res.redirect('/admin/ai-providers')
}

export default {
  catalog,
  listConnections,
  createConnection,
  testConnection,
  updateConnection,
  deleteConnection,
  getCodexStatus,
  updateCodexSettings,
  beginCodexLogin,
  getCodexLoginResult,
  disconnectCodex,
  run,
  applyProjectChanges,
  adminPage,
  saveSystemProvider,
  deleteSystemProvider,
}
