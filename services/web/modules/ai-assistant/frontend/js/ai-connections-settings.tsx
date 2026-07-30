import { FormEvent, useCallback, useEffect, useState } from 'react'
import {
  deleteJSON,
  FetchError,
  getJSON,
  postJSON,
} from '@/infrastructure/fetch-json'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import getMeta from '@/utils/meta'
import '../stylesheets/ai-assistant.scss'

type Provider = {
  id: string
  name: string
  defaultModel: string
  models: string[]
}
type Connection = {
  id: string
  providerId: string
  displayName: string
  model: string
  enabled: boolean
}

export default function AiConnectionsSettings() {
  const enabled = getMeta('ol-aiAssistantEnabled')
  const [providers, setProviders] = useState<Provider[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [providerId, setProviderId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [testSuccess, setTestSuccess] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const [catalog, saved] = await Promise.all([
        getJSON<{ providers: Provider[] }>('/api/ai/providers'),
        getJSON<{ personal: Connection[] }>('/api/ai/connections'),
      ])
      setProviders(catalog.providers)
      setConnections(saved.personal)
      if (!providerId && catalog.providers[0]) {
        const first = catalog.providers[0]
        setProviderId(first.id)
        setDisplayName(first.name)
        setModel(first.defaultModel || first.models[0] || '')
      }
    } catch (err) {
      setError(
        err instanceof FetchError
          ? err.getUserFacingMessage()
          : 'Could not load AI connections.'
      )
    } finally {
      setLoading(false)
    }
  }, [enabled, providerId])

  useEffect(() => {
    load()
  }, [load])

  if (!enabled) return null
  if (loading) {
    return (
      <section id="ai-connections" className="ai-connections-settings">
        <h3>AI connections</h3>
        <p className="text-muted">Loading AI connections…</p>
      </section>
    )
  }

  const selectProvider = (id: string) => {
    setTestSuccess(false)
    setProviderId(id)
    const provider = providers.find(item => item.id === id)
    setDisplayName(provider?.name || '')
    setModel(provider?.defaultModel || provider?.models[0] || '')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await postJSON('/api/ai/connections', {
        body: { providerId, displayName, model, apiKey },
      })
      setApiKey('')
      setTestSuccess(false)
      await load()
    } catch (err) {
      setError(
        err instanceof FetchError
          ? err.getUserFacingMessage()
          : 'Could not save the AI connection.'
      )
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    setBusy(true)
    setError(undefined)
    setTestSuccess(false)
    try {
      await postJSON('/api/ai/connections/test', {
        body: { providerId, model, apiKey },
      })
      setTestSuccess(true)
    } catch (err) {
      setError(
        err instanceof FetchError
          ? err.getUserFacingMessage()
          : 'Could not connect to the AI provider.'
      )
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('Remove this AI connection?')) return
    setBusy(true)
    setError(undefined)
    try {
      await deleteJSON(`/api/ai/connections/${id}`)
      await load()
    } catch (err) {
      setError(
        err instanceof FetchError
          ? err.getUserFacingMessage()
          : 'Could not remove the AI connection.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="ai-connections" className="ai-connections-settings">
      <h3>AI connections</h3>
      <p className="text-muted">
        Add your own provider API key. Keys are encrypted and only available to
        your account.
      </p>
      {error ? <OLNotification type="error" content={error} /> : null}
      {testSuccess ? (
        <OLNotification
          type="success"
          content="Connection successful. You can save this API key."
        />
      ) : null}
      {connections.length ? (
        <div className="ai-connection-list">
          {connections.map(connection => (
            <div className="ai-connection-card" key={connection.id}>
              <div className="ai-connection-card-details">
                <strong>{connection.displayName}</strong>
                <div className="ai-connection-meta">
                  {connection.providerId} · {connection.model}
                </div>
              </div>
              <OLButton
                variant="danger-ghost"
                disabled={busy}
                onClick={() => remove(connection.id)}
              >
                Remove
              </OLButton>
            </div>
          ))}
        </div>
      ) : null}
      {!providers.length ? (
        <OLNotification
          type="info"
          content="No personal AI providers are enabled by the administrator."
        />
      ) : (
        <form onSubmit={submit} className="ai-connection-form">
          <div className="row">
            <div className="col-md-6 form-group">
              <label className="form-label" htmlFor="ai-provider">
                Provider
              </label>
              <OLFormSelect
                id="ai-provider"
                value={providerId}
                onChange={event => selectProvider(event.target.value)}
                required
              >
                {providers.map(provider => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </OLFormSelect>
            </div>
            <div className="col-md-6 form-group">
              <label className="form-label" htmlFor="ai-connection-name">
                Connection name
              </label>
              <OLFormControl
                id="ai-connection-name"
                value={displayName}
                onChange={event => setDisplayName(event.target.value)}
                required
              />
            </div>
          </div>
          <div className="row">
            <div className="col-md-6 form-group">
              <label className="form-label" htmlFor="ai-model">
                Model
              </label>
              <OLFormControl
                id="ai-model"
                value={model}
                onChange={event => {
                  setModel(event.target.value)
                  setTestSuccess(false)
                }}
                list="ai-models"
                required
              />
              <datalist id="ai-models">
                {providers
                  .find(item => item.id === providerId)
                  ?.models.map(item => <option value={item} key={item} />)}
              </datalist>
            </div>
            <div className="col-md-6 form-group">
              <label className="form-label" htmlFor="ai-api-key">
                API key
              </label>
              <OLFormControl
                id="ai-api-key"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={event => {
                  setApiKey(event.target.value)
                  setTestSuccess(false)
                }}
                required
              />
            </div>
          </div>
          <div className="ai-connection-form-actions">
            <OLButton
              type="button"
              variant="secondary"
              disabled={busy || !apiKey || !model}
              onClick={testConnection}
            >
              Test connection
            </OLButton>
            <OLButton type="submit" variant="primary" disabled={busy}>
              {busy ? 'Working…' : 'Add AI connection'}
            </OLButton>
          </div>
        </form>
      )}
    </section>
  )
}
