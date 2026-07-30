import Settings from '@overleaf/settings'

const VALID_ADAPTERS = new Set([
  'openai',
  'openai-compatible',
  'anthropic',
  'gemini',
  'ollama',
])

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
        data?.error?.message || data?.message || `AI returned HTTP ${response.status}`
      throw new Error(String(message).slice(0, 1000))
    }
    return data
  } finally {
    clearTimeout(timeout)
  }
}

function systemPrompt(mode) {
  const base =
    'You are a LaTeX assistant inside Overleaf. Be precise and preserve document semantics. Never invent project files or claim that a change was applied.'
  if (mode === 'ask') return `${base} Answer the user clearly.`
  return `${base}
Return JSON only, with this exact shape:
{"explanation":"short explanation","replacement":"complete replacement text"}
The replacement must contain the complete revised input text, without Markdown fences.`
}

function userPrompt({ prompt, content, selection, mode }) {
  return `Request:
${prompt}

Mode: ${mode}
${selection ? `Selected text:\n${selection}\n` : ''}
Current LaTeX:
${content}`
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
}) {
  const messages = [
    { role: 'system', content: systemPrompt(mode) },
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
        messages: [messages[1]],
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
          contents: [{ role: 'user', parts: [{ text: messages[1].content }] }],
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
  if (!text) throw new Error('AI provider returned an empty response')
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
    if (typeof parsed.replacement !== 'string') throw new Error()
    return {
      explanation: String(parsed.explanation || ''),
      replacement: parsed.replacement,
    }
  } catch {
    throw new Error('AI provider returned an invalid edit response')
  }
}
