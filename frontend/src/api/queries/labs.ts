import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import type { Lab, LabBooking, LabCreate, SessionLoginPage } from '../types'

export const labsKey = ['labs'] as const

/** Every lab (a named computer room that sessions book): admins and instructors. */
export function useLabs() {
  return useQuery({
    queryKey: [...labsKey, 'list'],
    queryFn: ({ signal }) => api.get<Lab[]>('/labs', { signal }),
  })
}

export function useLab(labId: number | null) {
  return useQuery({
    queryKey: [...labsKey, 'one', labId],
    queryFn: ({ signal }) => api.get<Lab>(`/labs/${labId}`, { signal }),
    enabled: labId !== null,
  })
}

// The dialogs show the server's refusals (LAB_NAME_TAKEN, LAB_HAS_SESSIONS) themselves.
export function useCreateLab() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LabCreate) => api.post<Lab>('/labs', { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: labsKey }),
    meta: { silent: true },
  })
}

export function useRenameLab(labId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LabCreate) => api.patch<Lab>(`/labs/${labId}`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: labsKey }),
    meta: { silent: true },
  })
}

export function useDeleteLab() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (labId: number) => api.delete(`/labs/${labId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: labsKey }),
    meta: { silent: true },
  })
}

/** Who signed in during the session and how it went: newest first, a page at a time. */
export function useSessionLogins(sessionId: number, page: number, size: number, live: boolean) {
  return useQuery({
    queryKey: ['session-logins', sessionId, page, size],
    queryFn: ({ signal }) =>
      api.get<SessionLoginPage>(`/sessions/${sessionId}/logins`, { query: { page, size }, signal }),
    placeholderData: keepPreviousData,
    // Sign-ins are not announced live: look again regularly while the session runs.
    refetchInterval: live ? 15_000 : false,
  })
}

/**
 * The sessions that use a lab and have not ended, across all instructors: running ones first, then upcoming by
 * start. For seeing a booking clash before it happens.
 */
export function useLabSchedule(labId: number | null) {
  return useQuery({
    queryKey: [...labsKey, 'schedule', labId],
    queryFn: ({ signal }) => api.get<LabBooking[]>(`/labs/${labId}/schedule`, { signal }),
    enabled: labId !== null,
    refetchInterval: 60_000,
  })
}
