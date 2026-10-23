import { useState, type FormEvent } from 'react'
import { useCreateInviteCode, useUpdateInviteCode } from '@/api/queries/inviteCodes'
import { errorMessage } from '@/api/errors'
import type { InviteCode } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'
import { isoToManilaInput, manilaInputFromNow, manilaInputToIso } from '@/lib/time'

interface Props {
  classId: number
  open: boolean
  /** The code whose window is being edited, or null to create a new one. */
  code: InviteCode | null
  onClose: () => void
}

export function InviteCodeFormDialog({ classId, open, code, onClose }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={code ? `Edit code ${code.code}` : 'New invite code'}
    >
      <CodeForm classId={classId} code={code} onClose={onClose} />
    </Dialog>
  )
}

function CodeForm({ classId, code, onClose }: Omit<Props, 'open'>) {
  const create = useCreateInviteCode(classId)
  const update = useUpdateInviteCode(classId, { silent: true })
  const isEdit = code !== null

  const [from, setFrom] = useState(code ? isoToManilaInput(code.valid_from) : manilaInputFromNow())
  const [until, setUntil] = useState(
    code ? isoToManilaInput(code.valid_until) : manilaInputFromNow(7 * 24 * 60),
  )
  const [maxUses, setMaxUses] = useState(code?.max_uses ? String(code.max_uses) : '')
  const [errors, setErrors] = useState<{ from?: string; until?: string; maxUses?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<InviteCode | null>(null)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const fromIso = manilaInputToIso(from)
    const untilIso = manilaInputToIso(until)
    const found: typeof errors = {}
    if (!fromIso) found.from = 'Choose when the code starts working.'
    if (!untilIso) found.until = 'Choose when the code stops working.'
    if (fromIso && untilIso && new Date(untilIso) <= new Date(fromIso)) {
      found.until = 'The end must be after the start.'
    }
    const limit = maxUses.trim() === '' ? null : Number(maxUses)
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
      found.maxUses = 'Enter a whole number of 1 or more, or leave it empty for no limit.'
    }
    setErrors(found)
    if (Object.keys(found).length || !fromIso || !untilIso) return

    const onError = (err: unknown) => setFormError(errorMessage(err))
    if (code) {
      // An empty limit is sent as an explicit null: that is how the backend removes it.
      update.mutate(
        { id: code.id, body: { valid_from: fromIso, valid_until: untilIso, max_uses: limit } },
        { onSuccess: onClose, onError },
      )
    } else {
      create.mutate(
        { valid_from: fromIso, valid_until: untilIso, max_uses: limit },
        { onSuccess: setCreated, onError },
      )
    }
  }

  if (created) {
    return (
      <>
        <DialogBody>
          <p className="text-sm text-ink-muted">Give this code to your students:</p>
          <div className="mt-3 flex items-center justify-center gap-4 rounded-lg bg-surface-2 py-6">
            <span className="font-mono text-4xl font-bold tracking-[0.3em]">{created.code}</span>
            <CopyButton text={created.code} label={`Copy code ${created.code}`} />
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            Students who use it still wait for your approval. You can turn the code off on the
            Invite codes tab.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </>
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
            label="Works from"
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            error={errors.from}
          />
          <TextField
            label="Works until"
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            error={errors.until}
          />
          <TextField
            label="Maximum uses (optional)"
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="No limit"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            error={errors.maxUses}
          />
          <p className="text-sm text-ink-muted">Times are in Philippine time (Asia/Manila).</p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={create.isPending || update.isPending}>
          {isEdit ? 'Save changes' : 'Create code'}
        </Button>
      </DialogFooter>
    </form>
  )
}
