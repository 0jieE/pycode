import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import { fetchAllPages } from './pages'
import type { ClassCreate, ClassOut, ClassPage, ClassUpdate } from '../types'

export const classesKey = ['classes'] as const

export function useClasses(params: { page: number; size: number; includeArchived: boolean }) {
  return useQuery({
    queryKey: [...classesKey, 'list', params],
    queryFn: ({ signal }) =>
      api.get<ClassPage>('/classes', {
        query: {
          page: params.page,
          size: params.size,
          include_archived: params.includeArchived,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
  })
}

/** Every class, across pages: for the list that is searched and filtered in the browser. */
export function useAllClasses(includeArchived: boolean) {
  return useQuery({
    queryKey: [...classesKey, 'all', includeArchived],
    queryFn: ({ signal }) =>
      fetchAllPages<ClassOut>((page, size) =>
        api.get<ClassPage>('/classes', {
          query: { page, size, include_archived: includeArchived },
          signal,
        }),
      ),
  })
}

export function useClass(classId: number, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...classesKey, 'one', classId],
    queryFn: ({ signal }) => api.get<ClassOut>(`/classes/${classId}`, { signal }),
    enabled: options.enabled ?? true,
  })
}

export function useCreateClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ClassCreate) => api.post<ClassOut>('/classes', { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: classesKey }),
    meta: { silent: true },
  })
}

export function useUpdateClass() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ClassUpdate }) =>
      api.patch<ClassOut>(`/classes/${id}`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: classesKey }),
  })
}
