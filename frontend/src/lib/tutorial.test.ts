import { describe, expect, it } from 'vitest'
import type { LessonListItem, StudentExercise, TutorialMatrix } from '@/api/types'
import {
  cellText,
  checkFiles,
  completion,
  currentLesson,
  exerciseCases,
  isValidSlug,
  matrixCsv,
  moveItem,
  neighbours,
  progressState,
  progressText,
  slugify,
  sortRows,
} from './tutorial'

const lesson = (slug: string, passed = false, locked = false): LessonListItem => ({
  slug,
  title: slug.toUpperCase(),
  order: 0,
  summary: '',
  passed,
  viewed: passed,
  attempts: passed ? 1 : 0,
  locked,
})

describe('the lesson list', () => {
  const list = [lesson('a', true), lesson('b'), lesson('c', false, true)]

  it('counts what is done', () => {
    expect(progressText(list)).toBe('1 of 3 completed')
    expect(progressText([])).toBe('0 of 0 completed')
  })

  it('continues at the first open lesson not passed yet', () => {
    expect(currentLesson(list)?.slug).toBe('b')
    expect(currentLesson([lesson('a', true), lesson('b', true)])?.slug).toBe('b')
    expect(currentLesson([])).toBeUndefined()
  })

  it('knows the lessons around one', () => {
    expect(neighbours(list, 'b')).toEqual({ prev: list[0], next: list[2] })
    expect(neighbours(list, 'a').prev).toBeUndefined()
    expect(neighbours(list, 'zzz')).toEqual({ prev: undefined, next: undefined })
  })
})

describe('the exercise', () => {
  const exercise: StudentExercise = {
    prompt: 'p',
    starter_code: '',
    starter_files: [
      { path: 'main.py', content: 'old' },
      { path: 'data.txt', content: '1 2 3' },
    ],
    entry: 'main.py',
    ignore_input_prompts: true,
    tests: [
      {
        name: 'Sample',
        is_hidden: false,
        stdin: '2',
        expected_output: '4',
        match_mode: 'trim',
        points: 1,
      },
      { name: 'Secret', is_hidden: true, points: 2 },
    ],
  }

  it('numbers the tests from 1, as the results do', () => {
    const cases = exerciseCases(exercise)
    expect(cases.map((c) => c.id)).toEqual([1, 2])
    expect('stdin' in cases[0]!).toBe(true)
    expect('stdin' in cases[1]!).toBe(false)
  })

  it('sends the code as the entry file, with the other starter files', () => {
    expect(checkFiles(exercise, 'print(1)')).toEqual([
      { path: 'main.py', content: 'print(1)' },
      { path: 'data.txt', content: '1 2 3' },
    ])
  })
})

describe('lesson addresses', () => {
  it('makes one from a title', () => {
    expect(slugify('Lists & Tuples!')).toBe('lists-tuples')
    expect(slugify('  Año nuevo  ')).toBe('ano-nuevo')
    expect(slugify('x'.repeat(80))).toHaveLength(60)
  })

  it('checks one', () => {
    expect(isValidSlug('for-and-range')).toBe(true)
    expect(isValidSlug('For')).toBe(false)
    expect(isValidSlug('a--b')).toBe(false)
    expect(isValidSlug('')).toBe(false)
  })

  it('moves items', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })
})

describe('the progress matrix', () => {
  const student = (id: number, name: string, passed: number, tried = 0) => ({
    student: { id, username: `u${id}`, full_name: name, student_no: `2026-${id}` },
    passed_count: passed,
    lessons: {
      ...(passed
        ? { a: { passed_at: '2026-10-01T00:00:00Z', attempts: 1, last_activity: null } }
        : {}),
      ...(tried ? { b: { passed_at: null, attempts: tried, last_activity: null } } : {}),
    },
  })
  const matrix: TutorialMatrix = {
    class_id: 1,
    unlock_in_order: false,
    generated_at: '2026-10-11T00:00:00Z',
    lessons: [
      { slug: 'a', title: 'Print', order: 1 },
      { slug: 'b', title: 'Comments, "notes"', order: 2 },
    ],
    students: [student(1, 'Cruz', 1, 3), student(2, 'Abad', 0), student(3, 'Bato', 2)],
  }

  it('works out completion and states', () => {
    expect(completion(matrix.students[0]!, 2)).toBe(50)
    expect(progressState(matrix.students[0]!, 2)).toBe('in-progress')
    expect(progressState(matrix.students[1]!, 2)).toBe('not-started')
    expect(progressState(matrix.students[2]!, 2)).toBe('done')
  })

  it('shows a tick, a number of checks, or nothing', () => {
    expect(cellText(matrix.students[0]!.lessons.a)).toBe('✅')
    expect(cellText(matrix.students[0]!.lessons.b)).toBe('3')
    expect(cellText(undefined)).toBe('')
  })

  it('sorts by completion, then name', () => {
    expect(sortRows(matrix.students, 'completion-desc').map((r) => r.student.id)).toEqual([3, 1, 2])
    expect(sortRows(matrix.students, 'completion-asc').map((r) => r.student.id)).toEqual([2, 1, 3])
    expect(sortRows(matrix.students, 'name').map((r) => r.student.id)).toEqual([2, 3, 1])
  })

  it('exports a CSV Excel can open', () => {
    const csv = matrixCsv(matrix, matrix.students)
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).trim().split('\r\n')
    expect(lines[0]).toBe(
      'student_no,full_name,username,1. Print,"2. Comments, ""notes""",passed,completion_percent',
    )
    expect(lines[1]).toBe('2026-1,Cruz,u1,passed,3 tries,1/2,50')
  })
})
