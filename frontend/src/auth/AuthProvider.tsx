import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { setPasswordChangeHandler, setUnauthorizedHandler } from '@/api/client'
import { NOT_AUTHENTICATED, SESSION_REPLACED, type ApiError } from '@/api/errors'
import { fetchMe, meKey, useLogout } from '@/api/queries/auth'
import type { Me } from '@/api/types'
import { AuthContext, type AuthState, type SignOutReason } from './AuthContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const logoutMutation = useLogout()
  const [signOutReason, setSignOutReason] = useState<SignOutReason | null>(null)

  const me = useQuery({
    queryKey: meKey,
    queryFn: fetchMe,
    staleTime: Infinity,
    retry: false,
    // While signed in, re-check when the tab regains focus so a replaced session is noticed early.
    refetchOnWindowFocus: (query) => (query.state.data ? 'always' : false),
  })
  const user = me.data ?? null

  const userRef = useRef<Me | null>(null)
  useEffect(() => {
    userRef.current = user
  }, [user])

  /** Forget everything that belongs to the previous user. */
  const wipeUserData = useCallback(
    (nextUser: Me | null) => {
      void qc.cancelQueries()
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== meKey[0] })
      qc.setQueryData(meKey, nextUser)
    },
    [qc],
  )

  // Any 401 from any request ends up here (see api/client.ts).
  useEffect(() => {
    setUnauthorizedHandler((error: ApiError) => {
      // Not signed in and not expecting to be (first load, login page): nothing was lost.
      if (error.code === NOT_AUTHENTICATED && !userRef.current) return
      setSignOutReason(error.code === SESSION_REPLACED ? 'replaced' : 'expired')
      wipeUserData(null)
    })
    return () => setUnauthorizedHandler(null)
  }, [wipeUserData])

  // A 403 PASSWORD_CHANGE_REQUIRED from anywhere: look again at who we are; the flag on the user then sends
  // every page to the change-password screen (see RequireRole).
  useEffect(() => {
    setPasswordChangeHandler(() => void qc.invalidateQueries({ queryKey: meKey }))
    return () => setPasswordChangeHandler(null)
  }, [qc])

  const updateUser = useCallback((next: Me) => qc.setQueryData(meKey, next), [qc])
  const refreshUser = useCallback(() => qc.invalidateQueries({ queryKey: meKey }), [qc])

  const signIn = useCallback(
    (next: Me) => {
      setSignOutReason(null)
      wipeUserData(next)
    },
    [wipeUserData],
  )

  const { mutateAsync: logoutRequest } = logoutMutation
  const signOut = useCallback(async () => {
    try {
      await logoutRequest()
    } catch {
      // The session may already be gone; the local state must be cleared either way.
    }
    setSignOutReason(null)
    wipeUserData(null)
  }, [logoutRequest, wipeUserData])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading: me.isPending,
      signOutReason,
      signIn,
      signOut,
      updateUser,
      refreshUser,
    }),
    [user, me.isPending, signOutReason, signIn, signOut, updateUser, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
