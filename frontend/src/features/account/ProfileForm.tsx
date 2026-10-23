import { useState, type FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import { ApiError } from '@/api/errors'
import { useUpdateProfile } from '@/api/queries/auth'
import type { Role, User } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import {
  changedProfileFields,
  profileFormOf,
  validateProfile,
  FULL_NAME_MAX,
  type ProfileErrors,
  type ProfileForm as Form,
} from '@/lib/account'

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrator',
  instructor: 'Instructor',
  student: 'Student',
}

/** The two things a user may change about themselves, and the ones only an administrator can. */
export function ProfileForm({ user }: { user: User }) {
  const { updateUser } = useAuth()
  const update = useUpdateProfile()
  const [form, setForm] = useState<Form>(() => profileFormOf(user))
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const body = changedProfileFields(user, form)
  const unchanged = Object.keys(body).length === 0

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))
  }

  function showServerError(err: unknown) {
    if (err instanceof ApiError && err.code === 'USERNAME_TAKEN') {
      setErrors({ username: 'That username is already taken. Choose another.' })
    } else {
      setFormError(err instanceof ApiError ? err.detail : 'Something went wrong. Please try again.')
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const found = validateProfile(form)
    setErrors(found)
    if (Object.keys(found).length > 0 || unchanged) return

    update.mutate(body, {
      onSuccess: (updated) => {
        // The user stays signed in; the rest of the app now shows the new name and username.
        updateUser(updated)
        setForm(profileFormOf(updated))
        toast.success('Profile updated')
      },
      onError: showServerError,
    })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md bg-error-soft px-3 py-2 text-sm text-error"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>{formError}</p>
        </div>
      )}

      <TextField
        label="Full name"
        value={form.fullName}
        onChange={(e) => set('fullName', e.target.value)}
        error={errors.fullName}
        maxLength={FULL_NAME_MAX}
        autoComplete="name"
      />
      <div>
        <TextField
          label="Username"
          // Usernames are lower case only (the server lower-cases them too).
          value={form.username}
          onChange={(e) => set('username', e.target.value.toLowerCase())}
          error={errors.username}
          maxLength={32}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
        />
        {!errors.username && (
          <p className="mt-1.5 text-sm text-ink-muted">
            4–32 characters: lowercase letters, digits, dot and underscore. You use it to sign in.
          </p>
        )}
      </div>

      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 rounded-md border border-line bg-canvas px-4 py-3 text-sm">
        <dt className="text-ink-muted">Role</dt>
        <dd>{ROLE_LABEL[user.role]}</dd>
        <dt className="text-ink-muted">Student number</dt>
        <dd>{user.student_no ?? <span className="text-ink-muted">—</span>}</dd>
        <dt className="text-ink-muted">Account</dt>
        <dd>
          <Badge tone={user.is_active ? 'ok' : 'pending'}>
            {user.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </dd>
      </dl>
      <p className="-mt-2 text-sm text-ink-muted">
        Only an administrator can change your student number, role or whether the account is active.
      </p>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={update.isPending} disabled={unchanged}>
          Save changes
        </Button>
        {unchanged ? null : <p className="text-sm text-ink-muted">You have unsaved changes.</p>}
      </div>
    </form>
  )
}
