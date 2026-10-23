import { useState, type FormEvent } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { GraduationCap, HardDrive, Presentation, RotateCcw } from 'lucide-react'
import { useStorageLimits, useUpdateRoleLimits } from '@/api/queries/storage'
import { errorMessage } from '@/api/errors'
import type { RoleStorageLimits, StorageBounds, StorageLimitsUpdate } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Spinner'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import { formatBytes } from '@/lib/format'
import {
  DEFAULT_LIMITS,
  inputBytes,
  inputCount,
  limitErrors,
  sizeInput,
  type LimitErrors,
  type SizeInput,
} from '@/lib/storageLimits'
import { STORAGE_ROLE_PAGES, type LimitRole } from '@/lib/adminRoutes'
import { formatDateTime } from '@/lib/time'
import { SizeField } from './SizeField'

const ROLES: Record<LimitRole, { title: string; icon: typeof GraduationCap; who: string }> = {
  student: { title: 'Students', icon: GraduationCap, who: 'every student' },
  instructor: { title: 'Instructors', icon: Presentation, who: 'every instructor' },
}

/**
 * How much each workspace may hold, per role. One user can be given other limits from the Users page (Storage).
 */
export function StorageLimitsPage() {
  const { role: slug } = useParams()
  const role = STORAGE_ROLE_PAGES.find((p) => p.slug === slug)?.role
  const limits = useStorageLimits()
  if (!role) return <Navigate to="/admin/storage/students" replace />

  return (
    <div className="page">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <HardDrive aria-hidden className="size-6 text-ink-muted" />
          Storage
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          How much code each workspace may hold. The limits apply to <em>each</em> workspace of a
          user: every class workspace and their Practice workspace. Choose students or instructors
          on the left. To give one person other limits, open Users and choose Storage on their row.
        </p>
      </header>

      {limits.isError && !limits.data ? (
        <EmptyState
          title="The storage limits could not be loaded"
          action={<Button onClick={() => void limits.refetch()}>Try again</Button>}
        >
          {errorMessage(limits.error)}
        </EmptyState>
      ) : limits.isPending ? (
        <Skeleton className="h-80 w-full max-w-3xl" />
      ) : (
        <div className="max-w-3xl">
          <RoleCard
            // A fresh form for the other role, after a save, or after a change elsewhere.
            key={`${role}@${limits.data[role].updated_at ?? 'default'}`}
            role={role}
            {...ROLES[role]}
            current={limits.data[role]}
            bounds={limits.data.bounds}
          />
        </div>
      )}

      <p className="max-w-3xl text-sm text-ink-muted">
        Lowering a limit deletes nothing. A workspace that is already over it keeps its files, but
        new files and saves that make it bigger are refused until it is back under; saves that make
        it smaller still work. Activity starter files may be as large as the students&apos; file
        limit.
      </p>
    </div>
  )
}

function RoleCard({
  role,
  title,
  icon: Icon,
  who,
  current,
  bounds,
}: {
  role: LimitRole
  title: string
  icon: typeof GraduationCap
  who: string
  current: RoleStorageLimits
  bounds: StorageBounds
}) {
  const update = useUpdateRoleLimits()
  const [file, setFile] = useState<SizeInput>(() => sizeInput(current.max_file_bytes))
  const [workspace, setWorkspace] = useState<SizeInput>(() =>
    sizeInput(current.max_workspace_bytes),
  )
  const [files, setFiles] = useState(String(current.max_files))
  const [errors, setErrors] = useState<LimitErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const values = {
    max_file_bytes: inputBytes(file),
    max_workspace_bytes: inputBytes(workspace),
    max_files: inputCount(files),
  }
  const changes: StorageLimitsUpdate = {}
  if (values.max_file_bytes !== current.max_file_bytes)
    changes.max_file_bytes = values.max_file_bytes
  if (values.max_workspace_bytes !== current.max_workspace_bytes)
    changes.max_workspace_bytes = values.max_workspace_bytes
  if (values.max_files !== current.max_files) changes.max_files = values.max_files
  const dirty = Object.keys(changes).length > 0
  const isDefault =
    values.max_file_bytes === DEFAULT_LIMITS.max_file_bytes &&
    values.max_workspace_bytes === DEFAULT_LIMITS.max_workspace_bytes &&
    values.max_files === DEFAULT_LIMITS.max_files

  function applyDefaults() {
    setFile(sizeInput(DEFAULT_LIMITS.max_file_bytes))
    setWorkspace(sizeInput(DEFAULT_LIMITS.max_workspace_bytes))
    setFiles(String(DEFAULT_LIMITS.max_files))
    setErrors({})
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    setFormError(null)
    const found = limitErrors(values, bounds, { required: true })
    setErrors(found)
    if (Object.keys(found).length > 0 || !dirty) return
    update.mutate(
      { role, body: changes },
      {
        onSuccess: () => toast.success(`Storage limits saved for ${title.toLowerCase()}`),
        onError: (err) => setFormError(errorMessage(err)),
      },
    )
  }

  const headingId = `limits-${role}`
  return (
    <section aria-labelledby={headingId} className="card">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 p-5">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
              <Icon aria-hidden className="size-5 text-ink-muted" />
              {title}
            </h2>
            <p className="text-sm text-ink-muted">For each workspace of {who}.</p>
          </div>
          {current.updated_at ? (
            <span className="text-xs text-ink-muted">
              Changed {formatDateTime(current.updated_at)}
            </span>
          ) : (
            <Badge tone="pending">Defaults</Badge>
          )}
        </header>

        {formError && (
          <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
            {formError}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <SizeField
            label="Largest file"
            value={file}
            onChange={setFile}
            error={errors.max_file_bytes}
            hint={`${formatBytes(bounds.max_file_bytes.min)} – ${formatBytes(bounds.max_file_bytes.max)}`}
          />
          <SizeField
            label="Workspace size"
            value={workspace}
            onChange={setWorkspace}
            error={errors.max_workspace_bytes}
            hint={`${formatBytes(bounds.max_workspace_bytes.min)} – ${formatBytes(bounds.max_workspace_bytes.max)}`}
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
              onChange={(e) => setFiles(e.target.value)}
              error={errors.max_files}
              className="tabular-nums"
            />
            <p className="text-xs text-ink-muted">
              {bounds.max_files.min} – {bounds.max_files.max}
            </p>
          </div>
        </div>

        <p className="text-sm text-ink-muted">
          Now: {formatBytes(current.max_file_bytes)} per file,{' '}
          {formatBytes(current.max_workspace_bytes)} per workspace, {current.max_files} files.
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={applyDefaults} disabled={isDefault}>
            <RotateCcw aria-hidden className="size-4" />
            Use the defaults
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty} loading={update.isPending}>
            Save {title.toLowerCase()}
          </Button>
        </div>
      </form>
    </section>
  )
}
