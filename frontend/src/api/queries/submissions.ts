import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import { fetchAllPages } from './pages'
import type {
  MySubmission,
  SubmissionDetail,
  SubmissionListItem,
  SubmissionOut,
  SubmissionPage,
} from '../types'

/** A submission still without a score this long after it was handed in is not being waited for. */
const GRADING_WINDOW_MS = 2 * 60_000

export function useSubmissions(activityId: number, params: { page: number; size: number }) {
  return useQuery({
    queryKey: ['submissions', activityId, 'list', params],
    queryFn: ({ signal }) =>
      api.get<SubmissionPage>(`/activities/${activityId}/submissions`, { query: params, signal }),
    placeholderData: keepPreviousData,
  })
}

/** All submissions of an activity: needed to work out who has not submitted yet. */
export function useAllSubmissions(activityId: number) {
  return useQuery<SubmissionListItem[]>({
    queryKey: ['submissions', activityId, 'all'],
    // A submission is graded a few seconds after it arrives: look again until its score shows up.
    refetchInterval: (query) =>
      query.state.data?.some(
        (s) => s.graded_at == null && Date.now() - Date.parse(s.submitted_at) < GRADING_WINDOW_MS,
      )
        ? 4000
        : false,
    queryFn: ({ signal }) =>
      fetchAllPages<SubmissionListItem>((page, size) =>
        api.get<SubmissionPage>(`/activities/${activityId}/submissions`, {
          query: { page, size },
          signal,
        }),
      ),
  })
}

export function useSubmission(submissionId: number) {
  return useQuery({
    queryKey: ['submissions', 'one', submissionId],
    queryFn: ({ signal }) => api.get<SubmissionDetail>(`/submissions/${submissionId}`, { signal }),
  })
}

export const mySubmissionsKey = (classId: number) => ['my-submissions', classId] as const

/** Student: what I have handed in for each activity of the class (one row per submitted activity). */
export function useMySubmissions(classId: number, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: mySubmissionsKey(classId),
    queryFn: ({ signal }) =>
      api.get<MySubmission[]>(`/classes/${classId}/my-submissions`, { signal }),
    enabled: options.enabled ?? true,
  })
}

/** Student: freezes a copy of the activity folder. Submitting again replaces the earlier one. */
export function useSubmitActivity(classId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (activityId: number) => api.post<SubmissionOut>(`/activities/${activityId}/submit`),
    // The class home's badge reads this list: refresh it so it updates without a reload.
    onSuccess: () => qc.invalidateQueries({ queryKey: mySubmissionsKey(classId) }),
    meta: { silent: true },
  })
}
