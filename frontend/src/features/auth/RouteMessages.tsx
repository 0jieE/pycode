import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { Navigate } from 'react-router-dom'
import { HOME_BY_ROLE, useAuth } from '@/auth/AuthContext'
import { PageSpinner } from '@/components/ui/Spinner'

/** `/` sends everyone to the home page of their role, or to the login page. */
export function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <PageSpinner label="Loading" />
  return <Navigate to={user ? HOME_BY_ROLE[user.role] : '/login'} replace />
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-ink-muted">That address does not exist.</p>
      <Link to="/" className="font-medium text-brand-700 underline">
        Go to the start page
      </Link>
    </div>
  )
}

export function RouteErrorPage() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : 'An unexpected error stopped this page from loading.'
  return (
    <div
      role="alert"
      className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-ink-muted">{message}</p>
      <a href="/" className="font-medium text-brand-700 underline">
        Reload the app
      </a>
    </div>
  )
}
