import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import type {
  DeletePreview,
  ResetPasswordResponse,
  User,
  UserCounts,
  UserCreate,
  UserPage,
  UserUpdate,
} from '../types'

export const usersKey = ['users'] as const

export interface UserListParams {
  page: number
  size: number
  q: string
  /** '' = everyone the administrator manages. */
  role: 'instructor' | 'student' | ''
}

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: [...usersKey, params],
    queryFn: ({ signal }) =>
      api.get<UserPage>('/users', {
        query: { page: params.page, size: params.size, q: params.q.trim(), role: params.role },
        signal,
      }),
    // Keep showing the old page while the next one loads: no layout jump.
    placeholderData: keepPreviousData,
  })
}

// The dialogs show server errors (taken username, ...) inline, so these are silent for the toaster.
export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UserCreate) => api.post<User>('/users', { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
    meta: { silent: true },
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: UserUpdate }) =>
      api.patch<User>(`/users/${id}`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
    meta: { silent: true },
  })
}

/** Without `newPassword` the server generates the temporary password. */
export function useResetPassword() {
  return useMutation({
    mutationFn: (id: number) => api.post<ResetPasswordResponse>(`/users/${id}/reset-password`),
  })
}

/** How many instructors and students there are (for the side bar; the administrator is not counted). */
export function useUserCounts() {
  return useQuery({
    queryKey: [...usersKey, 'counts'],
    queryFn: ({ signal }) => api.get<UserCounts>('/users/counts', { signal }),
  })
}

/** What deleting this instructor or student would remove, and what (if anything) blocks it. Always fresh. */
export function useDeletePreview(userId: number | null) {
  return useQuery({
    queryKey: [...usersKey, userId, 'delete-preview'],
    queryFn: ({ signal }) => api.get<DeletePreview>(`/users/${userId}/delete-preview`, { signal }),
    enabled: userId !== null,
    gcTime: 0,
    staleTime: 0,
  })
}

/** Permanent. The dialog shows a refusal (USER_HAS_CLASSES, USER_RUN_ACTIVE...) inline. */
export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
    meta: { silent: true },
  })
}
