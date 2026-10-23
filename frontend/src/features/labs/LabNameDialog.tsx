import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateLab, useRenameLab } from '@/api/queries/labs'
import { errorMessage } from '@/api/errors'
import type { Lab } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'

/** A lab is just a named room: a new one (it opens once created), or a new name for `lab`. */
export function LabNameDialog({
  open,
  lab = null,
  onClose,
}: {
  open: boolean
  lab?: Lab | null
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title={lab ? 'Rename lab' : 'New lab'}>
      {lab ? <RenameForm lab={lab} onClose={onClose} /> : <CreateForm onClose={onClose} />}
    </Dialog>
  )
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const create = useCreateLab()
  const navigate = useNavigate()
  return (
    <NameForm
      initial=""
      submitLabel="Create lab"
      pending={create.isPending}
      onCancel={onClose}
      onSave={(name, fail) =>
        create.mutate(
          { name },
          {
            onSuccess: (made) => {
              toast.success(`${made.name} created`)
              onClose()
              navigate(`/labs/${made.id}`)
            },
            onError: fail,
          },
        )
      }
    />
  )
}

function RenameForm({ lab, onClose }: { lab: Lab; onClose: () => void }) {
  const rename = useRenameLab(lab.id)
  return (
    <NameForm
      initial={lab.name}
      submitLabel="Rename"
      pending={rename.isPending}
      onCancel={onClose}
      onSave={(name, fail) =>
        name === lab.name
          ? onClose()
          : rename.mutate(
              { name },
              {
                onSuccess: () => {
                  toast.success(`Renamed to ${name}`)
                  onClose()
                },
                onError: fail,
              },
            )
      }
    />
  )
}

function NameForm({
  initial,
  submitLabel,
  pending,
  onCancel,
  onSave,
}: {
  initial: string
  submitLabel: string
  pending: boolean
  onCancel: () => void
  /** `fail` shows the server's refusal (e.g. LAB_NAME_TAKEN) under the name. */
  onSave: (name: string, fail: (err: unknown) => void) => void
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | null>(null)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Give the lab a name, e.g. "Lab A".')
    setError(null)
    onSave(trimmed, (err) => setError(errorMessage(err)))
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody>
        <TextField
          label="Lab name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          maxLength={100}
          autoFocus
        />
      </DialogBody>
      <DialogFooter>
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={pending}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
