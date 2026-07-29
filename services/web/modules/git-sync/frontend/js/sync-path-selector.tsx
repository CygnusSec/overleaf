import { useEffect, useState } from 'react'
import { FetchError, getJSON } from '@/infrastructure/fetch-json'

type Props = {
  id: string
  repository: string
  branch: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  allowRoot?: boolean
  allowCreate?: boolean
}

export default function SyncPathSelector({
  id,
  repository,
  branch,
  value,
  onChange,
  disabled = false,
  allowRoot = true,
  allowCreate = true,
}: Props) {
  const [directories, setDirectories] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!repository || !branch) {
      setDirectories([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(undefined)
    getJSON<{ directories: string[] }>(
      `/api/github/directories?repository=${encodeURIComponent(
        repository
      )}&branch=${encodeURIComponent(branch)}`
    )
      .then(result => {
        if (cancelled) return
        setDirectories(result.directories)
      })
      .catch(error => {
        if (cancelled) return
        setDirectories([])
        setError(
          error instanceof FetchError
            ? error.getUserFacingMessage()
            : 'Could not load repository folders'
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [repository, branch])

  useEffect(() => {
    if (value) {
      setCreating(!directories.includes(value))
    }
  }, [value, directories])

  const selectedValue = creating
    ? '__new__'
    : value && directories.includes(value)
      ? value
      : ''

  return (
    <div className="github-sync-path-selector">
      <select
        id={id}
        className="form-select"
        value={selectedValue}
        disabled={disabled || loading || !repository || !branch}
        onChange={event => {
          if (event.target.value === '__new__') {
            setCreating(true)
            onChange('')
          } else {
            setCreating(false)
            onChange(event.target.value)
          }
        }}
      >
        {allowRoot ? <option value="">Repository root</option> : null}
        {directories.map(directory => (
          <option key={directory} value={directory}>
            {directory}
          </option>
        ))}
        {allowCreate ? (
          <option value="__new__">+ Create new folder</option>
        ) : null}
      </select>
      {creating ? (
        <input
          className="form-control"
          value={value}
          placeholder="docs/latex"
          maxLength={500}
          autoFocus
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
        />
      ) : null}
      {loading ? (
        <div className="form-text">Loading folders…</div>
      ) : error ? (
        <div className="form-text text-danger">{error}</div>
      ) : null}
    </div>
  )
}
