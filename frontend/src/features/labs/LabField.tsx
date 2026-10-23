import { useState } from 'react'
import { useLabs } from '@/api/queries/labs'
import { useUpdateSession } from '@/api/queries/sessions'
import { errorMessage } from '@/api/errors'
import type { LabSession as Session } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { SelectField } from '@/components/ui/SelectField'
import { toast } from '@/components/ui/toastStore'
import { LabSchedule } from './LabSchedule'

/** The room of a lab session (required), with who else has that room booked, day by day. */
export function LabField({
  value,
  onChange,
  error,
  sessionId,
}: {
  /** Null only until one is chosen: every session needs a lab. */
  value: number | null
  onChange: (labId: number | null) => void
  /** E.g. "Choose the lab." */
  error?: string
  /** The session being edited, if any: its own booking is not listed as someone else's. */
  sessionId?: number
}) {
  const labs = useLabs()
  const noLabs = labs.isSuccess && labs.data.length === 0
  return (
    <>
      <div className="flex flex-col gap-1">
        <SelectField
          label="Lab (room)"
          value={value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          disabled={labs.isPending || noLabs}
          aria-invalid={error ? true : undefined}
          options={[
            {
              value: '',
              label: labs.isPending ? 'Loading labs…' : noLabs ? 'No labs yet' : 'Choose a lab…',
            },
            ...(labs.data ?? []).map((l) => ({ value: String(l.id), label: l.name })),
          ]}
        />
        {error && <p className="text-sm text-error">{error}</p>}
        {noLabs && (
          <p className="text-sm text-warn">
            There are no labs yet. An administrator adds the computer rooms under Labs.
          </p>
        )}
      </div>
      {value !== null && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Already booked in this lab</p>
          <LabSchedule labId={value} exceptSessionId={sessionId} compact />
        </div>
      )}
    </>
  )
}

/** Moves an existing session to another lab (PATCH /sessions/{id} {lab_id}). */
export function ChangeLabDialog({
  classId,
  session,
  onClose,
}: {
  classId: number
  session: Session | null
  onClose: () => void
}) {
  return (
    <Dialog open={session !== null} onClose={onClose} title="Change lab">
      {session && (
        <ChangeLabForm key={session.id} classId={classId} session={session} onClose={onClose} />
      )}
    </Dialog>
  )
}

function ChangeLabForm({
  classId,
  session,
  onClose,
}: {
  classId: number
  session: Session
  onClose: () => void
}) {
  const update = useUpdateSession(classId)
  const [labId, setLabId] = useState<number | null>(session.lab_id ?? null)
  const [labError, setLabError] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        if (labId === null) return setLabError('Choose the lab.')
        setLabError(undefined)
        if (labId === session.lab_id) return onClose()
        update.mutate(
          { id: session.id, body: { lab_id: labId } },
          {
            onSuccess: () => {
              toast.success(`${session.name} moved to another lab`)
              onClose()
            },
            // LAB_BOOKED / LAB_IN_USE: the server names who has the room.
            onError: (err) => setError(errorMessage(err)),
          },
        )
      }}
    >
      <DialogBody>
        <div className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}
          <p className="text-sm text-ink-muted">{session.name}</p>
          <LabField
            value={labId}
            onChange={(v) => {
              setLabId(v)
              setLabError(undefined)
            }}
            error={labError}
            sessionId={session.id}
          />
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
