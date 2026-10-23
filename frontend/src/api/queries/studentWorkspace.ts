import { useQuery } from '@tanstack/react-query'
import { api } from '../client'
import type { FileOut, TreeOut } from '../types'

/** How often the instructor's read-only view looks for the student's newest work. */
export const STUDENT_VIEW_REFRESH_MS = 5000

const base = (classId: number, studentId: number) =>
  `/classes/${classId}/students/${studentId}/workspace`

/** The instructor's read-only view of one student's workspace tree. */
export function useStudentTree(classId: number, studentId: number) {
  return useQuery({
    queryKey: ['student-workspace', classId, studentId, 'tree'],
    queryFn: ({ signal }) => api.get<TreeOut>(base(classId, studentId), { signal }),
    refetchInterval: STUDENT_VIEW_REFRESH_MS,
  })
}

export function useStudentFile(classId: number, studentId: number, fileId: number | null) {
  return useQuery({
    queryKey: ['student-workspace', classId, studentId, 'file', fileId],
    queryFn: ({ signal }) =>
      api.get<FileOut>(`${base(classId, studentId)}/files/${fileId}`, { signal }),
    enabled: fileId !== null,
    refetchInterval: STUDENT_VIEW_REFRESH_MS,
  })
}
