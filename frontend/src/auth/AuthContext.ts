import { createContext, useContext } from 'react'
import type { Me, Role } from '@/api/types'

/** Why the user is on the login page without having clicked "Sign out". */
export type SignOutReason = 'replaced' | 'expired'

export interface AuthState {
  user: Me | null
  /** True until the first /auth/me answer arrives. */
  loading: boolean
  signOutReason: SignOutReason | null
  /** Call after a successful login with the user the API returned. */
  signIn: (user: Me) => void
  signOut: () => Promise<void>
  /** Replace the signed-in user with a newer copy (after editing their profile), without signing in again. */
  updateUser: (user: Me) => void
  /** Ask the server who is signed in now (e.g. after the password was changed). */
  refreshUser: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export const HOME_BY_ROLE: Record<Role, string> = {
  admin: '/admin/users/students',
  instructor: '/classes',
  student: '/my/classes',
}
