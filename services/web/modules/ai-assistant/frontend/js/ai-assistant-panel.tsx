import { FormEvent, useCallback, useEffect, useState } from 'react'
import { FetchError, getJSON, postJSON } from '@/infrastructure/fetch-json'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import getMeta from '@/utils/meta'
import '../stylesheets/ai-assistant.scss'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'

type Connection = {
  id: string
  displayName: string
  model: string
  shared?: boolean
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
  const [answer, setAnswer] = useState('')
  const [proposal, setProposal] = useState<{
    explanation: string
    replacement: string
    sourceContent: string
  }>()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
    try {
      const result = await getJSON<{
        personal: Connection[]
        shared: Connection[]
      }>('/api/ai/connections')
      const items = [...result.shared, ...result.personal]
      setConnections(items)
      setConnectionId(current => current || items[0]?.id || '')
    } catch (err) {
      setError(
        err instanceof FetchError
          ? err.getUserFacingMessage()
          : 'Could not load AI connections.'
      )
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    load()
  }, [load])

  if (!enabled) return null

  if (loading) {
    return (
      <>
        <RailPanelHeader title="AI Assistant" />
        <div className="ai-assistant-panel">
          <div className="ai-assistant-heading">
            <span className="ai-status-badge">Loading connections…</span>
          </div>
        </div>
      </>
    )
  }

  if (!connections.length) {
    return (
      <>
        <RailPanelHeader title="AI Assistant" />
        <div className="ai-assistant-panel">
          {error ? <OLNotification type="error" content={error} /> : null}
          <p className="text-muted">
            Add an AI connection in Account settings, or ask an administrator
            to enable a shared Local AI provider.
          </p>
          <OLButton variant="secondary" href="/user/settings#ai-connections">
            Open Account settings
          </OLButton>
        </div>
      </>
    )
  }

  const run = async (event: FormEvent) => {
    event.preventDefault()
    const content = getCurrentDocValue()
    if (!content || !prompt.trim()) return
    const selection =
      view && !view.state.selection.main.empty
        ? view.state.sliceDoc(
            view.state.selection.main.from,
            view.state.selection.main.to
          )
        : ''
    setBusy(true)
    setError(undefined)
    setAnswer('')
    setProposal(undefined)
    try {
      const result = await postJSON<{
        answer?: string
        explanation?: string
        replacement?: string
      }>(`/project/${projectId}/ai/run`, {
        body: { connectionId, mode, prompt, content, selection },
      })
      if (mode === 'ask') setAnswer(result.answer || '')
      else if (typeof result.replacement === 'string') {
        setProposal({
          explanation: result.explanation || '',
          replacement: result.replacement,
          sourceContent: content,
        })
      }
    } catch (err) {
      setError(
        err instanceof FetchError
          ? err.getUserFacingMessage()
          : 'The AI request failed.'
      )
    } finally {
      setBusy(false)
    }
  }

  const apply = () => {
    if (!view || !proposal || permissionsLevel === 'readOnly') return
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
        'Apply the proposed replacement to the currently open document?'
      )
    ) {
      return
    }
    view.dispatch({
      changes: { from: 0, to: current.length, insert: proposal.replacement },
    })
    setProposal(undefined)
    setAnswer('The proposed change was applied to the current document.')
  }

  return (
    <>
      <RailPanelHeader
        title="AI Assistant"
        actions={
          <span className="ai-status-badge">
            {connections.length} available
          </span>
        }
      />
      <div className="ai-assistant-panel">
        <p className="small text-muted">
          AI can make mistakes. Review every proposed LaTeX change before
          applying it.
        </p>
        {error ? <OLNotification type="error" content={error} /> : null}
        <form onSubmit={run}>
          <div className="form-group">
            <label className="form-label" htmlFor="ai-editor-connection">
              AI connection
            </label>
            <OLFormSelect
              id="ai-editor-connection"
              value={connectionId}
              onChange={event => setConnectionId(event.target.value)}
            >
              {connections.map(item => (
                <option value={item.id} key={item.id}>
                  {item.shared ? 'Shared · ' : 'My · '}
                  {item.displayName} · {item.model}
                </option>
              ))}
            </OLFormSelect>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ai-editor-mode">
              Mode
            </label>
            <OLFormSelect
              id="ai-editor-mode"
              value={mode}
              onChange={event => setMode(event.target.value as 'ask' | 'edit')}
            >
              <option value="ask">Ask about this document</option>
              <option value="edit">Propose a LaTeX edit</option>
            </OLFormSelect>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ai-editor-prompt">
              Request
            </label>
            <textarea
              id="ai-editor-prompt"
              className="form-control"
              rows={5}
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              placeholder="Explain this equation, improve the selected text, or fix the LaTeX…"
              required
            />
          </div>
          <OLButton
            type="submit"
            variant="primary"
            disabled={busy || !connectionId}
            className="w-100"
          >
            {busy
              ? 'Working…'
              : mode === 'ask'
                ? 'Ask AI'
                : 'Generate proposal'}
          </OLButton>
        </form>
        {answer ? (
          <div className="ai-response-card">
            <div className="ai-response-content">{answer}</div>
          </div>
        ) : null}
        {proposal ? (
          <div className="ai-proposal-card">
            <h4>Proposed change</h4>
            <p>{proposal.explanation}</p>
            <pre className="ai-proposal-code">{proposal.replacement}</pre>
            <div className="ai-proposal-actions">
              <OLButton
                variant="primary"
                onClick={apply}
                disabled={permissionsLevel === 'readOnly'}
              >
                Apply to current file
              </OLButton>
              <OLButton
                variant="secondary"
                onClick={() => setProposal(undefined)}
              >
                Reject
              </OLButton>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
