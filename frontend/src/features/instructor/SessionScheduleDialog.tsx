import { useState, type FormEvent } from 'react'
import { useUpdateSession } from '@/api/queries/sessions'
import { ApiError, errorMessage } from '@/api/errors'
import type { LabSession } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import { isoToManilaInput, manilaInputToIso } from '@/lib/time'

interface Props {
  classId: number
  session: LabSession | null
  /** Why it opened, shown on top (e.g. the server's "This session's scheduled end has passed..."). */
  notice?: string | null
  onClose: () => void
}

/**
 * Rename or reschedule a session. A session closes by itself at its end time, and one whose end has passed cannot be
 * opened: a later end time here makes Open work again.
 */
export function SessionScheduleDialog({ classId, session, notice, onClose }: Props) {
  return (
    <Dialog open={session !== null} onClose={onClose} title="Session name and times">
      {session && (
        <ScheduleForm
          key={`${session.id}@${session.ends_at}`}
          classId={classId}
          session={session}
          notice={notice ?? null}
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}

function ScheduleForm({
  classId,
  session,
  notice,
  onClose,
}: {
  classId: number
  session: LabSession
  notice: string | null
  onClose: () => void
}) {
  const update = useUpdateSession(classId)
  const [name, setName] = useState(session.name)
  const [starts, setStarts] = useState(() => isoToManilaInput(session.starts_at))
  const [ends, setEnds] = useState(() => isoToManilaInput(session.ends_at))
  const [errors, setErrors] = useState<{ name?: string; starts?: string; ends?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const startIso = manilaInputToIso(starts)
    const endIso = manilaInputToIso(ends)
    const found: typeof errors = {}
    if (!name.trim()) found.name = 'Enter a name, e.g. "Week 3".'
    if (!startIso) found.starts = 'Choose the start time.'
    if (!endIso) found.ends = 'Choose the end time.'
    if (startIso && endIso && new Date(endIso) <= new Date(startIso)) {
      found.ends = 'The end must be after the start.'
    }
    setErrors(found)
    if (Object.keys(found).length || !startIso || !endIso) return

    update.mutate(
      {
        id: session.id,
        body: { name: name.trim(), starts_at: startIso, ends_at: endIso },
      },
      {
        onSuccess: (saved) => {
          // Past its end but not yet closed by the server's sweep: saving closed it first.
          toast.success(
            session.is_open && !saved.is_open
              ? 'Session saved. It was closed because its end had passed: press Open to let students back in.'
              : 'Session saved',
          )
          onClose()
        },
        onError: (err) =>
          err instanceof ApiError && err.code === 'INVALID_SESSION_WINDOW'
            ? setErrors({ ends: err.detail })
            : setFormError(errorMessage(err)),
      },
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody>
        <div className="flex flex-col gap-4">
          {notice && (
            <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{notice}</p>
          )}
          {formError && (
            <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
              {formError}
            </p>
          )}
          <TextField
            label="Session name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            maxLength={100}
          />
          <TextField
            label="Starts"
            type="datetime-local"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
            error={errors.starts}
          />
          <TextField
            label="Ends"
            type="datetime-local"
            value={ends}
            onChange={(e) => setEnds(e.target.value)}
            error={errors.ends}
            autoFocus={notice !== null}
          />
          <p className="text-sm text-ink-muted">
            Times are in Philippine time (Asia/Manila). The session closes by itself at its end
            time; it can be opened while its end is still ahead.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={update.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
