import { useState, type FormEvent } from 'react'
import { Wand2 } from 'lucide-react'
import { useCreateUser, useUpdateUser } from '@/api/queries/users'
import { ApiError, errorMessage } from '@/api/errors'
import type { Role, User, UserUpdate } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { SelectField } from '@/components/ui/SelectField'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import type { ManagedRole } from '@/lib/adminRoutes'
import { generatePassword } from '@/lib/password'

const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/

// The administrator is the only admin. New accounts made here are instructors (students sign up with a
// registration code); editing shows the account's own role, which never changes.
const ROLE_OPTIONS: { value: ManagedRole; label: string }[] = [
  { value: 'instructor', label: 'Instructor' },
  { value: 'student', label: 'Student' },
]

interface FieldErrors {
  full_name?: string
  username?: string
  student_no?: string
  password?: string
}

interface UserFormDialogProps {
  open: boolean
  /** The user being edited, or null to create a new one. */
  user: User | null
  onClose: () => void
}

export function UserFormDialog({ open, user, onClose }: UserFormDialogProps) {
  const title = user ? 'Edit user' : 'New instructor'
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <UserForm user={user} onClose={onClose} />
    </Dialog>
  )
}

function UserForm({ user, onClose }: { user: User | null; onClose: () => void }) {
  const isEdit = user !== null
  const create = useCreateUser()
  const update = useUpdateUser()
  const pending = create.isPending || update.isPending

  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const role: Role = user?.role ?? 'instructor'
  const [studentNo, setStudentNo] = useState(user?.student_no ?? '')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const showStudentNo = role === 'student' || (isEdit && !!user?.student_no)

  function validate(): FieldErrors {
    const e: FieldErrors = {}
    if (!fullName.trim()) e.full_name = 'Enter the full name.'
    if (!isEdit) {
      if (!USERNAME_RE.test(username.trim())) {
        e.username = 'Use 3–64 characters: letters, digits, dot, underscore or dash.'
      }
      if (password.length < 8) e.password = 'The password needs at least 8 characters.'
    }
    if (isEdit && user?.student_no && !studentNo.trim()) {
      e.student_no = "A student number can't be removed once it is set."
    }
    return e
  }

  /** Puts a server rejection next to the field it is about, or above the form otherwise. */
  function showServerError(err: unknown) {
    if (err instanceof ApiError && err.code === 'USERNAME_TAKEN') {
      setErrors({ username: err.detail })
    } else if (err instanceof ApiError && err.code === 'STUDENT_NO_TAKEN') {
      setErrors({ student_no: err.detail })
    } else {
      setFormError(errorMessage(err))
    }
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    setFormError(null)
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return

    const done = (message: string) => {
      toast.success(message)
      onClose()
    }

    if (user) {
      const body: UserUpdate = {}
      if (fullName.trim() !== user.full_name) body.full_name = fullName.trim()
      if (studentNo.trim() && studentNo.trim() !== (user.student_no ?? '')) {
        body.student_no = studentNo.trim()
      }
      if (Object.keys(body).length === 0) return onClose()
      update.mutate(
        { id: user.id, body },
        { onSuccess: () => done('User updated'), onError: showServerError },
      )
    } else {
      create.mutate(
        {
          username: username.trim(),
          password,
          full_name: fullName.trim(),
          role,
          student_no: role === 'student' && studentNo.trim() ? studentNo.trim() : null,
        },
        { onSuccess: () => done('User created'), onError: showServerError },
      )
    }
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
            label="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            error={errors.full_name}
            maxLength={150}
            autoFocus
          />
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={errors.username}
            maxLength={64}
            autoComplete="off"
            readOnly={isEdit}
            disabled={isEdit}
          />
          <SelectField
            label="Role"
            value={role}
            options={isEdit ? ROLE_OPTIONS : ROLE_OPTIONS.filter((o) => o.value === 'instructor')}
            disabled
          />
          {showStudentNo && (
            <TextField
              label="Student number"
              value={studentNo}
              onChange={(e) => setStudentNo(e.target.value)}
              error={errors.student_no}
              maxLength={32}
              autoComplete="off"
            />
          )}
          {!isEdit && (
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <TextField
                  label="Temporary password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={errors.password}
                  maxLength={128}
                  autoComplete="off"
                  className="font-mono"
                />
              </div>
              <Button className="mt-[1.65rem]" onClick={() => setPassword(generatePassword())}>
                <Wand2 aria-hidden className="size-4" />
                Generate
              </Button>
            </div>
          )}
          {isEdit && (
            <p className="text-sm text-ink-muted">
              The username and role can&apos;t be changed after the account is created.
            </p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={pending}>
          {isEdit ? 'Save changes' : 'Create instructor'}
        </Button>
      </DialogFooter>
    </form>
  )
}
