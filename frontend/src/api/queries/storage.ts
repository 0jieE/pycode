import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import type {
  ClearResult,
  StorageLimitsOut,
  StorageLimitsUpdate,
  UserStorage,
  UserStorageUpdate,
} from '../types'

/** Workspace storage limits (admin only): each role's, and one user's own. */
export const storageLimitsKey = ['storage-limits'] as const
const userStorageKey = (userId: number) => ['users', userId, 'storage'] as const

export function useStorageLimits() {
  return useQuery({
    queryKey: storageLimitsKey,
    queryFn: ({ signal }) => api.get<StorageLimitsOut>('/storage-limits', { signal }),
  })
}

// The forms show the server's refusals next to the fields, so these are silent for the toaster.
export function useUpdateRoleLimits() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ role, body }: { role: 'student' | 'instructor'; body: StorageLimitsUpdate }) =>
      api.patch<StorageLimitsOut>(`/storage-limits/${role}`, { body }),
    onSuccess: (data) => {
      qc.setQueryData(storageLimitsKey, data)
      // Users who follow their role now have other limits.
      void qc.invalidateQueries({
        queryKey: ['users'],
        predicate: (q) => q.queryKey[2] === 'storage',
      })
    },
    meta: { silent: true },
  })
}

export function useUserStorage(userId: number | null) {
  return useQuery({
    queryKey: userStorageKey(userId ?? 0),
    queryFn: ({ signal }) => api.get<UserStorage>(`/users/${userId}/storage`, { signal }),
    enabled: userId !== null,
  })
}

/** Replaces the user's own limits: null (or left out) follows the role again. */
export function useSetUserStorage(userId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UserStorageUpdate) =>
      api.put<UserStorage>(`/users/${userId}/storage`, { body }),
    onSuccess: (data) => qc.setQueryData(userStorageKey(userId), data),
    meta: { silent: true },
  })
}

/**
 * Deletes every file and folder of one of the user's workspaces, with their versions. A class workspace gets its
 * published activities' starter files back; Practice is left empty. Submissions are not touched. No undo.
 */
export function useClearWorkspace(userId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (workspaceId: number) =>
      api.post<ClearResult>(`/users/${userId}/workspaces/${workspaceId}/clear`),
    onSuccess: () => qc.invalidateQueries({ queryKey: userStorageKey(userId) }),
  })
}
