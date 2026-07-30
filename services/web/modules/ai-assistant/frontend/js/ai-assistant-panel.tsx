import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  deleteJSON,
  FetchError,
  getJSON,
  postJSON,
} from '@/infrastructure/fetch-json'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import MaterialIcon from '@/shared/components/material-icon'
import getMeta from '@/utils/meta'
import '../stylesheets/ai-assistant.scss'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'

type Connection = {
  id: string
  displayName: string
  model: string
  shared?: boolean
}
type CodexStatus = {
  connected: boolean
  accountLabel?: string | null
  model?: string
}
type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  mode: 'ask' | 'edit'
  createdAt: string
}

export default function AiAssistantPanel() {
  const enabled = getMeta('ol-aiAssistantEnabled')
  const { projectId, permissionsLevel } = useIdeReactContext()
  const { getCurrentDocValue } = useEditorManagerContext()
  const { view } = useEditorViewContext()
  const [connections, setConnections] = useState<Connection[]>([])
  const [connectionId, setConnectionId] = useState('')
  const [mode, setMode] = useState<'ask' | 'edit'>('ask')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [proposal, setProposal] = useState<{
    explanation: string
    replacement: string | null
    files: Array<{ name: string; content: string }>
    folders: string[]
    sourceContent: string
  }>()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const loadRequestRef = useRef(0)
  const projectIdRef = useRef(projectId)
  const canWrite =
    permissionsLevel === 'owner' || permissionsLevel === 'readAndWrite'

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    projectIdRef.current = projectId
    if (!enabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    setBusy(false)
    setError(undefined)
    setProposal(undefined)
    setMessages([])
    try {
      const [result, conversation] = await Promise.all([
        getJSON<{
          personal: Connection[]
          shared: Connection[]
          codex?: CodexStatus
        }>('/api/ai/connections'),
        getJSON<{ messages: ChatMessage[] }>(
          `/project/${projectId}/ai/conversation`
        ),
      ])
      if (requestId !== loadRequestRef.current) return
      const codex = result.codex?.connected
        ? [
            {
              id: 'codex',
              displayName: 'Codex',
              model: result.codex.model || 'ChatGPT',
            },
          ]
        : []
      const items = [...codex, ...result.shared, ...result.personal]
      setConnections(items)
      setConnectionId(current =>
        items.some(item => item.id === current)
          ? current
          : items[0]?.id || ''
      )
      setMessages(conversation.messages)
    } catch (err) {
      if (requestId !== loadRequestRef.current) return
      setConnections([])
      setMessages([])
      setError(
        err instanceof FetchError
          ? err.getUserFacingMessage()
          : 'Could not load AI connections.'
      )
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false)
      }
    }
  }, [enabled, projectId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, proposal])

  if (!enabled) return null

  if (loading) {
    return (
      <div className="ai-assistant-layout">
        <RailPanelHeader title="AI Assistant" />
        <div className="ai-assistant-panel">
          <div className="ai-assistant-state">
            <div className="ai-assistant-heading">
              <span className="ai-status-badge">Loading connections…</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!connections.length) {
    return (
      <div className="ai-assistant-layout">
        <RailPanelHeader title="AI Assistant" />
        <div className="ai-assistant-panel">
          <div className="ai-assistant-state">
            {error ? <OLNotification type="error" content={error} /> : null}
            <p className="text-muted">
              Add an AI connection in Account settings, or ask an administrator
              to enable a shared Local AI provider.
            </p>
            <OLButton variant="secondary" href="/user/settings#ai-connections">
              Open Account settings
            </OLButton>
          </div>
        </div>
      </div>
    )
  }

  const run = async (event: FormEvent) => {
    event.preventDefault()
    const content = getCurrentDocValue()
    if (!content || !prompt.trim()) return
    const requestProjectId = projectId
    const selection =
      view && !view.state.selection.main.empty
        ? view.state.sliceDoc(
            view.state.selection.main.from,
            view.state.selection.main.to
          )
        : ''
    setBusy(true)
    setError(undefined)
    setProposal(undefined)
    const pendingMessage: ChatMessage = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content: prompt.trim(),
      mode,
      createdAt: new Date().toISOString(),
    }
    setMessages(current => [...current, pendingMessage])
    setPrompt('')
    try {
      const result = await postJSON<{
        answer?: string
        explanation?: string
        replacement?: string | null
        files?: Array<{ name: string; content: string }>
        folders?: string[]
        messages?: ChatMessage[]
      }>(`/project/${projectId}/ai/run`, {
        body: { connectionId, mode, prompt, content, selection },
      })
      if (projectIdRef.current !== requestProjectId) return
      const newMessages = result.messages || []
      const assistantMessages = newMessages.filter(
        message => message.role === 'assistant'
      )
      setMessages(current => [
        ...current,
        ...(assistantMessages.length
          ? assistantMessages
          : [
              {
                id: `assistant-${Date.now()}`,
                role: 'assistant' as const,
                content:
                  mode === 'ask'
                    ? result.answer || ''
                    : result.explanation || 'An edit proposal was generated.',
                mode,
                createdAt: new Date().toISOString(),
              },
            ]),
      ])
      if (mode === 'edit') {
        setProposal({
          explanation: result.explanation || '',
          replacement:
            typeof result.replacement === 'string' ? result.replacement : null,
          files: result.files || [],
          folders: result.folders || [],
          sourceContent: content,
        })
      }
    } catch (err) {
      if (projectIdRef.current !== requestProjectId) return
      setMessages(current =>
        current.filter(message => message.id !== pendingMessage.id)
      )
      setPrompt(pendingMessage.content)
      setError(
        err instanceof FetchError
          ? err.getUserFacingMessage()
          : 'The AI request failed.'
      )
    } finally {
      if (projectIdRef.current === requestProjectId) {
        setBusy(false)
      }
    }
  }

  const clearConversation = async () => {
    if (
      !messages.length ||
      !window.confirm('Clear this AI conversation for the current project?')
    ) {
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await deleteJSON(`/project/${projectId}/ai/conversation`)
      setMessages([])
      setProposal(undefined)
    } catch (err) {
      setError(
        err instanceof FetchError
          ? err.getUserFacingMessage()
          : 'Could not clear the AI conversation.'
      )
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!view || !proposal || !canWrite) return
    const current = view.state.doc.toString()
    if (current !== proposal.sourceContent) {
      setError(
        'This document changed while the AI was working. Generate a new proposal to avoid overwriting newer edits.'
      )
      setProposal(undefined)
      return
    }
    if (
      !window.confirm(
        `Apply this AI proposal? It may update the current file and create ${proposal.files.length} file(s) and ${proposal.folders.length} folder(s).`
      )
    ) {
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      if (proposal.files.length || proposal.folders.length) {
        await postJSON(`/project/${projectId}/ai/apply`, {
          body: { files: proposal.files, folders: proposal.folders },
        })
      }
      if (typeof proposal.replacement === 'string') {
        view.dispatch({
          changes: {
            from: 0,
            to: current.length,
            insert: proposal.replacement,
          },
        })
      }
      setProposal(undefined)
    } catch (err) {
      setError(
        err instanceof FetchError
          ? err.getUserFacingMessage()
          : 'Could not apply the AI file operations.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-assistant-layout">
      <RailPanelHeader
        title="AI Assistant"
        actions={
          messages.length ? (
            <button
              type="button"
              className="ai-header-action"
              onClick={clearConversation}
              disabled={busy}
              title="Clear conversation"
              aria-label="Clear conversation"
            >
              <MaterialIcon type="delete" />
            </button>
          ) : null
        }
      />
      <div className="ai-assistant-panel">
        {error ? <OLNotification type="error" content={error} /> : null}
        <div className="ai-conversation-scroll">
          {messages.length ? (
            <div className="ai-conversation" aria-live="polite">
              {messages.map(message => (
                <div
                  className={`ai-chat-message ai-chat-message-${message.role}`}
                  key={message.id}
                >
                  <div className="ai-chat-message-role">
                    {message.role === 'user' ? 'You' : 'AI'}
                    {message.mode === 'edit' ? ' · Edit' : ''}
                  </div>
                  <div className="ai-chat-message-content">
                    {message.content}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ai-conversation-empty">
              <MaterialIcon type="smart_toy" className="ai-empty-icon" />
              <strong>How can I help with this document?</strong>
              <span>
                Ask a question or request a reviewed LaTeX change.
              </span>
            </div>
          )}
          {proposal ? (
            <div className="ai-proposal-card">
              <div className="ai-proposal-summary">
                <div>
                  <strong>Proposed change</strong>
                  <p>{proposal.explanation}</p>
                </div>
                <span className="ai-proposal-count">Review</span>
              </div>
              {typeof proposal.replacement === 'string' ? (
                <details className="ai-proposal-details">
                  <summary>Review current file update</summary>
                  <pre className="ai-proposal-code">
                    {proposal.replacement}
                  </pre>
                </details>
              ) : null}
              {proposal.files.length || proposal.folders.length ? (
                <details className="ai-proposal-details">
                  <summary>
                    Review new files and folders (
                    {proposal.files.length + proposal.folders.length})
                  </summary>
                  {proposal.folders.length ? (
                    <>
                      <strong>Folders</strong>
                      <ul>
                        {proposal.folders.map(name => (
                          <li key={name}>{name}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {proposal.files.length ? (
                    <>
                      <strong>Files</strong>
                      <ul>
                        {proposal.files.map(file => (
                          <li key={file.name}>{file.name}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </details>
              ) : null}
              <div className="ai-proposal-actions">
                <OLButton
                  variant="primary"
                  size="sm"
                  onClick={apply}
                  disabled={
                    !canWrite ||
                    busy ||
                    (proposal.replacement === null &&
                      !proposal.files.length &&
                      !proposal.folders.length)
                  }
                >
                  Apply changes
                </OLButton>
                <OLButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setProposal(undefined)}
                >
                  Reject
                </OLButton>
              </div>
            </div>
          ) : null}
          {busy ? (
            <div className="ai-thinking">
              <span className="ai-thinking-dot" />
              Thinking…
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>
        <form className="ai-composer" onSubmit={run}>
          <div className="ai-composer-input">
            <textarea
              id="ai-editor-prompt"
              rows={3}
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder={
                mode === 'edit'
                  ? 'Ask for changes…'
                  : 'Ask about this document…'
              }
              aria-label="Message AI Assistant"
              required
            />
          </div>
          <div className="ai-composer-toolbar">
            <div className="ai-composer-options">
              <label className="ai-compact-select">
                <MaterialIcon type={mode === 'edit' ? 'edit' : 'chat'} />
                <span className="visually-hidden">Agent</span>
                <select
                  value={mode}
                  onChange={event =>
                    setMode(event.target.value as 'ask' | 'edit')
                  }
                  aria-label="AI agent"
                >
                  <option value="ask">Ask</option>
                  <option value="edit">Edit</option>
                </select>
              </label>
              <label className="ai-compact-select ai-model-select">
                <MaterialIcon type="bolt" />
                <span className="visually-hidden">Model</span>
                <select
                  value={connectionId}
                  onChange={event => setConnectionId(event.target.value)}
                  aria-label="AI model"
                >
                  {connections.map(item => (
                    <option value={item.id} key={item.id}>
                      {item.displayName} · {item.model}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="submit"
              className="ai-send-button"
              disabled={busy || !connectionId || !prompt.trim()}
              aria-label={busy ? 'AI is working' : 'Send message'}
              title={busy ? 'AI is working' : 'Send message'}
            >
              <MaterialIcon type={busy ? 'hourglass_top' : 'arrow_upward'} />
            </button>
          </div>
          <div className="ai-composer-hint">
            Enter to send · Shift+Enter for a new line
          </div>
        </form>
      </div>
    </div>
  )
}
