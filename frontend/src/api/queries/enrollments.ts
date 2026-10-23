import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import { classesKey } from './classes'
import { fetchAllPages } from './pages'
import type { Enrollment, EnrollmentAction, EnrollmentPage, EnrollmentStatus } from '../types'

export const enrollmentsKey = (classId: number) => ['enrollments', classId] as const

export function useEnrollments(
  classId: number,
  params: { status: EnrollmentStatus; page: number; size: number },
) {
  return useQuery({
    queryKey: [...enrollmentsKey(classId), params],
    queryFn: ({ signal }) =>
      api.get<EnrollmentPage>(`/classes/${classId}/enrollments`, { query: params, signal }),
    placeholderData: keepPreviousData,
  })
}

/** Every enrollment with `status`, across pages (e.g. all approved students of a class). */
export function useAllEnrollments(classId: number, status: EnrollmentStatus) {
  return useQuery({
    queryKey: [...enrollmentsKey(classId), 'all', status],
    queryFn: ({ signal }) =>
      fetchAllPages<Enrollment>((page, size) =>
        api.get<EnrollmentPage>(`/classes/${classId}/enrollments`, {
          query: { status, page, size },
          signal,
        }),
      ),
  })
}

export function useReviewEnrollment(classId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: EnrollmentAction }) =>
      api.patch<Enrollment>(`/enrollments/${id}`, { body: { action } }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: enrollmentsKey(classId) })
      // The class list and header show approved/pending counts.
      void qc.invalidateQueries({ queryKey: classesKey })
    },
  })
}
