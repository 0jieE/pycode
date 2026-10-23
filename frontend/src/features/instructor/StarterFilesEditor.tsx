import { useMemo, useState, type FormEvent } from 'react'
import { FilePlus, Pencil, Trash2 } from 'lucide-react'
import type { StarterFile } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'
import CodeEditor from '@/features/workspace/CodeEditor'
import { FileTree } from '@/features/workspace/FileTree'
import { hasPathCollision, validateFilePath } from '@/lib/paths'
import { starterFilesProblem } from '@/lib/starterFiles'

interface Props {
  files: StarterFile[]
  onChange: (files: StarterFile[]) => void
  /** After publishing, the files are frozen: students already have them. */
  readOnly?: boolean
}

type Dialogs =
  { kind: 'add' } | { kind: 'rename'; path: string } | { kind: 'delete'; path: string } | null

/** A mini file manager plus editor. Paths are relative to the activity folder. */
export function StarterFilesEditor({ files, onChange, readOnly = false }: Props) {
  const [selected, setSelected] = useState<string | null>(files[0]?.path ?? null)
  const [dialog, setDialog] = useState<Dialogs>(null)

  const entries = useMemo(() => files.map((f) => ({ path: f.path, is_folder: false })), [files])
  const current = files.find((f) => f.path === selected) ?? null
  const problem = starterFilesProblem(files)

  function addFile(path: string) {
    onChange([...files, { path, content: '' }])
    setSelected(path)
    setDialog(null)
  }

  function renameFile(from: string, to: string) {
    onChange(files.map((f) => (f.path === from ? { ...f, path: to } : f)))
    setSelected(to)
    setDialog(null)
  }

  function deleteFile(path: string) {
    const rest = files.filter((f) => f.path !== path)
    onChange(rest)
    setSelected(rest[0]?.path ?? null)
    setDialog(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid h-96 grid-cols-[14rem_1fr] overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex min-h-0 flex-col border-r border-line">
          {!readOnly && (
            <div className="flex gap-1 border-b border-line p-1.5">
              <Button size="sm" onClick={() => setDialog({ kind: 'add' })}>
                <FilePlus aria-hidden className="size-3.5" />
                Add file
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Rename file"
                title="Rename file"
                disabled={!current}
                onClick={() => current && setDialog({ kind: 'rename', path: current.path })}
              >
                <Pencil aria-hidden className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Delete file"
                title="Delete file"
                disabled={!current}
                onClick={() => current && setDialog({ kind: 'delete', path: current.path })}
              >
                <Trash2 aria-hidden className="size-3.5" />
              </Button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-1.5">
            <FileTree
              label="Starter files"
              entries={entries}
              selectedPath={selected}
              onSelect={setSelected}
              emptyText={
                readOnly
                  ? 'This activity has no starter files.'
                  : 'No starter files. Add one, or publish with just instructions.'
              }
            />
          </div>
        </div>

        <div className="min-h-0 min-w-0">
          {current ? (
            <CodeEditor
              path={current.path}
              value={current.content}
              readOnly={readOnly}
              label={`Contents of ${current.path}`}
              onChange={(content) =>
                onChange(files.map((f) => (f.path === current.path ? { ...f, content } : f)))
              }
            />
          ) : (
            <p className="p-4 text-sm text-ink-muted">Select a file to see its contents.</p>
          )}
        </div>
      </div>

      {problem && !readOnly && (
        <p role="alert" className="text-sm text-error">
          {problem}
        </p>
      )}

      <PathDialog
        open={dialog?.kind === 'add' || dialog?.kind === 'rename'}
        title={dialog?.kind === 'rename' ? 'Rename file' : 'Add a starter file'}
        initial={dialog?.kind === 'rename' ? dialog.path : ''}
        existing={files
          .map((f) => f.path)
          .filter((p) => !(dialog?.kind === 'rename' && p === dialog.path))}
        submitLabel={dialog?.kind === 'rename' ? 'Rename' : 'Add file'}
        onSubmit={(path) =>
          dialog?.kind === 'rename' ? renameFile(dialog.path, path) : addFile(path)
        }
        onClose={() => setDialog(null)}
      />

      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        title="Delete this starter file?"
        confirmLabel="Delete file"
        destructive
        onConfirm={() => dialog?.kind === 'delete' && deleteFile(dialog.path)}
        onCancel={() => setDialog(null)}
      >
        <strong className="text-ink">{dialog?.kind === 'delete' ? dialog.path : ''}</strong> will be
        removed from this activity. The change is saved when you save the activity.
      </ConfirmDialog>
    </div>
  )
}

interface PathDialogProps {
  open: boolean
  title: string
  initial: string
  existing: string[]
  submitLabel: string
  onSubmit: (path: string) => void
  onClose: () => void
}

function PathDialog({
  open,
  title,
  initial,
  existing,
  submitLabel,
  onSubmit,
  onClose,
}: PathDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title} width="max-w-md">
      <PathForm
        initial={initial}
        existing={existing}
        submitLabel={submitLabel}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    </Dialog>
  )
}

function PathForm({
  initial,
  existing,
  submitLabel,
  onSubmit,
  onClose,
}: Omit<PathDialogProps, 'open' | 'title'>) {
  const [path, setPath] = useState(initial)
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const value = path.trim()
    const problem =
      validateFilePath(value) ??
      (hasPathCollision(value, existing) ? 'A file with that name already exists.' : null)
    setError(problem)
    if (!problem) onSubmit(value)
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody>
        <TextField
          label="File name"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          error={error}
          placeholder="e.g. main.py or data/scores.csv"
          autoComplete="off"
          autoFocus
        />
        <p className="mt-2 text-sm text-ink-muted">
          Relative to the activity folder. Allowed types: .py .txt .csv .json .md
        </p>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
