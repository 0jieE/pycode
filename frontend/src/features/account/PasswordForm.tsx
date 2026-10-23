import { useState, type FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import { ApiError } from '@/api/errors'
import { useChangePassword } from '@/api/queries/auth'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import {
  validatePasswordChange,
  type PasswordErrors,
  type PasswordForm as Form,
} from '@/lib/account'

const EMPTY: Form = { current: '', next: '', confirm: '' }

interface PasswordFormProps {
  /** Called after the server accepted the new password. */
  onChanged: () => void
  /** Shown above the fields: why they are being asked, or what will happen. */
  intro?: string
}

/**
 * Current password, then the new one typed twice (the second time is checked here, never sent). Used on the
 * account page and on the screen that makes a user choose a new password.
 */
export function PasswordForm({ onChanged, intro }: PasswordFormProps) {
  const change = useChangePassword()
  const [form, setForm] = useState<Form>(EMPTY)
  const [errors, setErrors] = useState<PasswordErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const set = (key: keyof Form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))
  }

  function showServerError(err: unknown) {
    if (!(err instanceof ApiError)) {
      setFormError('Something went wrong. Please try again.')
    } else if (err.code === 'INVALID_CURRENT_PASSWORD') {
      setErrors({ current: 'The current password is not right.' })
    } else if (err.code === 'PASSWORD_UNCHANGED') {
      setErrors({ next: 'The new password must be different from the current one.' })
    } else if (err.status === 429) {
      // TOO_MANY_ATTEMPTS (5 tries in 15 minutes), or the plain 429 of Nginx's per-address limit.
      setFormError('Too many attempts. Try again in a few minutes.')
    } else {
      setFormError(err.detail)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const found = validatePasswordChange(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    change.mutate(
      { current_password: form.current, new_password: form.next },
      {
        onSuccess: () => {
          setForm(EMPTY)
          toast.success('Password changed. Other devices were signed out.')
          onChanged()
        },
        onError: showServerError,
      },
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {intro && <p className="text-sm text-ink-muted">{intro}</p>}

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
        label="Current password"
        type="password"
        value={form.current}
        onChange={(e) => set('current', e.target.value)}
        error={errors.current}
        autoComplete="current-password"
      />
      <TextField
        label="New password"
        type="password"
        value={form.next}
        onChange={(e) => set('next', e.target.value)}
        error={errors.next}
        autoComplete="new-password"
      />
      <TextField
        label="Confirm new password"
        type="password"
        value={form.confirm}
        onChange={(e) => set('confirm', e.target.value)}
        error={errors.confirm}
        autoComplete="new-password"
      />
      <p className="-mt-2 text-sm text-ink-muted">8 to 128 characters.</p>

      <div>
        <Button type="submit" variant="primary" loading={change.isPending}>
          Change password
        </Button>
      </div>
    </form>
  )
}
