import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { useRegister } from '@/api/queries/registration'
import { ApiError } from '@/api/errors'
import { HOME_BY_ROLE, useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import {
  formatCodeInput,
  validateSignup,
  type SignupErrors,
  type SignupForm,
} from '@/lib/registration'

const EMPTY: SignupForm = {
  code: '',
  studentNo: '',
  fullName: '',
  username: '',
  password: '',
  confirm: '',
}

/** Public student sign-up with a one-time code from an administrator. */
export function SignupPage() {
  const { user, loading, signIn } = useAuth()
  const register = useRegister()
  const [form, setForm] = useState<SignupForm>(EMPTY)
  const [errors, setErrors] = useState<SignupErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  if (loading) return <PageSpinner label="Loading" />
  if (user) return <Navigate to={HOME_BY_ROLE[user.role]} replace />

  const set = <K extends keyof SignupForm>(key: K, value: SignupForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    // Editing a field clears its own complaint (the server's or ours).
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))
  }

  /** Puts the server's refusal next to the field it is about. */
  function showServerError(err: unknown) {
    if (!(err instanceof ApiError)) {
      setFormError('Something went wrong. Please try again.')
    } else if (err.code === 'INVALID_REGISTRATION_CODE') {
      setErrors({ code: 'Invalid or expired code. Ask your administrator for a new one.' })
    } else if (err.code === 'USERNAME_TAKEN') {
      setErrors({ username: err.detail })
    } else if (err.code === 'STUDENT_NO_TAKEN') {
      setErrors({ studentNo: err.detail })
    } else if (err.status === 429) {
      // The server allows only a few sign-up attempts per minute from one computer (it slows down
      // code guessing). Say so plainly: the server's own wording is terse.
      setFormError('Too many sign-up attempts. Please wait a minute, then try again.')
    } else {
      // DUPLICATE_USER (a race: username or student number just taken), validation, rate limits...
      setFormError(err.detail)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const found = validateSignup(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    register.mutate(
      {
        code: form.code,
        student_no: form.studentNo.trim(),
        full_name: form.fullName.trim(),
        username: form.username.trim(),
        password: form.password,
      },
      {
        onSuccess: (created) => {
          toast.success('Welcome!')
          // The server already signed this student in; the page redirects to their home.
          signIn(created)
        },
        onError: showServerError,
      },
    )
  }

  return (
    <div className="auth-backdrop flex min-h-full items-center justify-center overflow-auto p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-11" />
          <div className="leading-tight">
            <h1 className="text-xl font-semibold">Create your account</h1>
            <p className="text-sm text-ink-muted">Colegio de Kidapawan · BSIT</p>
          </div>
        </div>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 card p-6 shadow-sm">
          <p className="text-sm text-ink-muted">
            You need a registration code from your administrator. Each code works once.
          </p>

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
            label="Registration code"
            value={form.code}
            onChange={(e) => set('code', formatCodeInput(e.target.value))}
            error={errors.code}
            placeholder="XXXXX-XXXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            className="font-mono text-lg! tracking-widest uppercase"
          />
          <TextField
            label="Student number"
            value={form.studentNo}
            onChange={(e) => set('studentNo', e.target.value)}
            error={errors.studentNo}
            maxLength={32}
            autoComplete="off"
          />
          <TextField
            label="Full name"
            value={form.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            error={errors.fullName}
            maxLength={150}
            autoComplete="name"
          />
          <div>
            <TextField
              label="Username"
              // Usernames here are lower case only (the server lower-cases them too).
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
                4–32 characters: lowercase letters, digits, dot and underscore.
              </p>
            )}
          </div>
          <TextField
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            error={errors.password}
            autoComplete="new-password"
          />
          <TextField
            label="Confirm password"
            type="password"
            value={form.confirm}
            onChange={(e) => set('confirm', e.target.value)}
            error={errors.confirm}
            autoComplete="new-password"
          />

          <Button type="submit" variant="primary" size="lg" loading={register.isPending}>
            Create account
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-700 underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
