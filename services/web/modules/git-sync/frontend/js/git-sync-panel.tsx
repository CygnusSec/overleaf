import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  deleteJSON,
  FetchError,
  getJSON,
  postJSON,
  putJSON,
} from '@/infrastructure/fetch-json'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { useLocation } from '@/shared/hooks/use-location'
import getMeta from '@/utils/meta'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'

type Repository = {
  id: number
  fullName: string
  defaultBranch: string
  canPush: boolean
}

type LinkStatus = {
  connected: boolean
  configured?: boolean
  login?: string
  link?: {
    repositoryFullName: string
    branch: string
    lastSyncedAt?: string
    lastSyncDirection?: 'pull' | 'push'
    lastSyncedCommit?: string
  }
}

export default function GitSyncPanel() {
  const { t } = useTranslation()
  const { projectId, permissionsLevel } = useIdeReactContext()
  const location = useLocation()
  const enabled = getMeta('ol-gitSyncEnabled')
  const [status, setStatus] = useState<LinkStatus>()
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [selectedRepository, setSelectedRepository] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    try {
      const next = await getJSON<LinkStatus>(
        `/project/${projectId}/github-sync`
      )
      setStatus(next)
      if (next.connected && !next.link) {
        const result = await getJSON<{ repositories: Repository[] }>(
          '/api/github/repositories'
        )
        setRepositories(result.repositories.filter(repo => repo.canPush))
      }
    } catch (error) {
      setError(
        error instanceof FetchError
          ? error.getUserFacingMessage()
          : t('github_sync_error')
      )
    }
  }, [projectId, t])

  useEffect(() => {
    if (enabled && permissionsLevel === 'owner') load()
  }, [enabled, permissionsLevel, load])

  if (!enabled) return null
  if (permissionsLevel !== 'owner') {
    return (
      <div className="p-3">
        <h3 className="h5">{t('github')}</h3>
        <p>{t('only_project_owner_can_link_github')}</p>
      </div>
    )
  }

  const linkRepository = async () => {
    const repository = repositories.find(
      item => item.fullName === selectedRepository
    )
    if (!repository) return
    setBusy(true)
    setError(undefined)
    try {
      await putJSON(`/project/${projectId}/github-sync`, {
        body: {
          repositoryFullName: repository.fullName,
          branch: repository.defaultBranch,
        },
      })
      await load()
    } catch (error) {
      setError(
        error instanceof FetchError
          ? error.getUserFacingMessage()
          : t('github_sync_error')
      )
    } finally {
      setBusy(false)
    }
  }

  const sync = async (direction: 'pull' | 'push') => {
    if (
      direction === 'pull' &&
      !window.confirm(
        'Pulling replaces the current Overleaf project files with the selected GitHub branch. Continue?'
      )
    ) {
      return
    }
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await postJSON<{ changed?: boolean }>(
        `/project/${projectId}/github-sync/${direction}`,
        { body: direction === 'push' ? { message } : {} }
      )
      setNotice(
        direction === 'push' && result.changed === false
          ? 'The project is already up to date.'
          : direction === 'push'
            ? 'Changes were committed and pushed to GitHub.'
            : 'GitHub changes were pulled into the project.'
      )
      await load()
    } catch (error) {
      setError(
        error instanceof FetchError
          ? error.getUserFacingMessage()
          : t('github_sync_error')
      )
    } finally {
      setBusy(false)
    }
  }

  const unlink = async () => {
    if (!window.confirm(t('unlink_github_warning'))) return
    await deleteJSON(`/project/${projectId}/github-sync`, {})
    setStatus(current => (current ? { ...current, link: undefined } : current))
    await load()
  }

  return (
    <div className="p-3">
      <h3 className="h5">{t('github')}</h3>
      <p className="text-muted">{t('github_sync_description')}</p>
      {error ? <OLNotification type="error" content={error} /> : null}
      {notice ? <OLNotification type="success" content={notice} /> : null}
      {status?.connected === false ? (
        <OLButton
          variant="primary"
          onClick={() =>
            location.assign(
              `/oauth/github?returnTo=${encodeURIComponent(
                `/project/${projectId}`
              )}`
            )
          }
        >
          {t('link_to_github')}
        </OLButton>
      ) : status?.connected && !status.link ? (
        <>
          <label className="form-label" htmlFor="github-sync-repository">
            {t('select_github_repository')}
          </label>
          <select
            id="github-sync-repository"
            className="form-select mb-3"
            value={selectedRepository}
            onChange={event => setSelectedRepository(event.target.value)}
          >
            <option value="">{t('select')}</option>
            {repositories.map(repository => (
              <option key={repository.id} value={repository.fullName}>
                {repository.fullName}
              </option>
            ))}
          </select>
          <OLButton
            variant="primary"
            disabled={!selectedRepository || busy}
            isLoading={busy}
            onClick={linkRepository}
          >
            {t('sync_with_github')}
          </OLButton>
        </>
      ) : status?.link ? (
        <>
          <p>
            <strong>{status.link.repositoryFullName}</strong>
            <br />
            <span className="text-muted">Branch: {status.link.branch}</span>
          </p>
          <label className="form-label" htmlFor="github-commit-message">
            Commit message
          </label>
          <input
            id="github-commit-message"
            className="form-control mb-3"
            value={message}
            placeholder={t('github_commit_message_placeholder')}
            onChange={event => setMessage(event.target.value)}
          />
          <div className="d-flex flex-wrap gap-2">
            <OLButton
              variant="primary"
              disabled={busy}
              isLoading={busy}
              onClick={() => sync('push')}
            >
              {t('push_sharelatex_changes_to_github')}
            </OLButton>
            <OLButton
              variant="secondary"
              disabled={busy}
              onClick={() => sync('pull')}
            >
              {t('pull_github_changes_into_sharelatex')}
            </OLButton>
            <OLButton
              variant="danger-ghost"
              disabled={busy}
              onClick={unlink}
            >
              {t('unlink_github_repository')}
            </OLButton>
          </div>
        </>
      ) : (
        <p>{t('loading')}</p>
      )}
    </div>
  )
}
