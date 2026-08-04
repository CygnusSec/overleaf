import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  deleteJSON,
  FetchError,
  getJSON,
  postJSON,
} from '@/infrastructure/fetch-json'
import { useLocation } from '@/shared/hooks/use-location'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import SyncPathSelector from './sync-path-selector'

type Repository = {
  id: number
  fullName: string
  private: boolean
  defaultBranch: string
  canPush: boolean
}

export default function GithubImportModal({ onHide }: { onHide: () => void }) {
  const { t } = useTranslation()
  const location = useLocation()
  const [connection, setConnection] = useState<{
    connected: boolean
    configured: boolean
    login?: string
  }>()
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [repository, setRepository] = useState('')
  const [projectName, setProjectName] = useState('')
  const [syncPath, setSyncPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    getJSON<{ connected: boolean; configured: boolean; login?: string }>(
      '/api/github/status'
    )
      .then(async status => {
        setConnection(status)
        if (status.connected) {
          const result = await getJSON<{ repositories: Repository[] }>(
            '/api/github/repositories'
          )
          setRepositories(result.repositories)
        }
      })
      .catch(() => setError(t('github_sync_error')))
  }, [t])

  const selected = repositories.find(item => item.fullName === repository)

  const disconnectGithub = async () => {
    if (!window.confirm(t('unlink_github_warning'))) return
    setLoading(true)
    setError(undefined)
    try {
      await deleteJSON('/api/github/connection', {})
      setConnection({ connected: false, configured: true })
      setRepositories([])
      setRepository('')
      setProjectName('')
      setSyncPath('')
    } catch (error) {
      setError(
        error instanceof FetchError
          ? error.getUserFacingMessage()
          : t('github_sync_error')
      )
    } finally {
      setLoading(false)
    }
  }

  const importRepository = async () => {
    if (!selected) return
    setLoading(true)
    setError(undefined)
    try {
      const result = await postJSON<{ projectId: string }>(
        '/api/github/import',
        {
          body: {
            repositoryFullName: selected.fullName,
            branch: selected.defaultBranch,
            projectName: projectName || selected.fullName.split('/').pop(),
            syncPath: syncPath.trim(),
          },
        }
      )
      location.assign(`/project/${result.projectId}`)
    } catch (error) {
      setError(
        error instanceof FetchError
          ? error.getUserFacingMessage()
          : t('github_sync_error')
      )
      setLoading(false)
    }
  }

  return (
    <OLModal
      show
      animation
      onHide={onHide}
      size="lg"
      backdrop="static"
      className="ide-dark-modal github-sync-modal"
    >
      <OLModalHeader>
        <OLModalTitle>{t('import_from_github')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <p className="github-sync-modal-description">
          {t('github_sync_description')}
        </p>
        {error ? <OLNotification type="error" content={error} /> : null}
        {connection?.configured === false ? (
          <OLNotification
            type="warning"
            content="GitHub Sync has not been configured by the administrator."
          />
        ) : connection?.connected === false ? (
          <div className="github-sync-connect-state">
            <div className="github-sync-mark" aria-hidden="true">
              GH
            </div>
            <h3>Connect your GitHub account</h3>
            <p>{t('link_to_github_description')}</p>
            <OLButton
              variant="primary"
              onClick={() =>
                location.assign(
                  `/oauth/github?returnTo=${encodeURIComponent('/project')}`
                )
              }
            >
              {t('link_to_github')}
            </OLButton>
          </div>
        ) : connection?.connected ? (
          <>
            <div className="github-sync-account">
              <div className="github-sync-account-identity">
                <span className="github-sync-account-avatar" aria-hidden="true">
                  {connection.login?.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <span className="github-sync-account-label">
                    Connected GitHub account
                  </span>
                  <strong>@{connection.login}</strong>
                </span>
              </div>
              <OLButton
                variant="danger-ghost"
                disabled={loading}
                onClick={disconnectGithub}
              >
                Disconnect GitHub
              </OLButton>
            </div>
            <div className="github-sync-form">
              <div>
                <label htmlFor="github-repository" className="form-label">
                  GitHub repository
                </label>
                <select
                  id="github-repository"
                  className="form-select"
                  value={repository}
                  onChange={event => {
                    setRepository(event.target.value)
                    const name = event.target.value.split('/').pop() || ''
                    setProjectName(name)
                  }}
                >
                  <option value="">Select a repository</option>
                  {repositories.map(item => (
                    <option key={item.id} value={item.fullName}>
                      {item.fullName}
                      {item.private ? ' · Private' : ' · Public'}
                    </option>
                  ))}
                </select>
                <div className="form-text">
                  Choose the repository you want to open as a new project.
                </div>
              </div>
              <div>
                <label htmlFor="github-project-name" className="form-label">
                  {t('project_name')}
                </label>
                <input
                  id="github-project-name"
                  className="form-control"
                  value={projectName}
                  placeholder="Enter a project name"
                  onChange={event => setProjectName(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="github-import-sync-path" className="form-label">
                  Repository folder
                </label>
                <SyncPathSelector
                  id="github-import-sync-path"
                  repository={selected?.fullName || ''}
                  branch={selected?.defaultBranch || ''}
                  value={syncPath}
                  onChange={setSyncPath}
                  disabled={loading}
                  allowCreate={false}
                />
                <div className="form-text">
                  Select a folder to import only its contents, or use the
                  repository root.
                </div>
              </div>
            </div>
          </>
        ) : (
          <p>{t('loading')}</p>
        )}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onHide}>
          {t('cancel')}
        </OLButton>
        {connection?.connected ? (
          <OLButton
            variant="primary"
            disabled={!selected || loading}
            isLoading={loading}
            onClick={importRepository}
          >
            {t('import')}
          </OLButton>
        ) : null}
      </OLModalFooter>
    </OLModal>
  )
}
