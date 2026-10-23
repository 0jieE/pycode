import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import { fetchAllPages } from './pages'
import type { EnrollResponse, MyClass, MyClassPage } from '../types'

export const myClassesKey = ['my-classes'] as const

/** Every class the student has joined or asked to join. */
export function useMyClasses(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: myClassesKey,
    queryFn: ({ signal }) =>
      fetchAllPages<MyClass>((page, size) =>
        api.get<MyClassPage>('/my/classes', { query: { page, size }, signal }),
      ),
    enabled: options.enabled ?? true,
    // Lab open/closed and approval status change without the student doing anything.
    refetchInterval: 20_000,
  })
}

export interface JoinResult extends EnrollResponse {
  /** False when the student had already joined this class: the backend returns the old request. */
  created: boolean
}

export function useJoinClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (code: string): Promise<JoinResult> => {
      const { data, status } = await api.postWithStatus<EnrollResponse>('/enroll', {
        body: { code },
      })
      return { ...data, created: status === 201 }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: myClassesKey }),
    meta: { silent: true },
  })
}
