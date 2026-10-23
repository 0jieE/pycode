import { describe, expect, it } from 'vitest'
import type { StudentMonitor } from '@/api/types'
import {
  applyMonitorEvent,
  filterStudents,
  hasRunError,
  monitorCounts,
  newerTest,
  testedFromEvent,
  testsFromSnapshot,
  type MonitorEvent,
} from './monitorState'

function student(id: number, patch: Partial<StudentMonitor> = {}): StudentMonitor {
  return {
    student: { id, username: `s${id}`, full_name: `Student ${id}`, student_no: null },
    online: false,
    last_run: null,
    last_test: null,
    last_save: null,
    submitted: false,
    last_submitted_at: null,
    ...patch,
  }
}

const run = (execution_id: number, status: NonNullable<StudentMonitor['last_run']>['status']) => ({
  execution_id,
  entry_path: 'Lab/main.py',
  status,
  duration_ms: 100,
  queued_at: '2026-10-08T01:00:00Z',
  finished_at: '2026-10-08T01:00:01Z',
})

const at = '2026-10-08T02:00:00Z'
const ev = (
  type: string,
  student_id: number,
  extra: Record<string, unknown> = {},
): MonitorEvent => ({
  type,
  student_id,
  ts: at,
  ...extra,
})

describe('presence', () => {
  it('online and offline flip the dot, only for that student', () => {
    const list = [student(1), student(2)]
    const on = applyMonitorEvent(list, ev('online', 2)).students
    expect(on.map((s) => s.online)).toEqual([false, true])
    const off = applyMonitorEvent(on, ev('offline', 2)).students
    expect(off.map((s) => s.online)).toEqual([false, false])
  })

  it('returns the very same list when nothing changes (no needless re-render)', () => {
    const list = [student(1, { online: true })]
    expect(applyMonitorEvent(list, ev('online', 1)).students).toBe(list)
    expect(applyMonitorEvent(list, ev('pong', 1)).students).toBe(list)
    expect(applyMonitorEvent(list, { type: 'connected' }).students).toBe(list)
  })

  it('does not mutate the list it was given', () => {
    const list = [student(1)]
    applyMonitorEvent(list, ev('online', 1))
    expect(list[0]!.online).toBe(false)
  })
})

describe('runs', () => {
  it('a new run replaces the last run and starts as queued', () => {
    const list = [student(1, { last_run: run(5, 'ok') })]
    const [s] = applyMonitorEvent(
      list,
      ev('run', 1, { execution_id: 9, entry: 'Lab/a.py' }),
    ).students
    expect(s!.last_run).toMatchObject({
      execution_id: 9,
      entry_path: 'Lab/a.py',
      status: 'queued',
      duration_ms: null,
      finished_at: null,
      queued_at: at,
    })
  })

  it('run_done fills in the result of that run and keeps its file name', () => {
    const list = applyMonitorEvent(
      [student(1)],
      ev('run', 1, { execution_id: 9, entry: 'Lab/a.py' }),
    ).students
    const [s] = applyMonitorEvent(
      list,
      ev('run_done', 1, {
        execution_id: 9,
        status: 'timeout',
        exit_code: null,
        duration_ms: 10_000,
      }),
    ).students
    expect(s!.last_run).toMatchObject({
      execution_id: 9,
      entry_path: 'Lab/a.py',
      status: 'timeout',
      duration_ms: 10_000,
      finished_at: at,
    })
  })

  it('ignores a late result for an older run than the one shown', () => {
    const list = [student(1, { last_run: run(12, 'queued') })]
    const out = applyMonitorEvent(
      list,
      ev('run_done', 1, { execution_id: 11, status: 'ok', duration_ms: 5 }),
    )
    expect(out.students).toBe(list)
  })

  it('shows a result even if the "run" event was missed', () => {
    const [s] = applyMonitorEvent(
      [student(1)],
      ev('run_done', 1, { execution_id: 3, status: 'error', duration_ms: 40 }),
    ).students
    expect(s!.last_run).toMatchObject({ execution_id: 3, status: 'error' })
  })
})

describe('saves and submissions', () => {
  it('saved sets the last save time', () => {
    const [s] = applyMonitorEvent([student(1)], ev('saved', 1, { path: 'Lab/a.py' })).students
    expect(s!.last_save).toBe(at)
  })

  it('submitted ticks the box and records when', () => {
    const [s] = applyMonitorEvent([student(1)], ev('submitted', 1, { activity_id: 2 })).students
    expect(s).toMatchObject({ submitted: true, last_submitted_at: at })
  })
})

describe('unknown students', () => {
  it('asks for a fresh snapshot when an event is about someone not in the list', () => {
    const list = [student(1)]
    const out = applyMonitorEvent(list, ev('online', 99))
    expect(out.unknownStudent).toBe(true)
    expect(out.students).toBe(list)
  })

  it('does not for messages that are not about a student', () => {
    expect(applyMonitorEvent([student(1)], { type: 'connected' }).unknownStudent).toBe(false)
    expect(applyMonitorEvent([student(1)], ev('pong', 99)).unknownStudent).toBe(false)
  })
})

describe('counts and filters', () => {
  const list = [
    student(1, { online: true, last_run: run(1, 'ok'), submitted: true }),
    student(2, { online: true, last_run: run(2, 'error') }),
    student(3, { last_run: run(3, 'timeout') }),
    student(4),
    student(5, { last_run: run(5, 'queued') }),
  ]

  it('counts online, ran code and submitted for the header', () => {
    expect(monitorCounts(list)).toEqual({
      total: 5,
      online: 2,
      ran: 4,
      submitted: 1,
      offline: 3,
      errors: 2,
      notSubmitted: 4,
    })
  })

  it('"has errors" means the last run ended badly, not queued or ok', () => {
    expect(list.map(hasRunError)).toEqual([false, true, true, false, false])
    expect(hasRunError(student(1, { last_run: run(1, 'system_error') }))).toBe(true)
    expect(hasRunError(student(1, { last_run: run(1, 'output_limit') }))).toBe(true)
  })

  it.each([
    ['all', [1, 2, 3, 4, 5]],
    ['offline', [3, 4, 5]],
    ['errors', [2, 3]],
    ['unsubmitted', [2, 3, 4, 5]],
  ] as const)('filter "%s"', (filter, ids) => {
    expect(filterStudents(list, filter).map((s) => s.student.id)).toEqual(ids)
  })
})

describe('testedFromEvent', () => {
  it('reads a tested event', () => {
    expect(
      testedFromEvent({
        type: 'tested',
        student_id: 4,
        execution_id: 90,
        passed: 2,
        total: 3,
        score: 4,
        max_score: 6,
        ts: '2026-10-10T01:00:00Z',
      }),
    ).toEqual({
      studentId: 4,
      test: {
        executionId: 90,
        passed: 2,
        total: 3,
        score: 4,
        maxScore: 6,
        at: '2026-10-10T01:00:00Z',
      },
    })
  })

  it('ignores other events and malformed ones', () => {
    expect(testedFromEvent({ type: 'run', student_id: 4 })).toBeNull()
    expect(testedFromEvent({ type: 'tested', passed: 1, total: 2 })).toBeNull()
    expect(testedFromEvent({ type: 'tested', student_id: 4, passed: 'x', total: 2 })).toBeNull()
    expect(testedFromEvent({ type: 'tested', student_id: 4, passed: 1, total: -1 })).toBeNull()
  })
})

describe('the latest test of each student', () => {
  const lastTest = {
    execution_id: 50,
    activity_id: 3,
    passed: 6,
    total: 6,
    score: 10,
    max_score: 10,
    finished_at: '2026-10-11T08:04:00Z',
  }

  it('comes from the snapshot, so tests run before the page opened show up', () => {
    expect(testsFromSnapshot([student(1, { last_test: lastTest }), student(2)])).toEqual({
      1: {
        executionId: 50,
        passed: 6,
        total: 6,
        score: 10,
        maxScore: 10,
        at: '2026-10-11T08:04:00Z',
      },
    })
  })

  it('keeps whichever result is newer', () => {
    const older = {
      executionId: 50,
      passed: 1,
      total: 2,
      score: 1,
      maxScore: 2,
      at: '2026-10-11T08:00:00Z',
    }
    const newer = { ...older, executionId: 51, passed: 2, at: '2026-10-11T07:00:00Z' }
    expect(newerTest(older, newer)).toBe(newer)
    expect(newerTest(newer, older)).toBe(newer)
    expect(newerTest(undefined, older)).toBe(older)
    // Without ids, the time decides.
    const a = { ...older, executionId: null }
    const b = { ...older, executionId: null, at: '2026-10-11T09:00:00Z' }
    expect(newerTest(a, b)).toBe(b)
  })
})
