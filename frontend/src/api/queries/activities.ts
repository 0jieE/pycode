import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import { fetchAllPages } from './pages'
import type { Activity, ActivityCreate, ActivityPage, ActivityUpdate, Requirements } from '../types'

export const activitiesKey = (classId: number) => ['activities', classId] as const

export function useActivities(
  classId: number,
  params: { page: number; size: number },
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: [...activitiesKey(classId), 'list', params],
    queryFn: ({ signal }) =>
      api.get<ActivityPage>(`/classes/${classId}/activities`, { query: params, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  })
}

/** Every activity of the class, across pages. */
/** Every activity of the class. Archived ones only when asked for (instructors). */
export function useAllActivities(classId: number, includeArchived = false) {
  return useQuery({
    queryKey: [...activitiesKey(classId), 'all', includeArchived],
    queryFn: ({ signal }) =>
      fetchAllPages<Activity>((page, size) =>
        api.get<ActivityPage>(`/classes/${classId}/activities`, {
          query: { page, size, ...(includeArchived ? { include_archived: true } : {}) },
          signal,
        }),
      ),
  })
}

export function useActivity(classId: number, activityId: number | null) {
  return useQuery({
    queryKey: [...activitiesKey(classId), 'one', activityId],
    queryFn: ({ signal }) => api.get<Activity>(`/activities/${activityId}`, { signal }),
    enabled: activityId !== null,
  })
}

export function useCreateActivity(classId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ActivityCreate) =>
      api.post<Activity>(`/classes/${classId}/activities`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: activitiesKey(classId) }),
    meta: { silent: true },
  })
}

export function useUpdateActivity(classId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ActivityUpdate }) =>
      api.patch<Activity>(`/activities/${id}`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: activitiesKey(classId) }),
    meta: { silent: true },
  })
}

export function usePublishActivity(classId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<Activity>(`/activities/${id}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: activitiesKey(classId) }),
    meta: { silent: true },
  })
}

/** Deletes a draft (409 ACTIVITY_PUBLISHED for a published one: archive it instead). */
export function useDeleteActivity(classId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/activities/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: activitiesKey(classId) }),
    meta: { silent: true },
  })
}

/**
 * Archives a published activity (students no longer see it; their folder becomes read-only; submissions and
 * grades stay), or brings it back.
 */
export function useSetActivityArchived(classId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      api.patch<Activity>(`/activities/${id}`, { body: { is_archived: archived } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: activitiesKey(classId) }),
    meta: { silent: true },
  })
}

/**
 * Replaces the activity's code requirements (checked before its tests run). They apply from the next Test or
 * grading; existing grades change only with Regrade. 422 for a bad name, shown in the form.
 */
export function useSetRequirements(classId: number, activityId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Requirements) =>
      api.put<Requirements>(`/activities/${activityId}/requirements`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: activitiesKey(classId) }),
    meta: { silent: true },
  })
}

/** No requirements any more. */
export function useClearRequirements(classId: number, activityId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete(`/activities/${activityId}/requirements`),
    onSuccess: () => qc.invalidateQueries({ queryKey: activitiesKey(classId) }),
    meta: { silent: true },
  })
}
