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
import SyncPathSelector from './sync-path-selector'

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
    syncPath: string
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
  const [branches, setBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [createNewBranch, setCreateNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [existingRepositorySyncPath, setExistingRepositorySyncPath] =
    useState('docs/latex')
  const [newRepositoryName, setNewRepositoryName] = useState('')
  const [newRepositoryPrivate, setNewRepositoryPrivate] = useState(true)
  const [newRepositoryBranch, setNewRepositoryBranch] = useState('main')
  const [newRepositorySyncPath, setNewRepositorySyncPath] = useState('')
  const [linkedSyncPath, setLinkedSyncPath] = useState('')
  const [editingLinkedBranch, setEditingLinkedBranch] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const selectedRepositoryDetails = repositories.find(
    item => item.fullName === selectedRepository
  )

  const load = useCallback(async () => {
    try {
      const next = await getJSON<LinkStatus>(
        `/project/${projectId}/github-sync`
      )
      setStatus(next)
      if (next.link) {
        setLinkedSyncPath(next.link.syncPath || '')
      }
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
    const branch = createNewBranch ? newBranchName.trim() : selectedBranch
    if (!branch) return
    setBusy(true)
    setError(undefined)
    try {
      await putJSON(`/project/${projectId}/github-sync`, {
        body: {
          repositoryFullName: repository.fullName,
          branch,
          createBranch: createNewBranch,
          sourceBranch: repository.defaultBranch,
          syncPath: existingRepositorySyncPath.trim(),
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

  const selectRepository = async (fullName: string) => {
    setSelectedRepository(fullName)
    setBranches([])
    setCreateNewBranch(false)
    setNewBranchName('')
    const repository = repositories.find(item => item.fullName === fullName)
    setSelectedBranch(repository?.defaultBranch || '')
    if (!repository) return
    try {
      const result = await getJSON<{ branches: string[] }>(
        `/api/github/branches?repository=${encodeURIComponent(fullName)}`
      )
      setBranches(result.branches)
    } catch (error) {
      setError(
        error instanceof FetchError
          ? error.getUserFacingMessage()
          : t('github_sync_error')
      )
    }
  }

  const sync = async (direction: 'pull' | 'push') => {
    if (
      direction === 'push' &&
      !status?.link?.syncPath &&
      !window.confirm(
        'The repository folder is empty, so this push will replace files across the repository root. Continue?'
      )
    ) {
      return
    }
    if (
      direction === 'pull' &&
      !window.confirm(
        `Pulling replaces the current Overleaf project files with files from ${
          status?.link?.syncPath || 'the repository root'
        }. Continue?`
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

  const createRepository = async () => {
    const name = newRepositoryName.trim()
    if (!name) return
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await postJSON<{ repositoryFullName: string }>(
        `/project/${projectId}/github-sync/repository`,
        {
          body: {
            name,
            private: newRepositoryPrivate,
            branch: newRepositoryBranch.trim() || 'main',
            syncPath: newRepositorySyncPath.trim(),
            description: `Source files for ${name}`,
          },
        }
      )
      setNotice(
        `${result.repositoryFullName} was created and the project was pushed successfully.`
      )
      setNewRepositoryName('')
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

  const beginLinkedBranchChange = async () => {
    if (!status?.link) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await getJSON<{ branches: string[] }>(
        `/api/github/branches?repository=${encodeURIComponent(
          status.link.repositoryFullName
        )}`
      )
      setBranches(result.branches)
      setSelectedBranch(status.link.branch)
      setCreateNewBranch(false)
      setNewBranchName('')
      setEditingLinkedBranch(true)
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

  const updateLinkedBranch = async () => {
    if (!status?.link) return
    const branch = createNewBranch ? newBranchName.trim() : selectedBranch
    if (!branch) return
    setBusy(true)
    setError(undefined)
    try {
      await putJSON(`/project/${projectId}/github-sync`, {
        body: {
          repositoryFullName: status.link.repositoryFullName,
          branch,
          createBranch: createNewBranch,
          sourceBranch: status.link.branch,
          syncPath: status.link.syncPath,
        },
      })
      setEditingLinkedBranch(false)
      setNotice(
        createNewBranch
          ? `Branch ${branch} was created and selected.`
          : `Switched to branch ${branch}.`
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

  const updateLinkedSyncPath = async () => {
    if (!status?.link) return
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await putJSON(`/project/${projectId}/github-sync`, {
        body: {
          repositoryFullName: status.link.repositoryFullName,
          branch: status.link.branch,
          syncPath: linkedSyncPath.trim(),
        },
      })
      setNotice(
        linkedSyncPath.trim()
          ? `GitHub Sync is now limited to ${linkedSyncPath.trim()}.`
          : 'GitHub Sync now uses the repository root.'
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

  const disconnectGithub = async () => {
    if (!window.confirm(t('unlink_github_warning'))) return
    setBusy(true)
    setError(undefined)
    try {
      await deleteJSON('/api/github/connection', {})
      setStatus({ connected: false, configured: true, link: undefined })
      setRepositories([])
      setSelectedRepository('')
      setNotice('GitHub account disconnected.')
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

  return (
    <div className="p-3">
      <h3 className="h5">{t('github')}</h3>
      <p className="text-muted github-sync-panel-description">
        Link this project to GitHub, then pull or push changes when you choose.
      </p>
      {status?.connected ? (
        <div className="github-sync-panel-account">
          <span className="github-sync-panel-account-name">
            <small>Connected as</small>
            <strong title={`@${status.login}`}>@{status.login}</strong>
          </span>
          <OLButton
            variant="danger-ghost"
            size="sm"
            disabled={busy}
            onClick={disconnectGithub}
          >
            Disconnect GitHub
          </OLButton>
        </div>
      ) : null}
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
        <div className="github-sync-panel-setup">
          <section>
            <h4>Link an existing repository</h4>
            <p className="text-muted">
              Select a repository where you have write access.
            </p>
            <label className="form-label" htmlFor="github-sync-repository">
              Repository
            </label>
            <select
              id="github-sync-repository"
              className="form-select mb-3"
              value={selectedRepository}
              onChange={event => selectRepository(event.target.value)}
            >
              <option value="">{t('select')}</option>
              {repositories.map(repository => (
                <option key={repository.id} value={repository.fullName}>
                  {repository.fullName}
                </option>
              ))}
            </select>
            {selectedRepository ? (
              <>
                <label className="form-label" htmlFor="github-sync-branch">
                  Branch
                </label>
                <select
                  id="github-sync-branch"
                  className="form-select mb-3"
                  value={createNewBranch ? '__new__' : selectedBranch}
                  onChange={event => {
                    const isNew = event.target.value === '__new__'
                    setCreateNewBranch(isNew)
                    if (!isNew) setSelectedBranch(event.target.value)
                  }}
                >
                  {branches.map(branch => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                  <option value="__new__">+ Create a new branch</option>
                </select>
                {createNewBranch ? (
                  <input
                    className="form-control mb-3"
                    value={newBranchName}
                    placeholder={`New branch from ${selectedRepositoryDetails?.defaultBranch}`}
                    maxLength={200}
                    onChange={event => setNewBranchName(event.target.value)}
                  />
                ) : null}
                <label className="form-label" htmlFor="github-sync-path">
                  Repository folder
                </label>
                <SyncPathSelector
                  id="github-sync-path"
                  repository={selectedRepository}
                  branch={
                    createNewBranch
                      ? selectedRepositoryDetails?.defaultBranch || ''
                      : selectedBranch
                  }
                  value={existingRepositorySyncPath}
                  onChange={setExistingRepositorySyncPath}
                  disabled={busy}
                />
                <div className="form-text mb-3">
                  Select an existing folder or create one on the first push.
                  Source code outside it stays unchanged.
                </div>
              </>
            ) : null}
            <OLButton
              variant="primary"
              disabled={
                !selectedRepository ||
                (!createNewBranch && !selectedBranch) ||
                (createNewBranch && !newBranchName.trim()) ||
                busy
              }
              isLoading={busy}
              onClick={linkRepository}
            >
              {t('sync_with_github')}
            </OLButton>
          </section>
          <div className="github-sync-panel-divider">
            <span>or</span>
          </div>
          <section>
            <h4>Create a new repository</h4>
            <p className="text-muted">
              Create a GitHub repository and push this project immediately.
            </p>
            <label className="form-label" htmlFor="github-new-repository-name">
              Repository name
            </label>
            <input
              id="github-new-repository-name"
              className="form-control"
              value={newRepositoryName}
              placeholder="my-latex-project"
              maxLength={100}
              onChange={event => setNewRepositoryName(event.target.value)}
            />
            <label className="github-sync-visibility">
              <input
                type="checkbox"
                checked={newRepositoryPrivate}
                onChange={event =>
                  setNewRepositoryPrivate(event.target.checked)
                }
              />
              <span>
                <strong>Private repository</strong>
                <small>Only you and people you grant access can view it.</small>
              </span>
            </label>
            <label className="form-label" htmlFor="github-new-repository-branch">
              Initial branch
            </label>
            <input
              id="github-new-repository-branch"
              className="form-control mb-3"
              value={newRepositoryBranch}
              placeholder="main"
              maxLength={200}
              onChange={event => setNewRepositoryBranch(event.target.value)}
            />
            <label className="form-label" htmlFor="github-new-repository-path">
              Repository folder
            </label>
            <input
              id="github-new-repository-path"
              className="form-control mb-1"
              value={newRepositorySyncPath}
              placeholder="Leave empty to use the repository root"
              maxLength={500}
              onChange={event => setNewRepositorySyncPath(event.target.value)}
            />
            <div className="form-text mb-3">
              Enter a new folder path, or leave it empty for a dedicated
              repository.
            </div>
            <OLButton
              variant="primary"
              disabled={
                !newRepositoryName.trim() ||
                !newRepositoryBranch.trim() ||
                busy
              }
              isLoading={busy}
              onClick={createRepository}
            >
              Create repository &amp; sync
            </OLButton>
          </section>
        </div>
      ) : status?.link ? (
        <div className="github-sync-linked">
          <div className="github-sync-repository-card">
            <span className="github-sync-repository-icon" aria-hidden="true">
              GH
            </span>
            <span className="github-sync-repository-details">
              <small>Linked repository</small>
              <strong title={status.link.repositoryFullName}>
                {status.link.repositoryFullName}
              </strong>
              <span className="github-sync-branch-row">
                <span className="github-sync-branch-badge">
                  {status.link.branch}
                </span>
                <button
                  type="button"
                  className="github-sync-branch-change"
                  disabled={busy}
                  onClick={beginLinkedBranchChange}
                >
                  Change
                </button>
              </span>
              <span className="github-sync-path-label">
                Folder: {status.link.syncPath || 'Repository root'}
              </span>
            </span>
          </div>
          {editingLinkedBranch ? (
            <div className="github-sync-branch-editor">
              <label className="form-label" htmlFor="github-linked-branch">
                Working branch
              </label>
              <select
                id="github-linked-branch"
                className="form-select"
                value={createNewBranch ? '__new__' : selectedBranch}
                onChange={event => {
                  const isNew = event.target.value === '__new__'
                  setCreateNewBranch(isNew)
                  if (!isNew) setSelectedBranch(event.target.value)
                }}
              >
                {branches.map(branch => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
                <option value="__new__">+ Create a new branch</option>
              </select>
              {createNewBranch ? (
                <input
                  className="form-control"
                  value={newBranchName}
                  placeholder={`New branch from ${status.link.branch}`}
                  maxLength={200}
                  onChange={event => setNewBranchName(event.target.value)}
                />
              ) : null}
              <div className="github-sync-branch-editor-actions">
                <OLButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setEditingLinkedBranch(false)}
                >
                  Cancel
                </OLButton>
                <OLButton
                  variant="primary"
                  disabled={
                    (!createNewBranch && !selectedBranch) ||
                    (createNewBranch && !newBranchName.trim()) ||
                    busy
                  }
                  isLoading={busy}
                  onClick={updateLinkedBranch}
                >
                  Apply branch
                </OLButton>
              </div>
            </div>
          ) : null}
          <div className="github-sync-path-editor">
            <label className="form-label" htmlFor="github-linked-sync-path">
              Repository folder
            </label>
            <SyncPathSelector
              id="github-linked-sync-path"
              repository={status.link.repositoryFullName}
              branch={status.link.branch}
              value={linkedSyncPath}
              onChange={setLinkedSyncPath}
              disabled={busy}
            />
            <div className="form-text">
              Select an existing folder or create one on the next push. Push
              and pull only affect this folder.
            </div>
            <OLButton
              variant="secondary"
              size="sm"
              disabled={
                busy || linkedSyncPath.trim() === (status.link.syncPath || '')
              }
              onClick={updateLinkedSyncPath}
            >
              Update folder
            </OLButton>
          </div>
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
          <div className="github-sync-actions">
            <OLButton
              variant="primary"
              disabled={busy}
              isLoading={busy}
              onClick={() => sync('push')}
            >
              Push to GitHub
            </OLButton>
            <OLButton
              variant="secondary"
              disabled={busy}
              onClick={() => sync('pull')}
            >
              Pull from GitHub
            </OLButton>
            <OLButton
              variant="danger-ghost"
              disabled={busy}
              onClick={unlink}
            >
              Unlink repository
            </OLButton>
          </div>
        </div>
      ) : (
        <p>{t('loading')}</p>
      )}
    </div>
  )
}
