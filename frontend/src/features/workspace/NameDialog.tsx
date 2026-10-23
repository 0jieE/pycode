import { useState, type FormEvent } from 'react'
import { useCreateEntry, useRenameEntry } from '@/api/queries/workspace'
import type { WorkspaceScope } from '@/api/workspaceScope'
import { errorMessage } from '@/api/errors'
import type { FileMeta, FileOut } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'
import { validateEntryPath } from '@/lib/paths'

export type NameTarget =
  | { kind: 'new-file'; parent: string }
  | { kind: 'new-folder'; parent: string }
  | { kind: 'rename'; entry: FileMeta }

interface NameDialogProps {
  scope: WorkspaceScope
  /**
   * A class workspace: the activity folders, the only places files and folders may be created in or moved to.
   * Undefined in Practice, which has no such rule.
   */
  activityFolders?: readonly string[]
  target: NameTarget | null
  entries: readonly FileMeta[]
  onClose: () => void
  /** The entry exists now (created or moved), at `path`. `file` is the new file when one was created. */
  onDone: (path: string, file?: FileOut) => void
}

const TITLES = {
  'new-file': 'New file',
  'new-folder': 'New folder',
  rename: 'Rename or move',
} as const

export function NameDialog({
  scope,
  activityFolders,
  target,
  entries,
  onClose,
  onDone,
}: NameDialogProps) {
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target ? TITLES[target.kind] : ''}
      width="max-w-md"
    >
      {target && (
        <NameForm
          scope={scope}
          activityFolders={activityFolders}
          target={target}
          entries={entries}
          onClose={onClose}
          onDone={onDone}
        />
      )}
    </Dialog>
  )
}

function NameForm({
  scope,
  activityFolders,
  target,
  entries,
  onClose,
  onDone,
}: Omit<NameDialogProps, 'target'> & { target: NameTarget }) {
  const create = useCreateEntry(scope)
  const rename = useRenameEntry(scope)
  const isRename = target.kind === 'rename'
  const isFolder = target.kind === 'new-folder' || (isRename && target.entry.is_folder)
  const prefix = isRename ? '' : target.parent === '' ? '' : `${target.parent}/`

  const [name, setName] = useState(isRename ? target.entry.path : '')
  const [error, setError] = useState<string | null>(null)
  const pending = create.isPending || rename.isPending

  function submit(e: FormEvent) {
    e.preventDefault()
    const path = prefix + name.trim()
    // In a class workspace everything goes inside an activity folder (not the top level, nor another folder).
    const outside =
      activityFolders !== undefined &&
      (!path.includes('/') || !activityFolders.includes(path.split('/')[0] ?? ''))
    const problem = outside
      ? 'Files and folders go inside an activity folder. Start the path with its name, e.g. "Lab 1/notes.txt".'
      : validateEntryPath(path, {
          isFolder,
          entries,
          movingFrom: isRename ? target.entry.path : undefined,
        })
    setError(problem)
    if (problem) return

    const fail = (err: unknown) => setError(errorMessage(err))
    if (isRename) {
      if (path === target.entry.path) return onClose()
      rename.mutate(
        { id: target.entry.id, newPath: path },
        { onSuccess: () => onDone(path), onError: fail },
      )
    } else {
      create.mutate(
        { path, is_folder: isFolder, content: '' },
        { onSuccess: (file) => onDone(path, isFolder ? undefined : file), onError: fail },
      )
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody>
        {prefix && (
          <p className="mb-3 text-sm text-ink-muted">
            In folder <span className="font-mono text-ink">{prefix}</span>
          </p>
        )}
        <TextField
          label={isRename ? 'New path' : isFolder ? 'Folder name' : 'File name'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          placeholder={isFolder ? 'e.g. practice' : 'e.g. main.py'}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          onFocus={(e) => {
            // Rename: select the file name part, not the folders before it.
            if (isRename) {
              const start = name.lastIndexOf('/') + 1
              const dot = name.lastIndexOf('.')
              e.currentTarget.setSelectionRange(start, dot > start && !isFolder ? dot : name.length)
            }
          }}
        />
        <p className="mt-2 text-sm text-ink-muted">
          {isRename
            ? 'Change the folders in the path to move it. Everything inside a folder moves with it.'
            : isFolder
              ? 'Names cannot start with a dot.'
              : 'Allowed types: .py .txt .csv .json .md'}
        </p>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={pending}>
          {isRename ? 'Rename' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  )
}
