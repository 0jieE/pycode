import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import { fetchAllPages } from './pages'
import type { InviteCode, InviteCodeCreate, InviteCodePage, InviteCodeUpdate } from '../types'

export const inviteCodesKey = (classId: number) => ['invite-codes', classId] as const

export function useInviteCodes(classId: number, params: { page: number; size: number }) {
  return useQuery({
    queryKey: [...inviteCodesKey(classId), params],
    queryFn: ({ signal }) =>
      api.get<InviteCodePage>(`/classes/${classId}/invite-codes`, { query: params, signal }),
    placeholderData: keepPreviousData,
  })
}

/** Every invite code of the class, across pages. */
export function useAllInviteCodes(classId: number) {
  return useQuery({
    queryKey: [...inviteCodesKey(classId), 'all'],
    queryFn: ({ signal }) =>
      fetchAllPages<InviteCode>((page, size) =>
        api.get<InviteCodePage>(`/classes/${classId}/invite-codes`, {
          query: { page, size },
          signal,
        }),
      ),
  })
}

export function useCreateInviteCode(classId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InviteCodeCreate) =>
      api.post<InviteCode>(`/classes/${classId}/invite-codes`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inviteCodesKey(classId) }),
    meta: { silent: true },
  })
}

/** Used for the on/off switch (errors toasted) and the edit-window dialog (errors inline). */
export function useUpdateInviteCode(classId: number, options: { silent?: boolean } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: InviteCodeUpdate }) =>
      api.patch<InviteCode>(`/invite-codes/${id}`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: inviteCodesKey(classId) }),
    meta: { silent: options.silent ?? false },
  })
}
