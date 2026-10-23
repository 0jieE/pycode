import { useMutation } from '@tanstack/react-query'
import { api } from '../client'
import { ApiError } from '../errors'
import type {
  ChangePasswordRequest,
  LoginRequest,
  Me,
  Preferences,
  PreferencesUpdate,
  ProfileUpdate,
} from '../types'

export const meKey = ['auth', 'me'] as const

/** The signed-in user, or null when there is no valid session (an expected answer, not an error). */
export async function fetchMe(): Promise<Me | null> {
  try {
    return await api.get<Me>('/auth/me')
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null
    throw err
  }
}

export function useLogin() {
  return useMutation({
    // A wrong password is a 401 that belongs to the form, not a lost session.
    mutationFn: (body: LoginRequest) =>
      api.post<Me>('/auth/login', { body, skipAuthHandler: true }),
    meta: { silent: true },
  })
}

/** Edit the signed-in user's own name or username. Send only what changed. */
export function useUpdateProfile() {
  return useMutation({
    mutationFn: (body: ProfileUpdate) => api.patch<Me>('/auth/me', { body }),
    meta: { silent: true },
  })
}

/** 204 on success. This device stays signed in; every other device is signed out. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePasswordRequest) => api.post<void>('/auth/change-password', { body }),
    meta: { silent: true },
  })
}

/** The signed-in user's settings (send only what changed). Returns them all. */
export function useUpdatePreferences() {
  return useMutation({
    mutationFn: (body: PreferencesUpdate) =>
      api.patch<Preferences>('/auth/me/preferences', { body }),
    meta: { silent: true },
  })
}

export function useLogout() {
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    meta: { silent: true },
  })
}
