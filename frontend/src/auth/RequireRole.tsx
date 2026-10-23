import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { Role } from '@/api/types'
import { PageSpinner } from '@/components/ui/Spinner'
import { HOME_BY_ROLE, useAuth } from './AuthContext'

/** Route guard: renders the child routes only for the listed roles. */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <PageSpinner label="Checking your session" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  // An admin reset or an import left a temporary password: nothing else works until it is changed.
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  // Signed in, wrong area: send them to their own home instead of showing an error.
  if (!roles.includes(user.role)) return <Navigate to={HOME_BY_ROLE[user.role]} replace />
  return <Outlet />
}
