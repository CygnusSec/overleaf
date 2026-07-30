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
  putJSON,
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
  models: string[]
  shared?: boolean
}
type CodexStatus = {
  connected: boolean
  accountLabel?: string | null
  model?: string
  models?: string[]
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
  const [model, setModel] = useState('')
  const [mode, setMode] = useState<'ask' | 'edit'>('ask')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [proposal, setProposal] = useState<{
    explanation: string
    edits: Array<{
      startLine: number
      endLine: number
      replacement: string
    }>
    files: Array<{ name: string; content: string }>
    folders: string[]
    sourceContent: string
  }>()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const loadRequestRef = useRef(0)
  const modelRequestRef = useRef(0)
  const projectIdRef = useRef(projectId)
  const requestInFlightRef = useRef(false)
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
    requestInFlightRef.current = false
    setError(undefined)
    setProposal(undefined)
    setMessages([])
    try {
      const result = await getJSON<{
        personal: Connection[]
        shared: Connection[]
        codex?: CodexStatus
      }>('/api/ai/connections')
      if (requestId !== loadRequestRef.current) return
      const codex = result.codex?.connected
        ? [
            {
              id: 'codex',
              displayName: 'Codex',
              model: result.codex.model || 'ChatGPT',
              models: result.codex.models || [result.codex.model || 'ChatGPT'],
            },
          ]
        : []
      const items = [...codex, ...result.shared, ...result.personal].map(
        item => ({
          ...item,
          models: item.models?.length ? item.models : [item.model],
        })
      )
      setConnections(items)
      setConnectionId(items[0]?.id || '')
      setModel(items[0]?.model || '')
      try {
        const conversation = await getJSON<{ messages: ChatMessage[] }>(
          `/project/${projectId}/ai/conversation`
        )
        if (requestId !== loadRequestRef.current) return
        setMessages(conversation.messages)
      } catch {
        // A missing/unavailable history endpoint must not hide valid AI
        // connections, including an already authenticated Codex account.
        if (requestId !== loadRequestRef.current) return
        setMessages([])
      }
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
    if (requestInFlightRef.current) return
    const content = getCurrentDocValue()
    if (!content || !prompt.trim()) return
    requestInFlightRef.current = true
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
        edits?: Array<{
          startLine: number
          endLine: number
          replacement: string
        }>
        files?: Array<{ name: string; content: string }>
        folders?: string[]
        messages?: ChatMessage[]
      }>(`/project/${projectId}/ai/run`, {
        body: { connectionId, model, mode, prompt, content, selection },
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
          edits: result.edits || [],
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
        requestInFlightRef.current = false
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

  const changeModel = async (nextModel: string) => {
    const requestId = ++modelRequestRef.current
    const previousModel = model
    setModel(nextModel)
    setError(undefined)
    if (connectionId !== 'codex') return
    try {
      const status = await putJSON<CodexStatus>('/api/ai/codex', {
        body: { model: nextModel },
      })
      if (requestId !== modelRequestRef.current) return
      setModel(status.model || nextModel)
      setConnections(current =>
        current.map(item =>
          item.id === 'codex'
            ? { ...item, model: status.model || nextModel }
            : item
        )
      )
    } catch (err) {
      if (requestId !== modelRequestRef.current) return
      setModel(previousModel)
      setError(
        err instanceof FetchError
          ? err.getUserFacingMessage()
          : 'Could not change the Codex model.'
      )
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
    const edits = [...proposal.edits].sort(
      (left, right) => left.startLine - right.startLine
    )
    const invalidEdit = edits.some(
      (edit, index) =>
        !Number.isSafeInteger(edit.startLine) ||
        !Number.isSafeInteger(edit.endLine) ||
        edit.startLine < 1 ||
        edit.endLine < edit.startLine ||
        edit.endLine > view.state.doc.lines ||
        (index > 0 && edit.startLine <= edits[index - 1].endLine)
    )
    if (invalidEdit) {
      setError(
        'The AI returned an invalid or overlapping line change. No changes were applied.'
      )
      return
    }
    if (
      !window.confirm(
        `Apply ${edits.length} line edit(s), create ${proposal.files.length} file(s), and create ${proposal.folders.length} folder(s)?`
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
      if (edits.length) {
        view.dispatch({
          changes: edits.map(edit => ({
            from: view.state.doc.line(edit.startLine).from,
            to: view.state.doc.line(edit.endLine).to,
            insert: edit.replacement,
          })),
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
              {proposal.edits.length ? (
                <details className="ai-proposal-details">
                  <summary>
                    Review line changes ({proposal.edits.length})
                  </summary>
                  {proposal.edits.map((edit, index) => (
                    <div
                      className="ai-proposal-line-edit"
                      key={`${edit.startLine}-${edit.endLine}-${index}`}
                    >
                      <strong>
                        {edit.startLine === edit.endLine
                          ? `Line ${edit.startLine}`
                          : `Lines ${edit.startLine}-${edit.endLine}`}
                      </strong>
                      <pre className="ai-proposal-code">
                        {edit.replacement || '(remove line content)'}
                      </pre>
                    </div>
                  ))}
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
                    (!proposal.edits.length &&
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
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
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
                <span className="visually-hidden">Mode</span>
                <select
                  value={mode}
                  onChange={event =>
                    setMode(event.target.value as 'ask' | 'edit')
                  }
                  aria-label="AI mode"
                  disabled={busy}
                >
                  <option value="ask">Ask</option>
                  <option value="edit">Edit</option>
                </select>
              </label>
              <label className="ai-compact-select ai-agent-select">
                <MaterialIcon type="smart_toy" />
                <span className="visually-hidden">AI agent</span>
                <select
                  value={connectionId}
                  onChange={event => {
                    const next = connections.find(
                      item => item.id === event.target.value
                    )
                    if (!next) return
                    modelRequestRef.current += 1
                    setConnectionId(next.id)
                    setModel(next.model)
                  }}
                  aria-label="AI agent"
                  disabled={busy}
                >
                  {connections.map(item => (
                    <option value={item.id} key={item.id}>
                      {item.shared ? 'Shared · ' : ''}
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ai-compact-select ai-model-select">
                <MaterialIcon type="bolt" />
                <span className="visually-hidden">Model</span>
                <select
                  value={model}
                  onChange={event => changeModel(event.target.value)}
                  aria-label="AI model"
                  disabled={busy}
                >
                  {(connections.find(item => item.id === connectionId)
                    ?.models || [model]
                  ).map(item => (
                    <option value={item} key={item}>
                      {item}
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
