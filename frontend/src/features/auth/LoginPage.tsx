import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AlertCircle, Info } from 'lucide-react'
import { useLogin } from '@/api/queries/auth'
import { ApiError } from '@/api/errors'
import { HOME_BY_ROLE, useAuth, type SignOutReason } from '@/auth/AuthContext'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'
import { TextField } from '@/components/ui/TextField'

const REASON_TEXT: Record<SignOutReason, string> = {
  replaced: 'You were signed in on another device. Sign in again to continue here.',
  expired: 'Your session has ended. Please sign in again.',
}

/** Login failures (wrong password, disabled account) are shown above the form, in the server's words. */
function describeLoginError(err: unknown): string {
  if (err instanceof ApiError) return err.detail
  return 'Something went wrong. Please try again.'
}

export function LoginPage() {
  const { user, loading, signOutReason, signIn } = useAuth()
  const login = useLogin()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)

  if (loading) return <PageSpinner label="Loading" />
  if (user) return <Navigate to={HOME_BY_ROLE[user.role]} replace />

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const errors: typeof fieldErrors = {}
    if (!username.trim()) errors.username = 'Enter your username.'
    if (!password) errors.password = 'Enter your password.'
    setFieldErrors(errors)
    setFormError(null)
    if (errors.username || errors.password) return

    login.mutate(
      { username: username.trim(), password },
      {
        onSuccess: (me) => signIn(me),
        onError: (err) => {
          setPassword('')
          setFormError(describeLoginError(err))
        },
      },
    )
  }

  return (
    <div className="auth-backdrop flex min-h-full items-center justify-center overflow-auto p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-11" />
          <div className="leading-tight">
            <h1 className="text-xl font-semibold">Laboratory Management</h1>
            <p className="text-sm text-ink-muted">Colegio de Kidapawan · BSIT</p>
          </div>
        </div>

        {signOutReason && (
          <div
            role="status"
            className="mb-4 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn"
          >
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p className="font-medium">{REASON_TEXT[signOutReason]}</p>
          </div>
        )}

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 card p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Sign in</h2>

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
            label="Username"
            name="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={fieldErrors.username}
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
          />

          <Button type="submit" variant="primary" size="lg" loading={login.isPending}>
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-muted">
          No account yet?{' '}
          <Link to="/signup" className="font-medium text-brand-700 underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
