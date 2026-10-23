import type {
  LessonListItem,
  StudentCase,
  StudentExercise,
  TutorialMatrix,
  TutorialProgressCell,
} from '@/api/types'
import { csvField } from './registration'

/** "9 of 24 completed" */
export function progressText(lessons: readonly LessonListItem[]): string {
  return `${lessons.filter((l) => l.passed).length} of ${lessons.length} completed`
}

/** The lesson to continue with: the first one not passed yet that is open (else the last). */
export function currentLesson(lessons: readonly LessonListItem[]): LessonListItem | undefined {
  return lessons.find((l) => !l.passed && !l.locked) ?? lessons[lessons.length - 1]
}

/** The lessons before and after one, in list order. */
export function neighbours(
  lessons: readonly LessonListItem[],
  slug: string,
): { prev: LessonListItem | undefined; next: LessonListItem | undefined } {
  const i = lessons.findIndex((l) => l.slug === slug)
  if (i === -1) return { prev: undefined, next: undefined }
  return { prev: lessons[i - 1], next: lessons[i + 1] }
}

/**
 * The exercise's tests in the shape the test results panel reads: the server numbers them from 1 in order,
 * and its results use those numbers as case ids.
 */
export function exerciseCases(exercise: StudentExercise): StudentCase[] {
  return exercise.tests.map((t, i) =>
    'stdin' in t
      ? ({
          id: i + 1,
          name: t.name,
          points: t.points,
          is_hidden: 'False',
          stdin: t.stdin,
          expected_output: t.expected_output,
          match_mode: t.match_mode,
        } as StudentCase)
      : ({ id: i + 1, name: t.name, points: t.points, is_hidden: 'True' } as StudentCase),
  )
}

/** The files a check sends: the student's code as the entry file, plus any starter files beside it. */
export function checkFiles(
  exercise: StudentExercise,
  code: string,
): { path: string; content: string }[] {
  const others = exercise.starter_files.filter((f) => f.path !== exercise.entry)
  return [
    { path: exercise.entry, content: code },
    ...others.map((f) => ({ path: f.path, content: f.content ?? '' })),
  ]
}

/** A lesson's address from its title: lowercase letters, digits and single hyphens, 60 at most. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

export const isValidSlug = (slug: string): boolean =>
  slug.length > 0 && slug.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)

/** Moves one item of a list to another position. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return next
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  return next
}

// ----------------------------------------------------------------------------- the matrix

export type MatrixRow = TutorialMatrix['students'][number]

/** Share of the class's lessons a student passed, 0..100. */
export function completion(row: MatrixRow, lessonCount: number): number {
  return lessonCount === 0 ? 0 : Math.round((row.passed_count / lessonCount) * 100)
}

/** What a cell says: ✅ when passed, the number of checks when tried, nothing otherwise. */
export function cellText(cell: TutorialProgressCell | undefined): string {
  if (!cell) return ''
  if (cell.passed_at) return '✅'
  return cell.attempts > 0 ? String(cell.attempts) : ''
}

export type MatrixSort = 'name' | 'completion-desc' | 'completion-asc'

export function sortRows(rows: readonly MatrixRow[], sort: MatrixSort): MatrixRow[] {
  const byName = (a: MatrixRow, b: MatrixRow) =>
    a.student.full_name.localeCompare(b.student.full_name)
  return [...rows].sort((a, b) =>
    sort === 'name'
      ? byName(a, b)
      : (sort === 'completion-desc'
          ? b.passed_count - a.passed_count
          : a.passed_count - b.passed_count) || byName(a, b),
  )
}

export type ProgressFilter = '' | 'done' | 'in-progress' | 'not-started'

/** Whole tutorial passed, some progress, or nothing passed yet. */
export function progressState(row: MatrixRow, lessonCount: number): Exclude<ProgressFilter, ''> {
  if (lessonCount > 0 && row.passed_count >= lessonCount) return 'done'
  return row.passed_count > 0 || Object.values(row.lessons).some((c) => (c?.attempts ?? 0) > 0)
    ? 'in-progress'
    : 'not-started'
}

/**
 * The download: one row per student, one column per lesson ("passed", the number of checks, or empty),
 * then the totals. Starts with a BOM so Excel reads UTF-8.
 */
export function matrixCsv(matrix: TutorialMatrix, rows: readonly MatrixRow[]): string {
  const n = matrix.lessons.length
  const header = [
    'student_no',
    'full_name',
    'username',
    ...matrix.lessons.map((l) => `${l.order}. ${l.title}`),
    'passed',
    'completion_percent',
  ]
  const lines = rows.map((r) =>
    [
      r.student.student_no ?? '',
      r.student.full_name,
      r.student.username,
      ...matrix.lessons.map((l) => {
        const c = r.lessons[l.slug]
        return c?.passed_at ? 'passed' : c && c.attempts > 0 ? `${c.attempts} tries` : ''
      }),
      `${r.passed_count}/${n}`,
      String(completion(r, n)),
    ]
      .map(csvField)
      .join(','),
  )
  return '﻿' + [header.map(csvField).join(','), ...lines].join('\r\n') + '\r\n'
}
