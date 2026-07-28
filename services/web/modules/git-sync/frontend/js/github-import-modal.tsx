import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
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
  }>()
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [repository, setRepository] = useState('')
  const [projectName, setProjectName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    getJSON<{ connected: boolean; configured: boolean }>('/api/github/status')
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
    <OLModal show animation onHide={onHide} size="lg" backdrop="static">
      <OLModalHeader>
        <OLModalTitle>{t('import_from_github')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <p>{t('github_sync_description')}</p>
        {error ? <OLNotification type="error" content={error} /> : null}
        {connection?.configured === false ? (
          <OLNotification
            type="warning"
            content="GitHub Sync has not been configured by the administrator."
          />
        ) : connection?.connected === false ? (
          <div className="text-center py-4">
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
            <label htmlFor="github-repository" className="form-label">
              {t('select_github_repository')}
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
              <option value="">{t('select')}</option>
              {repositories.map(item => (
                <option key={item.id} value={item.fullName}>
                  {item.fullName}
                  {item.private ? ' (private)' : ''}
                </option>
              ))}
            </select>
            <label htmlFor="github-project-name" className="form-label mt-3">
              {t('project_name')}
            </label>
            <input
              id="github-project-name"
              className="form-control"
              value={projectName}
              onChange={event => setProjectName(event.target.value)}
            />
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
