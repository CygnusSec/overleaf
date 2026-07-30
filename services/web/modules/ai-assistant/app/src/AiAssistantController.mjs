import Settings from '@overleaf/settings'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import { AiSystemProvider, AiUserConnection } from './AiModels.mjs'
import { decryptCredential, encryptCredential } from './AiCrypto.mjs'
import {
  getCatalogProvider,
  providerCatalog,
  runProvider,
} from './AiProviderService.mjs'

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
  })
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
  if (String(req.body.connectionId || '').startsWith('system:')) {
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
  const result = await runProvider({
    ...runtime,
    prompt,
    content,
    selection,
    mode,
  })
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
  res.json(result)
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
  const parsed = new URL(baseUrl)
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
  run,
  adminPage,
  saveSystemProvider,
  deleteSystemProvider,
}
