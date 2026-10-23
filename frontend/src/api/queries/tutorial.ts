import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../errors'
import { api } from '../client'
import type {
  LessonCreate,
  LessonDetail,
  LessonFull,
  LessonListItem,
  LessonUpdate,
  RunResponse,
  TutorialMatrix,
  TutorialProgress,
} from '../types'

export const tutorialKey = ['tutorial'] as const
const lessonsKey = [...tutorialKey, 'lessons'] as const
export const lessonKey = (slug: string) => [...tutorialKey, 'lesson', slug] as const
const manageKey = [...tutorialKey, 'manage'] as const

// ------------------------------------------------------------------------- reading

/** Every visible lesson in order, with the student's own progress and whether each is locked. */
export function useLessons({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: lessonsKey,
    queryFn: ({ signal }) => api.get<LessonListItem[]>('/tutorial/lessons', { signal }),
    enabled,
  })
}

/** One lesson: text, examples, exercise (sample tests in full, hidden ones by name), progress. */
export function useLesson(slug: string | null) {
  return useQuery({
    queryKey: lessonKey(slug ?? ''),
    queryFn: ({ signal }) => api.get<LessonDetail>(`/tutorial/lessons/${slug}`, { signal }),
    enabled: slug !== null,
    // Locked or gone: asking again will not change that.
    retry: (count, err) =>
      !(err instanceof ApiError && [403, 404].includes(err.status)) && count < 2,
  })
}

/** The student opened the lesson (the list shows it as started). */
export function useMarkViewed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => api.post<TutorialProgress>(`/tutorial/lessons/${slug}/view`),
    onSuccess: () => qc.invalidateQueries({ queryKey: lessonsKey }),
    meta: { silent: true },
  })
}

/** Autosave of the exercise code. */
export const saveExerciseCode = (slug: string, code: string) =>
  api.put<TutorialProgress>(`/tutorial/lessons/${slug}/code`, { body: { code } })

/** Runs code as main.py, followed on /ws/run/{id} like any run. Never blocked by lab sessions. */
export const startTutorialRun = (code: string, stdin: string, mode: 'interactive' | 'batch') =>
  api.post<RunResponse>('/tutorial/run', { body: { code, stdin, mode } })

/** Runs the exercise's tests (a test job): passing them all marks the lesson passed. */
export const startExerciseCheck = (slug: string, files: { path: string; content: string }[]) =>
  api.post<RunResponse>(`/tutorial/lessons/${slug}/check`, { body: { files } })

/** After a check: the list (ticks, locks) and the lesson's progress may have changed. */
export const refreshAfterCheck = (qc: ReturnType<typeof useQueryClient>, slug: string) => {
  void qc.invalidateQueries({ queryKey: lessonsKey })
  void qc.invalidateQueries({ queryKey: lessonKey(slug) })
}

// ------------------------------------------------------------------------- instructor

/** Student × lesson for one class, and whether lessons unlock in order there. */
export function useTutorialProgress(classId: number) {
  return useQuery({
    queryKey: [...tutorialKey, 'progress', classId],
    queryFn: ({ signal }) =>
      api.get<TutorialMatrix>(`/classes/${classId}/tutorial-progress`, { signal }),
  })
}

// ------------------------------------------------------------------------- editing (staff)

export function useManageLessons({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: manageKey,
    queryFn: ({ signal }) => api.get<LessonFull[]>('/tutorial/manage/lessons', { signal }),
    enabled,
  })
}

/** Any edit: the editor's list, and what students see. */
function useInvalidateAll() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: tutorialKey })
}

export function useUpdateLesson(slug: string) {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (body: LessonUpdate) =>
      api.patch<LessonFull>(`/tutorial/manage/lessons/${slug}`, { body }),
    onSuccess: invalidate,
    meta: { silent: true },
  })
}

export function useResetLesson(slug: string) {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: () => api.post<LessonFull>(`/tutorial/manage/lessons/${slug}/reset`),
    onSuccess: invalidate,
    meta: { silent: true },
  })
}

export function useCreateLesson() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (body: LessonCreate) => api.post<LessonFull>('/tutorial/manage/lessons', { body }),
    onSuccess: invalidate,
    meta: { silent: true },
  })
}

/**
 * Deletes a lesson staff added (409 LESSON_IS_DEFAULT for one that came with the system). Students' progress
 * on it goes too, and the lessons after it may unlock: every tutorial list is fetched again.
 */
export function useDeleteLesson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => api.delete(`/tutorial/manage/lessons/${slug}`),
    onSuccess: (_data, slug) => {
      qc.setQueryData<LessonFull[]>(manageKey, (old) => old?.filter((l) => l.slug !== slug))
      void qc.invalidateQueries({ queryKey: tutorialKey })
    },
    meta: { silent: true },
  })
}

/** Loads or updates every default lesson that came with the system (administrators). */
export function useSeedLessons() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: () =>
      api.post<{ created: string[]; updated: string[] }>('/tutorial/manage/lessons/seed'),
    onSuccess: invalidate,
    meta: { silent: true },
  })
}

/** The whole order, every lesson's slug once. */
export function useReorderLessons() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (order: string[]) =>
      api.patch<LessonFull[]>('/tutorial/manage/lessons/order', { body: { order } }),
    onSuccess: (lessons) => {
      qc.setQueryData(manageKey, lessons)
      void qc.invalidateQueries({ queryKey: lessonsKey })
    },
    meta: { silent: true },
  })
}
