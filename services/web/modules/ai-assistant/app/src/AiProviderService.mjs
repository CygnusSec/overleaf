import Settings from '@overleaf/settings'

const VALID_ADAPTERS = new Set([
  'openai',
  'openai-compatible',
  'anthropic',
  'gemini',
  'ollama',
])

export class AiProviderError extends Error {
  constructor(message, statusCode) {
    super(message)
    this.name = 'AiProviderError'
    this.statusCode = statusCode
  }
}

function safeBaseUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('AI provider URL must use http or https')
  }
  return url.toString().replace(/\/$/, '')
}

export function providerCatalog() {
  const catalog = Array.isArray(Settings.aiProvidersConfig)
    ? Settings.aiProvidersConfig
    : []
  return catalog
    .filter(item => item && item.enabled !== false)
    .map(item => {
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(item.id || '')) {
        throw new Error(`Invalid AI provider id: ${item.id}`)
      }
      if (!VALID_ADAPTERS.has(item.adapter)) {
        throw new Error(`Unsupported AI adapter: ${item.adapter}`)
      }
      return {
        id: item.id,
        name: String(item.name || item.id).slice(0, 80),
        adapter: item.adapter,
        baseUrl: safeBaseUrl(item.baseUrl),
        defaultModel: String(item.defaultModel || '').slice(0, 150),
        models: Array.isArray(item.models)
          ? item.models.map(String).slice(0, 100)
          : [],
      }
    })
}

export function getCatalogProvider(providerId) {
  return providerCatalog().find(item => item.id === providerId)
}

async function fetchJson(url, options) {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    Settings.aiRequestTimeoutMs || 120000
  )
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const body = await response.text()
    let data
    try {
      data = body ? JSON.parse(body) : {}
    } catch {
      data = {}
    }
    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        `AI provider returned HTTP ${response.status}`
      throw new AiProviderError(String(message).slice(0, 1000), response.status)
    }
    return data
  } catch (error) {
    if (error instanceof AiProviderError) throw error
    if (error?.name === 'AbortError') {
      throw new AiProviderError('AI provider request timed out', 504)
    }
    throw new AiProviderError(
      'Could not connect to the AI provider. Check its endpoint and network access.',
      502
    )
  } finally {
    clearTimeout(timeout)
  }
}

export function systemPrompt(mode) {
  const base =
    'You are a LaTeX assistant inside Overleaf. Be precise and preserve document semantics. Never invent project files or claim that a change was applied.'
  if (mode === 'ask') return `${base} Answer the user clearly.`
  return `${base}
Return JSON only, with this exact shape:
{"explanation":"short explanation","edits":[{"startLine":3,"endLine":3,"replacement":"replacement text for exactly these lines"}],"files":[{"name":"new-file.tex","content":"complete file content"}],"folders":["new-folder"]}
Line numbers are 1-based and inclusive. Each edit must cover only the smallest
line range required by the request. Never return the complete current document
as an edit, and never modify unrelated lines. The replacement is plain text for
exactly that line range, without Markdown fences or the read-only line-number
prefixes shown in the user prompt. Return an empty edits array when the current
file does not need a change. Use files to propose new project files and folders
to propose new top-level folders. File and folder names must be clean base names
without path separators. Do not delete or overwrite existing project files.`
}

export function userPrompt({ prompt, content, selection, mode }) {
  const numberedContent = content
    .split('\n')
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n')
  return `Request:
${prompt}

Mode: ${mode}
${selection ? `Selected text:\n${selection}\n` : ''}
Current LaTeX with read-only line-number prefixes:
${numberedContent}`
}

export async function runProvider({
  adapter,
  baseUrl,
  apiKey,
  model,
  prompt,
  content,
  selection,
  mode,
  history = [],
}) {
  const messages = [
    { role: 'system', content: systemPrompt(mode) },
    ...history,
    {
      role: 'user',
      content: userPrompt({ prompt, content, selection, mode }),
    },
  ]
  let text
  if (adapter === 'ollama') {
    const data = await fetchJson(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, stream: false }),
    })
    text = data.message?.content || ''
  } else if (adapter === 'anthropic') {
    const data = await fetchJson(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: messages[0].content,
        messages: messages.slice(1),
      }),
    })
    text = data.content?.map(item => item.text || '').join('') || ''
  } else if (adapter === 'gemini') {
    const data = await fetchJson(
      `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: messages[0].content }] },
          contents: messages.slice(1).map(message => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          generationConfig: { maxOutputTokens: 8192 },
        }),
      }
    )
    text =
      data.candidates?.[0]?.content?.parts
        ?.map(item => item.text || '')
        .join('') || ''
  } else {
    const data = await fetchJson(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, temperature: 0.2 }),
    })
    const contentValue = data.choices?.[0]?.message?.content
    text = Array.isArray(contentValue)
      ? contentValue.map(item => item?.text || '').join('')
      : contentValue || ''
  }
  return parseAssistantResponse(text, mode)
}

export function parseAssistantResponse(text, mode) {
  if (!text) {
    throw new AiProviderError('AI provider returned an empty response', 502)
  }
  if (mode === 'ask') return { answer: text }
  let normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  if (!normalized.startsWith('{')) {
    const firstBrace = normalized.indexOf('{')
    const lastBrace = normalized.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      normalized = normalized.slice(firstBrace, lastBrace + 1)
    }
  }
  try {
    const parsed = JSON.parse(normalized)
    if (
      !Array.isArray(parsed.edits) ||
      parsed.edits.length > 50 ||
      parsed.edits.some(
        edit =>
          !edit ||
          !Number.isSafeInteger(edit.startLine) ||
          !Number.isSafeInteger(edit.endLine) ||
          edit.startLine < 1 ||
          edit.endLine < edit.startLine ||
          typeof edit.replacement !== 'string'
      )
    ) {
      throw new Error('AI returned malformed edits')
    }
    const edits = parsed.edits
      .map(edit => ({
        startLine: edit.startLine,
        endLine: edit.endLine,
        replacement: edit.replacement,
      }))
      .sort((left, right) => left.startLine - right.startLine)
    for (let index = 1; index < edits.length; index++) {
      if (edits[index].startLine <= edits[index - 1].endLine) {
        throw new Error('AI returned overlapping edits')
      }
    }
    return {
      explanation: String(parsed.explanation || ''),
      edits,
      files: Array.isArray(parsed.files)
        ? parsed.files
            .filter(
              item =>
                item &&
                typeof item.name === 'string' &&
                typeof item.content === 'string'
            )
            .slice(0, 20)
            .map(item => ({
              name: item.name,
              content: item.content,
            }))
        : [],
      folders: Array.isArray(parsed.folders)
        ? parsed.folders.filter(item => typeof item === 'string').slice(0, 20)
        : [],
    }
  } catch {
    throw new AiProviderError(
      'AI provider returned an invalid edit response',
      502
    )
  }
}
