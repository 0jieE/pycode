import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import type {
  RegradeResult,
  RunResponse,
  StudentCase,
  TestCase,
  TestCaseCreate,
  TestCaseUpdate,
} from '../types'

export const testCasesKey = (activityId: number) => ['test-cases', activityId] as const
export const studentCasesKey = (activityId: number) =>
  ['test-cases', activityId, 'student'] as const

/** Instructor: every case of an activity, in order, with its expected output. */
export function useTestCases(activityId: number | null) {
  return useQuery({
    queryKey: testCasesKey(activityId ?? 0),
    queryFn: ({ signal }) =>
      api.get<TestCase[]>(`/activities/${activityId}/test-cases`, { signal }),
    enabled: activityId !== null,
  })
}

/**
 * Student: the cases they may see. A hidden case is only a name and its points. An activity with no
 * cases answers with an empty list, which is how the Test button knows to stay away.
 */
export function useStudentCases(activityId: number | null) {
  return useQuery({
    queryKey: studentCasesKey(activityId ?? 0),
    queryFn: ({ signal }) =>
      api.get<StudentCase[]>(`/activities/${activityId}/test-cases/student`, { signal }),
    enabled: activityId !== null,
    // The instructor may add cases while the lab is on: look again now and then.
    staleTime: 30_000,
  })
}

export function useCreateTestCase(activityId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TestCaseCreate) =>
      api.post<TestCase>(`/activities/${activityId}/test-cases`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: testCasesKey(activityId) }),
    meta: { silent: true },
  })
}

export function useUpdateTestCase(activityId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: TestCaseUpdate }) =>
      api.patch<TestCase>(`/test-cases/${id}`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: testCasesKey(activityId) }),
    meta: { silent: true },
  })
}

export function useDeleteTestCase(activityId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/test-cases/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: testCasesKey(activityId) }),
    meta: { silent: true },
  })
}

/** Saves a new order (every id exactly once). The list shows it at once and rolls back if refused. */
export function useReorderTestCases(activityId: number) {
  const qc = useQueryClient()
  const key = testCasesKey(activityId)
  return useMutation({
    mutationFn: (order: number[]) =>
      api.patch<TestCase[]>(`/activities/${activityId}/test-cases/order`, { body: { order } }),
    onMutate: async (order) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<TestCase[]>(key)
      if (before) {
        const byId = new Map(before.map((c) => [c.id, c]))
        qc.setQueryData(
          key,
          order.flatMap((id) => byId.get(id) ?? []),
        )
      }
      return { before }
    },
    onError: (_err, _order, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
    meta: { silent: true },
  })
}

/** Instructor: runs ONE case against the activity's starter files. 202 with the execution to watch. */
export const tryTestCase = (caseId: number) =>
  api.post<RunResponse>(`/test-cases/${caseId}/try`, { body: {} })

/** Student: the Test button. Runs every case against the student's own files. */
export const startTest = (classId: number, activityId: number, entryPath: string) =>
  api.post<RunResponse>(`/workspace/${classId}/test`, {
    body: { activity_id: activityId, entry_path: entryPath },
  })

/** Instructor: grade every submission of the activity again. */
export function useRegrade(activityId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<RegradeResult>(`/activities/${activityId}/regrade`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['submissions', activityId] }),
    meta: { silent: true },
  })
}
