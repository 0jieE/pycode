import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import type {
  ImportResult,
  ResetPasswordResponse,
  Role,
  User,
  UserCreate,
  UserPage,
  UserUpdate,
} from '../types'

export const usersKey = ['users'] as const

export interface UserListParams {
  page: number
  size: number
  q: string
  role: Role | ''
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

export function useImportUsers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData()
      body.append('file', file)
      return api.post<ImportResult>('/users/import', { body })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey }),
    meta: { silent: true },
  })
}
