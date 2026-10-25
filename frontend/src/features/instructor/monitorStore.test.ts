import { beforeEach, describe, expect, it } from 'vitest'
import type { MonitorSnapshot, StudentMonitor } from '@/api/types'
import { filterStudents, monitorCounts } from './monitorState'
import { useMonitorStore } from './monitorStore'

const s = () => useMonitorStore.getState()

const student = (id: number, patch: Partial<StudentMonitor> = {}): StudentMonitor => ({
  student: { id, username: `s${id}`, full_name: `Student ${id}`, student_no: null },
  online: true,
  last_run: null,
  last_test: null,
  last_save: null,
  submitted: false,
  last_submitted_at: null,
  started_at: null,
  first_activity_id: null,
  activity_starts: [],
  ...patch,
})

const snapshot: MonitorSnapshot = {
  session_id: 4,
  class_id: 2,
  is_open: true,
  generated_at: '2026-10-25T00:00:00Z',
  online_count: 3,
  students: [student(1, { started_at: '2026-10-25T00:01:00Z' }), student(2), student(3)],
}

beforeEach(() => s().reset())

describe('the monitor store and starts', () => {
  it('a live "started" event updates the row, the Started count and the Not started filter', () => {
    s().seed(snapshot)
    expect(monitorCounts(s().students)).toMatchObject({ started: 1, notStarted: 2, total: 3 })

    const unknown = s().apply({
      type: 'started',
      student_id: 2,
      student: 'Student 2',
      ts: '2026-10-25T00:03:00Z',
      started_at: '2026-10-25T00:03:00Z',
    })
    expect(unknown).toBe(false)
    expect(s().students.find((x) => x.student.id === 2)?.started_at).toBe('2026-10-25T00:03:00Z')
    expect(monitorCounts(s().students)).toMatchObject({ started: 2, notStarted: 1 })
    expect(filterStudents(s().students, 'notstarted').map((x) => x.student.id)).toEqual([3])
  })

  it('a fresh snapshot (e.g. after a reconnect) is the authority again', () => {
    s().seed(snapshot)
    s().apply({ type: 'started', student_id: 3, started_at: '2026-10-25T00:04:00Z' })
    s().seed({ ...snapshot, students: snapshot.students.map((x) => ({ ...x })) })
    expect(monitorCounts(s().students).started).toBe(1)
  })
})
