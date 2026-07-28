import { useCallback, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import {
  deleteJSON,
  getJSON,
  postJSON,
  putJSON,
} from '@/infrastructure/fetch-json'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLCard from '@/shared/components/ol/ol-card'

const PAGE_SIZE = 25

function formatDate(value) {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function UserManagement() {
  const [users, setUsers] = useState([])
  const [stats, setStats] = useState({ total: 0, active: 0, suspended: 0 })
  const [pagination, setPagination] = useState({ page: 1, pages: 1 })
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const loadUsers = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        limit: String(PAGE_SIZE),
      })
      if (search) params.set('search', search)
      const result = await getJSON(`/admin/users?${params}`)
      setUsers(result.users)
      setStats(result.stats)
      setPagination(current => ({
        ...current,
        ...result.pagination,
      }))
    } catch (loadError) {
      setError(loadError.getUserFacingMessage?.() || 'Unable to load users.')
    } finally {
      setIsLoading(false)
    }
  }, [pagination.page, search])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  function handleSearch(event) {
    event.preventDefault()
    setPagination(current => ({ ...current, page: 1 }))
    setSearch(searchInput.trim())
  }

  return (
    <OLCard className="admin-user-management">
      <div className="admin-user-management-header">
        <div>
          <h2>User management</h2>
          <p className="admin-user-management-stats">
            <strong>{stats.total}</strong> total ·{' '}
            <span className="text-success">{stats.active} active</span> ·{' '}
            <span className="text-warning">
              {stats.suspended} deactivated
            </span>
          </p>
        </div>
        <form onSubmit={handleSearch} className="admin-user-search">
          <OLFormControl
            type="search"
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            placeholder="Search email or name"
            aria-label="Search users"
          />
          <OLButton type="submit" variant="secondary">
            Search
          </OLButton>
        </form>
      </div>

      {error ? <div className="alert alert-danger">{error}</div> : null}

      <div className="table-responsive">
        <table className="table admin-user-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Registered</th>
              <th>Last login</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan="5" className="text-center">
                  Loading users…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan="5" className="text-center">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map(user => (
                <UserRow key={user.id} user={user} reload={loadUsers} />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-user-pagination">
        <span>
          Page {pagination.page} of {pagination.pages}
        </span>
        <div>
          <OLButton
            variant="secondary"
            size="sm"
            disabled={pagination.page <= 1 || isLoading}
            onClick={() =>
              setPagination(current => ({
                ...current,
                page: current.page - 1,
              }))
            }
          >
            Previous
          </OLButton>
          <OLButton
            variant="secondary"
            size="sm"
            disabled={pagination.page >= pagination.pages || isLoading}
            onClick={() =>
              setPagination(current => ({
                ...current,
                page: current.page + 1,
              }))
            }
          >
            Next
          </OLButton>
        </div>
      </div>
    </OLCard>
  )
}

function UserRow({ user, reload }) {
  const [isEditing, setIsEditing] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  })

  async function run(action) {
    setIsWorking(true)
    setError('')
    setMessage('')
    try {
      await action()
      await reload()
      return true
    } catch (actionError) {
      setError(actionError.getUserFacingMessage?.() || 'Action failed.')
      return false
    } finally {
      setIsWorking(false)
    }
  }

  async function save() {
    const saved = await run(() =>
      putJSON(`/admin/users/${user.id}`, {
        body: form,
      })
    )
    if (saved) setIsEditing(false)
  }

  function toggleSuspended() {
    const verb = user.suspended ? 'reactivate' : 'deactivate'
    if (!window.confirm(`Are you sure you want to ${verb} ${user.email}?`)) {
      return
    }
    run(() =>
      postJSON(`/admin/users/${user.id}/status`, {
        body: { suspended: !user.suspended },
      })
    )
  }

  async function resetPassword() {
    if (
      !window.confirm(
        `Send a password reset email to ${user.email}? Existing sessions and the current password remain valid until the password is changed.`
      )
    ) {
      return
    }
    setIsWorking(true)
    setError('')
    setMessage('')
    try {
      const result = await postJSON(`/admin/users/${user.id}/password-reset`)
      setMessage(result.message)
    } catch (actionError) {
      setError(actionError.getUserFacingMessage?.() || 'Action failed.')
    } finally {
      setIsWorking(false)
    }
  }

  function deleteUser() {
    if (
      !window.confirm(
        `Permanently delete ${user.email} and all projects owned by this user? This cannot be undone.`
      )
    ) {
      return
    }
    run(() => deleteJSON(`/admin/users/${user.id}`))
  }

  return (
    <tr>
      <td>
        {isEditing ? (
          <div className="admin-user-edit-fields">
            <OLFormControl
              type="email"
              value={form.email}
              aria-label="Email"
              onChange={event =>
                setForm(current => ({ ...current, email: event.target.value }))
              }
            />
            <OLFormControl
              type="text"
              value={form.firstName}
              aria-label="First name"
              placeholder="First name"
              onChange={event =>
                setForm(current => ({
                  ...current,
                  firstName: event.target.value,
                }))
              }
            />
            <OLFormControl
              type="text"
              value={form.lastName}
              aria-label="Last name"
              placeholder="Last name"
              onChange={event =>
                setForm(current => ({
                  ...current,
                  lastName: event.target.value,
                }))
              }
            />
          </div>
        ) : (
          <>
            <div className="admin-user-name">
              {[user.firstName, user.lastName].filter(Boolean).join(' ') ||
                'Unnamed user'}
              {user.isAdmin ? (
                <span className="badge text-bg-success ms-2">Admin</span>
              ) : null}
            </div>
            <div className="admin-user-email">{user.email}</div>
          </>
        )}
        {error ? <div className="text-danger small">{error}</div> : null}
        {message ? <div className="text-success small">{message}</div> : null}
      </td>
      <td>
        <span
          className={`admin-user-status ${
            user.suspended ? 'is-suspended' : 'is-active'
          }`}
        >
          {user.suspended ? 'Deactivated' : 'Active'}
        </span>
      </td>
      <td>{formatDate(user.signUpDate)}</td>
      <td>{formatDate(user.lastLoggedIn)}</td>
      <td>
        <div className="admin-user-actions">
          {isEditing ? (
            <>
              <OLButton
                size="sm"
                onClick={save}
                disabled={isWorking || !form.email}
              >
                Save
              </OLButton>
              <OLButton
                size="sm"
                variant="secondary"
                onClick={() => {
                  setForm({
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                  })
                  setError('')
                  setIsEditing(false)
                }}
                disabled={isWorking}
              >
                Cancel
              </OLButton>
            </>
          ) : (
            <>
              <OLButton
                size="sm"
                variant="secondary"
                onClick={() => setIsEditing(true)}
                disabled={!user.canManage || isWorking}
              >
                Edit
              </OLButton>
              <OLButton
                size="sm"
                variant="secondary"
                onClick={resetPassword}
                disabled={!user.canManage || user.suspended || isWorking}
              >
                Reset password
              </OLButton>
              <OLButton
                size="sm"
                variant="secondary"
                onClick={toggleSuspended}
                disabled={!user.canManage || isWorking}
              >
                {user.suspended ? 'Reactivate' : 'Deactivate'}
              </OLButton>
              <OLButton
                size="sm"
                variant="danger"
                onClick={deleteUser}
                disabled={!user.canManage || isWorking}
              >
                Delete
              </OLButton>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

UserRow.propTypes = {
  user: PropTypes.object.isRequired,
  reload: PropTypes.func.isRequired,
}

export default UserManagement
