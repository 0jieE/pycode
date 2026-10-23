import { useState, type FormEvent } from 'react'
import { useCreateRegistrationCodes } from '@/api/queries/registration'
import { ApiError, errorMessage } from '@/api/errors'
import type { RegistrationCodesCreated } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import { TextField } from '@/components/ui/TextField'
import { manilaInputToIso } from '@/lib/time'

/** The codes just generated, plus what the CSV needs that the server does not echo back. */
export interface GeneratedCodes {
  created: RegistrationCodesCreated
  /** Set for a single code that was tied to one student number. */
  studentNo: string | null
}

type Mode = 'single' | 'bulk'

interface Props {
  open: boolean
  onClose: () => void
  onGenerated: (result: GeneratedCodes) => void
}

export function GenerateCodesDialog({ open, onClose, onGenerated }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Generate registration codes" width="max-w-lg">
      <GenerateForm onClose={onClose} onGenerated={onGenerated} />
    </Dialog>
  )
}

interface Errors {
  batch?: string
  count?: string
  studentNo?: string
  expiry?: string
}

function GenerateForm({ onClose, onGenerated }: Omit<Props, 'open'>) {
  const create = useCreateRegistrationCodes()
  const [mode, setMode] = useState<Mode>('single')
  // Kept separately so switching tabs does not lose what was typed.
  const [batchSingle, setBatchSingle] = useState('Individual codes')
  const [batchBulk, setBatchBulk] = useState('')
  const [count, setCount] = useState('30')
  const [studentNo, setStudentNo] = useState('')
  const [fullName, setFullName] = useState('')
  const [expiry, setExpiry] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const batch = (mode === 'single' ? batchSingle : batchBulk).trim()

  function showServerError(err: unknown) {
    if (err instanceof ApiError && err.code === 'INVALID_EXPIRY') setErrors({ expiry: err.detail })
    else if (err instanceof ApiError && err.code === 'STUDENT_NO_TAKEN') {
      setErrors({ studentNo: err.detail })
    } else setFormError(errorMessage(err))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const found: Errors = {}
    if (!batch) found.batch = 'Enter a batch name, for example "BSIT 1-A 2026".'

    const total = mode === 'single' ? 1 : Number(count)
    if (mode === 'bulk' && (!Number.isInteger(total) || total < 1 || total > 200)) {
      found.count = 'Enter a whole number from 1 to 200.'
    }

    let expiresAt: string | null = null
    if (expiry) {
      expiresAt = manilaInputToIso(expiry)
      if (!expiresAt) found.expiry = 'That date is not valid.'
      else if (new Date(expiresAt).getTime() <= Date.now())
        found.expiry = 'Choose a time in the future.'
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return

    const bound = mode === 'single' && studentNo.trim() ? studentNo.trim() : null
    create.mutate(
      {
        count: total,
        batch_name: batch,
        expires_at: expiresAt,
        // Only a single code can be tied to a student; the server refuses it otherwise.
        student_no: bound,
        full_name: mode === 'single' && fullName.trim() ? fullName.trim() : null,
      },
      {
        onSuccess: (created) => {
          onGenerated({ created, studentNo: bound })
          // Nothing of the codes stays in this form.
          create.reset()
          onClose()
        },
        onError: showServerError,
      },
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pt-3">
        <Tabs
          label="How many codes"
          active={mode}
          onChange={(id) => {
            setMode(id as Mode)
            setErrors({})
            setFormError(null)
          }}
          tabs={[
            { id: 'single', label: 'Single' },
            { id: 'bulk', label: 'Bulk' },
          ]}
        />
      </div>
      <DialogBody>
        <TabPanel id={mode}>
          <div className="flex flex-col gap-4">
            {formError && (
              <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
                {formError}
              </p>
            )}

            {mode === 'single' ? (
              <>
                <p className="text-sm text-ink-muted">
                  One code for one person. You can tie it to a student number, and prefill the name
                  that will be used for the account.
                </p>
                <TextField
                  label="Student number (optional)"
                  value={studentNo}
                  onChange={(e) => setStudentNo(e.target.value)}
                  error={errors.studentNo}
                  maxLength={32}
                  autoComplete="off"
                />
                <TextField
                  label="Full name (optional)"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={150}
                  autoComplete="off"
                />
                <TextField
                  label="Batch name"
                  value={batchSingle}
                  onChange={(e) => setBatchSingle(e.target.value)}
                  error={errors.batch}
                  maxLength={100}
                  autoComplete="off"
                />
              </>
            ) : (
              <>
                <p className="text-sm text-ink-muted">
                  Many codes at once, for a whole class. Print them as slips and hand one to each
                  student.
                </p>
                <TextField
                  label="Number of codes (1–200)"
                  type="number"
                  min={1}
                  max={200}
                  inputMode="numeric"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  error={errors.count}
                />
                <TextField
                  label="Batch name"
                  placeholder="e.g. BSIT 1-A 2026"
                  value={batchBulk}
                  onChange={(e) => setBatchBulk(e.target.value)}
                  error={errors.batch}
                  maxLength={100}
                  autoComplete="off"
                />
              </>
            )}

            <div>
              <TextField
                label="Expires (optional)"
                type="datetime-local"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                error={errors.expiry}
              />
              <p className="mt-1.5 text-sm text-ink-muted">
                Philippine time. Leave it empty for codes that do not expire.
              </p>
            </div>
          </div>
        </TabPanel>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          {mode === 'single' ? 'Generate code' : 'Generate codes'}
        </Button>
      </DialogFooter>
    </form>
  )
}
