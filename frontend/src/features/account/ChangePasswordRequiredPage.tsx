import { Navigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { HOME_BY_ROLE, useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'
import { PasswordForm } from './PasswordForm'

/**
 * Where a user lands after signing in with a temporary password (an administrator reset it, or it came from an
 * import). Nothing else in the app works until they choose their own, so this is the whole screen, with only
 * Sign out as a way out.
 */
export function ChangePasswordRequiredPage() {
  const { user, loading, refreshUser, signOut } = useAuth()

  if (loading) return <PageSpinner label="Checking your session" />
  if (!user) return <Navigate to="/login" replace />
  // Already done (or never needed): carry on to the user's own pages.
  if (!user.must_change_password) return <Navigate to={HOME_BY_ROLE[user.role]} replace />

  return (
    <div className="auth-backdrop flex min-h-full items-center justify-center overflow-auto p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <KeyRound aria-hidden className="size-9 text-ink-muted" />
          <div className="leading-tight">
            <h1 className="text-xl font-semibold">Change your password</h1>
            <p className="text-sm text-ink-muted">{user.full_name}</p>
          </div>
        </div>

        <div className="card p-6 shadow-sm">
          <PasswordForm
            intro="You are using a temporary password. Choose your own to continue: type the temporary one, then the new one twice."
            // The server clears the flag; asking who we are again is what moves the user on.
            onChanged={() => void refreshUser()}
          />
        </div>

        <p className="mt-4 text-center text-sm text-ink-muted">
          Not you?{' '}
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </p>
      </div>
    </div>
  )
}
