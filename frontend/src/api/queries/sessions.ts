import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { api } from '../client'
import { fetchAllPages } from './pages'
import type { LabSession, SessionCreate, SessionPage, SessionUpdate } from '../types'

export const sessionsKey = (classId: number) => ['sessions', classId] as const
/** Every lab's schedule (see useLabSchedule in ./labs). */
export const LAB_SCHEDULES = ['labs', 'schedule'] as const

export function useSessions(classId: number, params: { page: number; size: number }) {
  return useQuery({
    queryKey: [...sessionsKey(classId), 'list', params],
    queryFn: ({ signal }) =>
      api.get<SessionPage>(`/classes/${classId}/sessions`, { query: params, signal }),
    placeholderData: keepPreviousData,
  })
}

/** Every lab session of the class, across pages. */
export function useAllSessions(classId: number) {
  return useQuery({
    queryKey: [...sessionsKey(classId), 'all'],
    queryFn: ({ signal }) =>
      fetchAllPages<LabSession>((page, size) =>
        api.get<SessionPage>(`/classes/${classId}/sessions`, { query: { page, size }, signal }),
      ),
  })
}

/** The open session, or null when the laboratory is closed. */
export function useCurrentSession(classId: number, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...sessionsKey(classId), 'current'],
    queryFn: ({ signal }) =>
      api.get<LabSession | null>(`/classes/${classId}/sessions/current`, { signal }),
    enabled: options.enabled ?? true,
    // Another device or tab can open or close it.
    refetchInterval: 15_000,
  })
}

/**
 * Why the laboratory of a class last closed: its scheduled end, the instructor, or because it was opened long
 * before its start (the server puts it back; it opens by itself at its start time).
 */
export type CloseReason = 'scheduled_end' | 'manual' | 'before_start'

export const useLabCloseReason = create<{
  byClass: Record<number, CloseReason>
  set: (classId: number, reason: CloseReason) => void
}>((set) => ({
  byClass: {},
  set: (classId, reason) => set((s) => ({ byClass: { ...s.byClass, [classId]: reason } })),
}))

/** The longest a timer can wait (about 24 days): a later end is simply checked again by the refetch. */
const MAX_TIMER_MS = 2 ** 31 - 1

/**
 * The open session as the lab really is: `session` turns null at the exact scheduled end, without waiting for
 * the server's sweep (up to 15 s) or the next refetch, and the current session is fetched again right then.
 */
export function useLiveSession(classId: number, options: { enabled?: boolean } = {}) {
  const query = useCurrentSession(classId, options)
  const qc = useQueryClient()
  const data = query.data
  // "id@ends_at" of the session whose end has passed (a later ends_at, after Extend, is a new key).
  const [endedKey, setEndedKey] = useState<string | null>(null)
  const key = data ? `${data.id}@${data.ends_at}` : null

  useEffect(() => {
    if (!data) return
    const wait = new Date(data.ends_at).getTime() - Date.now()
    if (wait > MAX_TIMER_MS) return
    const id = window.setTimeout(
      () => {
        setEndedKey(`${data.id}@${data.ends_at}`)
        useLabCloseReason.getState().set(classId, 'scheduled_end')
        void qc.invalidateQueries({ queryKey: [...sessionsKey(classId), 'current'] })
      },
      Math.max(0, wait) + 50,
    )
    return () => window.clearTimeout(id)
  }, [data, qc, classId])

  return { ...query, session: data && key !== endedKey ? data : null }
}

/** Rename or reschedule a session, e.g. a later ends_at to extend the running one. */
export function useUpdateSession(classId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: SessionUpdate }) =>
      api.patch<LabSession>(`/sessions/${id}`, { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sessionsKey(classId) })
      // A lab's schedule lists sessions: it changed too.
      void qc.invalidateQueries({ queryKey: LAB_SCHEDULES })
    },
    meta: { silent: true },
  })
}

export function useCreateSession(classId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SessionCreate) =>
      api.post<LabSession>(`/classes/${classId}/sessions`, { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sessionsKey(classId) })
      // A lab's schedule lists sessions: it changed too.
      void qc.invalidateQueries({ queryKey: LAB_SCHEDULES })
    },
    meta: { silent: true },
  })
}

/**
 * Open or close access. Errors are toasted (e.g. another session is already open), except SESSION_ENDED: the
 * page offers to change the end time instead.
 */
export function useSetSessionOpen(classId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, open }: { id: number; open: boolean }) =>
      api.patch<LabSession>(`/sessions/${id}/${open ? 'open' : 'close'}`),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: sessionsKey(classId) })
      void qc.invalidateQueries({ queryKey: LAB_SCHEDULES })
    },
    meta: { silentCodes: ['SESSION_ENDED', 'SESSION_NOT_STARTED'] },
  })
}
