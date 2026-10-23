import { useState, type FormEvent } from 'react'
import { Eraser, RotateCcw } from 'lucide-react'
import {
  useClearWorkspace,
  useSetUserStorage,
  useStorageLimits,
  useUserStorage,
} from '@/api/queries/storage'
import { errorMessage } from '@/api/errors'
import type { StorageBounds, User, UserStorage, WorkspaceUsage } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { Skeleton } from '@/components/ui/Spinner'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import { formatBytes } from '@/lib/format'
import {
  inputBytes,
  inputCount,
  limitErrors,
  sizeInput,
  type LimitErrors,
  type SizeInput,
} from '@/lib/storageLimits'
import { SizeField } from './SizeField'

/** One user's own storage limits (empty = their role's) and how full each of their workspaces is. */
export function UserStorageDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  return (
    <Dialog
      open={user !== null}
      onClose={onClose}
      title={user ? `Storage of ${user.full_name}` : 'Storage'}
      width="max-w-2xl"
    >
      {user && <StorageBody user={user} onClose={onClose} />}
    </Dialog>
  )
}

function StorageBody({ user, onClose }: { user: User; onClose: () => void }) {
  const storage = useUserStorage(user.id)
  const limits = useStorageLimits()

  if (storage.isError || limits.isError) {
    return (
      <>
        <DialogBody>
          <p role="alert" className="text-sm text-error">
            {errorMessage(storage.error ?? limits.error)}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </>
    )
  }
  if (storage.isPending || limits.isPending) {
    return (
      <DialogBody>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </DialogBody>
    )
  }
  return (
    <StorageForm user={user} storage={storage.data} bounds={limits.data.bounds} onClose={onClose} />
  )
}

/** Empty when the user follows the role; the field is then shown in the role value's unit. */
const ownSize = (own: number | null | undefined, role: number): SizeInput =>
  own == null ? { value: '', unit: sizeInput(role).unit } : sizeInput(own)

function StorageForm({
  user,
  storage,
  bounds,
  onClose,
}: {
  user: User
  storage: UserStorage
  bounds: StorageBounds
  onClose: () => void
}) {
  const save = useSetUserStorage(user.id)
  const role = storage.role_limits
  const own = storage.override
  const [file, setFile] = useState(() => ownSize(own.max_file_bytes, role.max_file_bytes))
  const [workspace, setWorkspace] = useState(() =>
    ownSize(own.max_workspace_bytes, role.max_workspace_bytes),
  )
  const [files, setFiles] = useState(own.max_files == null ? '' : String(own.max_files))
  const [errors, setErrors] = useState<LimitErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [toClear, setToClear] = useState<WorkspaceUsage | null>(null)
  const clear = useClearWorkspace(user.id)

  function clearWorkspace(w: WorkspaceUsage) {
    clear.mutate(w.workspace_id, {
      onSuccess: (res) => {
        setToClear(null)
        const deleted = `${res.files_deleted} ${res.files_deleted === 1 ? 'file' : 'files'} deleted`
        const restored =
          res.class_id === null
            ? ''
            : `, ${res.starter_files_restored} starter ${
                res.starter_files_restored === 1 ? 'file' : 'files'
              } restored`
        toast.success(`${workspaceName(w)} cleared: ${deleted}${restored}`)
      },
      // The error is toasted already.
      onError: () => setToClear(null),
    })
  }

  const roleName = storage.role === 'instructor' ? 'instructors' : 'students'
  const hasOwn = file.value !== '' || workspace.value !== '' || files.trim() !== ''

  function followRole() {
    setFile({ value: '', unit: file.unit })
    setWorkspace({ value: '', unit: workspace.unit })
    setFiles('')
    setErrors({})
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    setFormError(null)
    const values = {
      max_file_bytes: inputBytes(file),
      max_workspace_bytes: inputBytes(workspace),
      max_files: inputCount(files),
    }
    const found = limitErrors(values, bounds, { required: false, fallback: role })
    // Something typed that is not a number at all.
    if (files.trim() !== '' && values.max_files === null)
      found.max_files = 'Enter a whole number, or leave it empty.'
    setErrors(found)
    if (Object.keys(found).length > 0) return
    save.mutate(values, {
      onSuccess: () => {
        toast.success(`Storage limits saved for ${user.full_name}`)
        onClose()
      },
      onError: (err) => setFormError(errorMessage(err)),
    })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody>
        <div className="flex flex-col gap-5">
          {formError && (
            <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
              {formError}
            </p>
          )}

          <section aria-labelledby="own-limits" className="flex flex-col gap-3">
            <div>
              <h3 id="own-limits" className="font-semibold">
                Their own limits
              </h3>
              <p className="text-sm text-ink-muted">
                For each of their workspaces. Leave a field empty to use the limit for all{' '}
                {roleName}.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <SizeField
                label="Largest file"
                value={file}
                onChange={setFile}
                error={errors.max_file_bytes}
                placeholder={`${roleName}: ${sizeInput(role.max_file_bytes).value}`}
                hint={`Empty: ${formatBytes(role.max_file_bytes)}`}
              />
              <SizeField
                label="Workspace size"
                value={workspace}
                onChange={setWorkspace}
                error={errors.max_workspace_bytes}
                placeholder={`${roleName}: ${sizeInput(role.max_workspace_bytes).value}`}
                hint={`Empty: ${formatBytes(role.max_workspace_bytes)}`}
              />
              <div className="flex flex-col gap-1.5">
                <TextField
                  label="Number of files"
                  type="number"
                  inputMode="numeric"
                  min={bounds.max_files.min}
                  max={bounds.max_files.max}
                  step={1}
                  value={files}
                  placeholder={`${roleName}: ${role.max_files}`}
                  onChange={(e) => setFiles(e.target.value)}
                  error={errors.max_files}
                  className="tabular-nums"
                />
                <p className="text-xs text-ink-muted">Empty: {role.max_files}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-muted">
                Applies now: {formatBytes(storage.effective.max_file_bytes)} per file,{' '}
                {formatBytes(storage.effective.max_workspace_bytes)} per workspace,{' '}
                {storage.effective.max_files} files.
              </p>
              <Button size="sm" onClick={followRole} disabled={!hasOwn}>
                <RotateCcw aria-hidden className="size-3.5" />
                Use the {roleName}&apos; limits
              </Button>
            </div>
          </section>

          <section aria-labelledby="their-workspaces" className="flex flex-col gap-2">
            <h3 id="their-workspaces" className="font-semibold">
              Their workspaces
            </h3>
            {storage.workspaces.length === 0 ? (
              <p className="text-sm text-ink-muted">No workspaces yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                {storage.workspaces.map((w) => (
                  <WorkspaceRow
                    key={w.workspace_id}
                    w={w}
                    limits={storage.effective}
                    onClear={() => setToClear(w)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save limits
        </Button>
      </DialogFooter>

      <ConfirmDialog
        open={toClear !== null}
        title={toClear ? `Clear the ${workspaceName(toClear)} of ${user.full_name}?` : ''}
        confirmLabel="Clear workspace"
        destructive
        loading={clear.isPending}
        onConfirm={() => toClear && clearWorkspace(toClear)}
        onCancel={() => setToClear(null)}
      >
        {toClear && (
          <>
            {toClear.files} {toClear.files === 1 ? 'file' : 'files'} ({formatBytes(toClear.bytes)})
            will be deleted, with their saved versions.{' '}
            {toClear.class_id === null
              ? 'Their Practice workspace will be left empty.'
              : 'The starter files of the class’s published activities will be restored.'}{' '}
            Submissions and grades are kept.{' '}
            <strong className="text-ink">This cannot be undone.</strong>
          </>
        )}
      </ConfirmDialog>
    </form>
  )
}

/** "CC 101 workspace", "Practice workspace". */
const workspaceName = (w: WorkspaceUsage): string => `${w.class_name ?? 'Practice'} workspace`

function WorkspaceRow({
  w,
  limits,
  onClear,
}: {
  w: WorkspaceUsage
  limits: UserStorage['effective']
  onClear: () => void
}) {
  const ratio = limits.max_workspace_bytes > 0 ? w.bytes / limits.max_workspace_bytes : 0
  const over = w.bytes > limits.max_workspace_bytes || w.files > limits.max_files
  const color = over || ratio >= 0.95 ? 'bg-error' : ratio >= 0.8 ? 'bg-warn' : 'bg-ok'
  const name = w.class_name ?? 'Practice'
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-ink-strong">
          {name}
          {w.class_id === null && (
            <span className="font-normal text-ink-muted"> · My workspace</span>
          )}
        </span>
        {over && <Badge tone="error">Over the limit</Badge>}
        <span className="text-xs text-ink-muted tabular-nums">
          {formatBytes(w.bytes)} of {formatBytes(limits.max_workspace_bytes)} · {w.files}/
          {limits.max_files} files
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Clear the ${workspaceName(w)}`}
          title="Delete everything in this workspace"
          // An empty Practice workspace has nothing to clear (a class one still gets its starter files back).
          disabled={w.class_id === null && w.files === 0}
          onClick={onClear}
        >
          <Eraser aria-hidden className="size-3.5" />
          Clear
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label={`Storage used in ${name}`}
        aria-valuemin={0}
        aria-valuemax={limits.max_workspace_bytes}
        aria-valuenow={w.bytes}
        aria-valuetext={`${formatBytes(w.bytes)} of ${formatBytes(limits.max_workspace_bytes)} used`}
        className="h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </li>
  )
}
