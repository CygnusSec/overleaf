import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { postJSON, FetchError } from '@/infrastructure/fetch-json'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useFileTreeSelectable } from '../../contexts/file-tree-selectable'
import { findInTreeOrThrow, findAllFolderIdsInFolder } from '../../util/find-in-tree'
import { isCleanFilename } from '../../util/safe-path'
import type { FileTreeFindResult } from '@/features/ide-react/types/file-tree'
import type { Folder } from '@ol-types/folder'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'

type FolderOption = { id: string; label: string; disabled: boolean }

function copyName(name: string, isFolder: boolean) {
  if (isFolder) return `${name} copy`
  const extensionIndex = name.lastIndexOf('.')
  return extensionIndex > 0
    ? `${name.slice(0, extensionIndex)} copy${name.slice(extensionIndex)}`
    : `${name} copy`
}

function folderOptions(
  folder: Folder,
  excludedIds: Set<string>,
  path = ''
): FolderOption[] {
  const label = path || '/'
  return [
    {
      id: folder._id,
      label,
      disabled: excludedIds.has(folder._id),
    },
    ...folder.folders.flatMap(child =>
      folderOptions(
        child,
        excludedIds,
        `${path}/${child.name}`.replace('//', '/')
      )
    ),
  ]
}

export default function FileTreeModalCopy() {
  const { projectId } = useProjectContext()
  const { fileTreeData } = useFileTreeData()
  const { selectedEntityIds } = useFileTreeSelectable()
  const [source, setSource] = useState<FileTreeFindResult | null>(null)
  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    function open() {
      if (selectedEntityIds.size !== 1) return
      const [entityId] = selectedEntityIds
      const found = findInTreeOrThrow(fileTreeData, entityId)
      setSource(found)
      setName(copyName(found.entity.name, found.type === 'folder'))
      setFolderId(found.parentFolderId)
      setError(undefined)
    }
    window.addEventListener('file-tree.make-copy', open)
    return () => window.removeEventListener('file-tree.make-copy', open)
  }, [fileTreeData, selectedEntityIds])

  const excludedFolderIds = useMemo(
    () =>
      source?.type === 'folder'
        ? findAllFolderIdsInFolder(source.entity)
        : new Set<string>(),
    [source]
  )
  const options = useMemo(
    () => folderOptions(fileTreeData, excludedFolderIds),
    [excludedFolderIds, fileTreeData]
  )
  const valid =
    Boolean(source && folderId && name.trim()) &&
    name.length < 150 &&
    isCleanFilename(name.trim()) &&
    !excludedFolderIds.has(folderId)

  function close() {
    if (busy) return
    setSource(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!source || !valid) return
    setBusy(true)
    setError(undefined)
    const entityType = source.type === 'fileRef' ? 'file' : source.type
    try {
      await postJSON(
        `/project/${projectId}/${entityType}/${source.entity._id}/copy`,
        { body: { folder_id: folderId, name: name.trim() } }
      )
      setSource(null)
    } catch (error) {
      setError(
        error instanceof FetchError
          ? error.getUserFacingMessage()
          : 'Could not create the copy.'
      )
    } finally {
      setBusy(false)
    }
  }

  if (!source) return null

  return (
    <OLModal show onHide={close} className="ide-dark-modal">
      <form onSubmit={submit}>
        <OLModalHeader closeButton={!busy}>
          <OLModalTitle>Make a copy</OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          <OLFormGroup controlId="copy-name">
            <OLFormLabel>Copy name</OLFormLabel>
            <OLFormControl
              autoFocus
              value={name}
              maxLength={149}
              onChange={event => setName(event.target.value)}
            />
          </OLFormGroup>
          <OLFormGroup controlId="copy-destination">
            <OLFormLabel>Destination folder</OLFormLabel>
            <select
              id="copy-destination"
              className="form-select"
              value={folderId}
              onChange={event => setFolderId(event.target.value)}
            >
              {options.map(option => (
                <option
                  key={option.id}
                  value={option.id}
                  disabled={option.disabled}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </OLFormGroup>
          {!valid && name ? (
            <div className="alert alert-danger mb-0" role="alert">
              Choose a valid name and destination folder.
            </div>
          ) : null}
          {error ? (
            <div className="alert alert-danger mb-0" role="alert">
              {error}
            </div>
          ) : null}
        </OLModalBody>
        <OLModalFooter>
          <OLButton variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </OLButton>
          <OLButton
            type="submit"
            variant="primary"
            disabled={!valid || busy}
            isLoading={busy}
          >
            Create copy
          </OLButton>
        </OLModalFooter>
      </form>
    </OLModal>
  )
}
