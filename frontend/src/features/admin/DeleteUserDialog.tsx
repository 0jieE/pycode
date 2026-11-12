import { useState, type FormEvent } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useDeletePreview, useDeleteUser } from '@/api/queries/users'
import { errorMessage } from '@/api/errors'
import type { DeletePreview, User } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { Skeleton } from '@/components/ui/Spinner'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import { formatBytes } from '@/lib/format'

/**
 * Deletes an instructor or student for good, with everything that is only theirs. Shows what will go (from the
 * server's preview), refuses when something blocks it, and asks for the username to be typed first.
 */
export function DeleteUserDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  return (
    <Dialog
      open={user !== null}
      onClose={onClose}
      title={user ? `Delete ${user.full_name}?` : ''}
      width="max-w-md"
    >
      {user && <DeleteUserForm user={user} onClose={onClose} />}
    </Dialog>
  )
}

function DeleteUserForm({ user, onClose }: { user: User; onClose: () => void }) {
  const preview = useDeletePreview(user.id)
  const del = useDeleteUser()
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)

  const p = preview.data
  const blocked = (p?.blocked_by.length ?? 0) > 0
  const matches = typed.trim() === user.username

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!p || blocked || !matches) return
    setError(null)
    del.mutate(user.id, {
      onSuccess: () => {
        toast.success(`${user.full_name} was deleted`)
        onClose()
      },
      onError: (err) => {
        setError(errorMessage(err))
        // Something changed meanwhile (a class, a run): show the current state.
        void preview.refetch()
      },
    })
  }

  return (
    <form onSubmit={submit} noValidate>
      <DialogBody>
        <div className="space-y-4 text-sm">
          {preview.isPending ? (
            <div role="status" aria-label="Checking what would be deleted" className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : preview.isError ? (
            <p role="alert" className="text-error">
              {errorMessage(preview.error)}
            </p>
          ) : blocked ? (
            <>
              <div role="alert" className="space-y-2">
                <p className="font-medium text-ink-strong">This account can’t be deleted yet:</p>
                <ul className="list-disc space-y-1 pl-5 text-ink">
                  {p!.blocked_by.map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                </ul>
              </div>
              <p className="text-ink-muted">
                To stop them signing in while their work is kept, deactivate the account instead.
              </p>
            </>
          ) : (
            <>
              <p className="text-ink-muted">
                <strong className="text-ink">{user.full_name}</strong>{' '}
                <span className="font-mono text-xs">({user.username})</span> will be signed out and
                deleted for good, together with:
              </p>
              <WhatGoes p={p!} />
              {p!.in_open_session && (
                <p className="flex gap-2 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-ink">
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
                  {p!.role === 'instructor'
                    ? 'One of their classes has a lab session open right now.'
                    : 'They are in a class whose lab session is open right now.'}
                </p>
              )}
              <p className="text-ink-muted">
                <strong className="text-ink">This cannot be undone.</strong> To keep their work,
                deactivate the account instead.
              </p>
              <TextField
                label={`Type ${user.username} to confirm`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                className="w-full font-mono"
              />
            </>
          )}
          {error && (
            <p role="alert" className="text-error">
              {error}
            </p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{blocked ? 'Close' : 'Cancel'}</Button>
        {!blocked && (
          <Button type="submit" variant="danger" loading={del.isPending} disabled={!p || !matches}>
            Delete account
          </Button>
        )}
      </DialogFooter>
    </form>
  )
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** Only the things they actually have; "No saved work" when there is nothing. */
function WhatGoes({ p }: { p: DeletePreview }) {
  const lines = [
    p.enrollments > 0 && n(p.enrollments, 'class membership'),
    p.submissions > 0 && `${n(p.submissions, 'submission')}, with their grades`,
    p.executions > 0 && n(p.executions, 'run and test result', 'runs and test results'),
    p.workspaces > 0 &&
      `${n(p.workspaces, 'workspace')} (${n(p.workspace_files, 'file')}, ${formatBytes(p.workspace_bytes)})`,
    p.tutorial_lessons > 0 && `Tutorial progress on ${n(p.tutorial_lessons, 'lesson')}`,
  ].filter((x): x is string => typeof x === 'string')

  if (lines.length === 0) return <p className="text-ink">No saved work.</p>
  return (
    <ul aria-label="What will be deleted" className="list-disc space-y-1 pl-5 text-ink">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  )
}
