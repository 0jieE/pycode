import { useState, type FormEvent } from 'react'
import { useCreateSession } from '@/api/queries/sessions'
import { errorMessage } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import { manilaInputFromNow, manilaInputToIso } from '@/lib/time'
import { LabField } from '@/features/labs/LabField'

interface Props {
  classId: number
  open: boolean
  onClose: () => void
}

export function SessionFormDialog({ classId, open, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="New lab session">
      <SessionForm classId={classId} onClose={onClose} />
    </Dialog>
  )
}

function SessionForm({ classId, onClose }: Omit<Props, 'open'>) {
  const create = useCreateSession(classId)
  const [name, setName] = useState('')
  // A lab period is about 40 minutes.
  const [starts, setStarts] = useState(() => manilaInputFromNow())
  const [ends, setEnds] = useState(() => manilaInputFromNow(40))
  const [labId, setLabId] = useState<number | null>(null)
  const [errors, setErrors] = useState<{
    name?: string
    starts?: string
    ends?: string
    lab?: string
  }>({})
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
    if (labId === null) found.lab = 'Choose the lab: every session takes place in one.'
    setErrors(found)
    if (Object.keys(found).length || !startIso || !endIso || labId === null) return

    create.mutate(
      {
        name: name.trim(),
        starts_at: startIso,
        ends_at: endIso,
        lab_id: labId,
      },
      {
        onSuccess: () => {
          toast.success('Session created')
          onClose()
        },
        // LAB_BOOKED: the server names who has the room then.
        onError: (err) => setFormError(errorMessage(err)),
      },
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody>
        <div className="flex flex-col gap-4">
          {formError && (
            <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
              {formError}
            </p>
          )}
          <TextField
            label="Session name"
            placeholder="e.g. Week 3"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            maxLength={100}
            autoFocus
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
          />
          <LabField
            value={labId}
            onChange={(v) => {
              setLabId(v)
              setErrors((e) => ({ ...e, lab: undefined }))
            }}
            error={errors.lab}
          />
          <p className="text-sm text-ink-muted">
            Times are in Philippine time (Asia/Manila). Students can work only while the session is
            open: open it with OPEN ACCESS when class starts. It closes by itself at its end time.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Create session
        </Button>
      </DialogFooter>
    </form>
  )
}
