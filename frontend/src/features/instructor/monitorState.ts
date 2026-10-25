import type { ExecutionStatus, StudentMonitor } from '@/api/types'

/** One message from /ws/monitor/{session_id}. Never carries student code. */
export interface MonitorEvent {
  type: string
  student_id?: number
  ts?: string
  [key: string]: unknown
}

/** What a student's last press of the Test button reported (from the snapshot, then live events). */
export interface LastTestInfo {
  executionId: number | null
  passed: number
  total: number
  score: number | null
  maxScore: number | null
  /** When it finished (the server's time, if it said). */
  at: string
}

const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** The snapshot's `last_test` of each student, by student id. */
export function testsFromSnapshot(students: StudentMonitor[]): Record<number, LastTestInfo> {
  const out: Record<number, LastTestInfo> = {}
  for (const s of students) {
    const t = s.last_test
    if (!t) continue
    out[s.student.id] = {
      executionId: t.execution_id,
      passed: t.passed,
      total: t.total,
      score: t.score,
      maxScore: t.max_score,
      at: t.finished_at ?? new Date().toISOString(),
    }
  }
  return out
}

/** Keep whichever result is newer: a live event can be newer than a snapshot, or the other way round. */
export function newerTest(a: LastTestInfo | undefined, b: LastTestInfo): LastTestInfo {
  if (!a) return b
  if (a.executionId !== null && b.executionId !== null)
    return b.executionId >= a.executionId ? b : a
  return Date.parse(b.at) >= Date.parse(a.at) ? b : a
}

/** A {"type":"tested"} event as a student id and result, or null if it is not one (or is malformed). */
export function testedFromEvent(
  event: MonitorEvent,
): { studentId: number; test: LastTestInfo } | null {
  if (event.type !== 'tested' || typeof event.student_id !== 'number') return null
  const passed = Number(event.passed)
  const total = Number(event.total)
  if (!Number.isInteger(passed) || !Number.isInteger(total) || total < 0) return null
  return {
    studentId: event.student_id,
    test: {
      executionId: numOrNull(event.execution_id),
      passed,
      total,
      score: numOrNull(event.score),
      maxScore: numOrNull(event.max_score),
      at: typeof event.ts === 'string' ? event.ts : new Date().toISOString(),
    },
  }
}

const ERROR_STATUSES = ['error', 'timeout', 'memory_exceeded', 'output_limit', 'system_error']

/** The last run ended badly (not just "ok"). */
export const hasRunError = (s: StudentMonitor): boolean =>
  s.last_run !== null && ERROR_STATUSES.includes(s.last_run.status)

export interface Applied {
  students: StudentMonitor[]
  /** The event is about a student the snapshot does not list: reload the snapshot. */
  unknownStudent: boolean
}

/**
 * Puts one live event on top of the snapshot. The list is returned unchanged (same array) when the
 * event changes nothing, so React skips the re-render.
 */
export function applyMonitorEvent(students: StudentMonitor[], event: MonitorEvent): Applied {
  const id = event.student_id
  if (typeof id !== 'number') return { students, unknownStudent: false }
  const index = students.findIndex((s) => s.student.id === id)
  if (index === -1) {
    const known = ['run', 'run_done', 'saved', 'submitted', 'online', 'offline', 'started']
    return { students, unknownStudent: known.includes(event.type) }
  }

  const before = students[index]!
  const after = updateStudent(before, event)
  if (after === before) return { students, unknownStudent: false }
  const next = students.slice()
  next[index] = after
  return { students: next, unknownStudent: false }
}

function updateStudent(s: StudentMonitor, e: MonitorEvent): StudentMonitor {
  const ts = typeof e.ts === 'string' ? e.ts : null
  switch (e.type) {
    case 'online':
      return s.online ? s : { ...s, online: true }
    case 'offline':
      return s.online ? { ...s, online: false } : s
    case 'run': {
      // A new run starts: it replaces whatever was shown as the last run.
      const executionId = Number(e.execution_id)
      if (!Number.isFinite(executionId)) return s
      return {
        ...s,
        last_run: {
          execution_id: executionId,
          entry_path: String(e.entry ?? ''),
          status: 'queued',
          duration_ms: null,
          queued_at: ts,
          finished_at: null,
        },
      }
    }
    case 'run_done': {
      const executionId = Number(e.execution_id)
      const last = s.last_run
      // A result for an older run than the one shown (events can arrive late) is ignored.
      if (last && Number.isFinite(executionId) && last.execution_id > executionId) return s
      return {
        ...s,
        last_run: {
          execution_id: Number.isFinite(executionId) ? executionId : (last?.execution_id ?? 0),
          entry_path: last?.entry_path ?? '',
          status: e.status as ExecutionStatus,
          duration_ms: typeof e.duration_ms === 'number' ? e.duration_ms : null,
          queued_at: last?.queued_at ?? null,
          finished_at: ts,
        },
      }
    }
    case 'saved':
      return ts ? { ...s, last_save: ts } : s
    case 'submitted':
      return { ...s, submitted: true, last_submitted_at: ts ?? s.last_submitted_at }
    case 'started':
      return applyStarted(s, e)
    default:
      return s
  }
}

/**
 * {"type":"started"}: the student began working in this session (`started_at`), or opened an activity for the
 * first time (`activity_id` and `activity`, its title, too). Each is announced once; the first time stays.
 */
function applyStarted(s: StudentMonitor, e: MonitorEvent): StudentMonitor {
  const at =
    typeof e.started_at === 'string' ? e.started_at : typeof e.ts === 'string' ? e.ts : null
  if (!at) return s
  const activityId = typeof e.activity_id === 'number' ? e.activity_id : null
  const starts = s.activity_starts ?? []
  const newActivity = activityId !== null && !starts.some((a) => a.activity_id === activityId)
  const newSession = !s.started_at
  if (!newActivity && !newSession) return s
  return {
    ...s,
    started_at: s.started_at ?? at,
    first_activity_id: s.first_activity_id ?? activityId,
    activity_starts: newActivity
      ? [
          ...starts,
          {
            activity_id: activityId,
            title: typeof e.activity === 'string' ? e.activity : 'Activity',
            started_at: at,
          },
        ]
      : starts,
  }
}

/** The student has started working in this session (opened their workspace while it was open). */
export const hasStarted = (s: StudentMonitor): boolean => Boolean(s.started_at)

export type StartedSort = 'earliest' | 'latest'

/** By when they started, earliest or latest first; those who have not started are always last. */
export function sortByStarted(students: StudentMonitor[], order: StartedSort): StudentMonitor[] {
  const time = (s: StudentMonitor) => (s.started_at ? Date.parse(s.started_at) : null)
  return students.slice().sort((a, b) => {
    const ta = time(a)
    const tb = time(b)
    if (ta === null || tb === null) return ta === null ? (tb === null ? 0 : 1) : -1
    return order === 'earliest' ? ta - tb : tb - ta
  })
}

export interface MonitorCounts {
  total: number
  online: number
  /** Students whose last run is known (they have run code this session). */
  ran: number
  submitted: number
  /** Students who have started working in this session. */
  started: number
  offline: number
  errors: number
  notSubmitted: number
  notStarted: number
}

export function monitorCounts(students: StudentMonitor[]): MonitorCounts {
  const online = students.filter((s) => s.online).length
  const submitted = students.filter((s) => s.submitted).length
  const started = students.filter(hasStarted).length
  return {
    total: students.length,
    online,
    ran: students.filter((s) => s.last_run !== null).length,
    submitted,
    started,
    offline: students.length - online,
    errors: students.filter(hasRunError).length,
    notSubmitted: students.length - submitted,
    notStarted: students.length - started,
  }
}

export type MonitorFilter = 'all' | 'offline' | 'errors' | 'unsubmitted' | 'notstarted'

export function filterStudents(
  students: StudentMonitor[],
  filter: MonitorFilter,
): StudentMonitor[] {
  switch (filter) {
    case 'offline':
      return students.filter((s) => !s.online)
    case 'errors':
      return students.filter(hasRunError)
    case 'unsubmitted':
      return students.filter((s) => !s.submitted)
    case 'notstarted':
      return students.filter((s) => !hasStarted(s))
    default:
      return students
  }
}
