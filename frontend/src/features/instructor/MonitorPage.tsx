import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Eye,
  LayoutGrid,
  TimerReset,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useClass } from '@/api/queries/classes'
import { useMonitorSnapshot } from '@/api/queries/monitor'
import { useSessions, useUpdateSession } from '@/api/queries/sessions'
import { ApiError, errorMessage } from '@/api/errors'
import type { ExecutionStatus, LastRun, StudentMonitor } from '@/api/types'
import { connectSocket, type SocketStatus } from '@/api/ws'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Spinner'
import { Table, Td, Th } from '@/components/ui/Table'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import { TableToolbar } from '@/components/ui/TableToolbar'
import { ChangeLabDialog } from '@/features/labs/LabField'
import { extendedEnd, hasEnded } from '@/lib/labSession'
import { SessionClock } from '@/components/SessionClock'
import { toast } from '@/components/ui/toastStore'
import { baseName } from '@/lib/paths'
import { matchesSearch } from '@/lib/tableView'
import { formatDateTime, formatTimeOfDay, isToday, timeAgo } from '@/lib/time'
import { useIdParam } from '@/lib/params'
import { useNow } from '@/lib/useNow'
import {
  filterStudents,
  monitorCounts,
  type LastTestInfo,
  sortByStarted,
  type MonitorFilter,
  type StartedSort,
} from './monitorState'
import { SignInsTable } from './SignInsTable'

import { useMonitorStore } from './monitorStore'
import { buttonClass } from '@/components/ui/buttonStyles'

type MonitorView = 'students' | 'logins'

const RUN_LABEL: Record<ExecutionStatus, { text: string; tone: Tone }> = {
  queued: { text: 'Queued', tone: 'open' },
  running: { text: 'Running', tone: 'open' },
  ok: { text: 'OK', tone: 'ok' },
  error: { text: 'Error', tone: 'error' },
  timeout: { text: 'Timed out', tone: 'warn' },
  memory_exceeded: { text: 'Out of memory', tone: 'warn' },
  output_limit: { text: 'Too much output', tone: 'warn' },
  system_error: { text: 'Server problem', tone: 'error' },
  stopped: { text: 'Stopped', tone: 'warn' },
  input_timeout: { text: 'Waited for input', tone: 'warn' },
}

const FILTERS: { id: MonitorFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'offline', label: 'Offline' },
  { id: 'errors', label: 'Has errors' },
  { id: 'unsubmitted', label: 'Not submitted' },
  { id: 'notstarted', label: 'Not started' },
]

export function MonitorPage() {
  const classId = useIdParam('classId')
  const sessionId = useIdParam('sessionId')
  if (classId === null || sessionId === null) return <NotFound classId={classId} />
  return <Monitor classId={classId} sessionId={sessionId} />
}

function NotFound({ classId }: { classId: number | null }) {
  return (
    <EmptyState
      title="Session not found"
      action={
        <Link
          to={classId === null ? '/classes' : `/classes/${classId}?tab=sessions`}
          className="font-medium text-brand-700 underline"
        >
          Back to sessions
        </Link>
      }
    >
      This lab session does not exist, or it belongs to another instructor.
    </EmptyState>
  )
}

function Monitor({ classId, sessionId }: { classId: number; sessionId: number }) {
  const cls = useClass(classId)
  const sessions = useSessions(classId, { page: 1, size: 100 })
  const snapshot = useMonitorSnapshot(sessionId)
  const { refetch } = snapshot

  const base = useMonitorStore((s) => s.base)
  const liveStudents = useMonitorStore((s) => s.students)
  const tests = useMonitorStore((s) => s.tests)
  const [tab, setTab] = useState<MonitorView>('students')
  const [changingLab, setChangingLab] = useState(false)
  const [filter, setFilter] = useState<MonitorFilter>('all')
  const [search, setSearch] = useState('')
  // null: the class's own order; else by when each student started (not started always last).
  const [startedSort, setStartedSort] = useState<StartedSort | null>(null)
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting')
  const [refused, setRefused] = useState<string | null>(null)
  const now = useNow(10_000)
  const extend = useUpdateSession(classId)

  // Start empty for this session; every fresh snapshot replaces whatever live events built up.
  useEffect(() => {
    useMonitorStore.getState().reset()
  }, [sessionId])
  useEffect(() => {
    if (snapshot.data) useMonitorStore.getState().seed(snapshot.data)
  }, [snapshot.data])

  // The live feed. A student we do not know about (approved after this page loaded) or a reconnect
  // means "reload the snapshot".
  useEffect(() => {
    const socket = connectSocket({
      path: `/ws/monitor/${sessionId}`,
      onStatus: setSocketStatus,
      onOpen: ({ reconnected }) => {
        // Back after a break: what happened meanwhile is in a fresh snapshot.
        if (reconnected) void refetch()
      },
      onFatal: (code, error) =>
        setRefused(
          error?.detail ||
            (code === 4404 ? 'This session no longer exists.' : 'You cannot watch this session.'),
        ),
      onMessage: (message) => {
        if (useMonitorStore.getState().apply(message)) void refetch()
      },
    })
    return () => socket.close()
  }, [sessionId, refetch])

  const session = sessions.data?.items.find((s) => s.id === sessionId)

  if (snapshot.isError && !snapshot.data) {
    const gone = snapshot.error instanceof ApiError && [403, 404].includes(snapshot.error.status)
    return gone ? (
      <NotFound classId={classId} />
    ) : (
      <EmptyState
        title="The session could not be loaded"
        action={<Button onClick={() => void refetch()}>Try again</Button>}
      >
        {errorMessage(snapshot.error)}
      </EmptyState>
    )
  }

  // Until the store has this snapshot, show the snapshot itself.
  const students: StudentMonitor[] =
    snapshot.data && base === snapshot.data ? liveStudents : (snapshot.data?.students ?? [])
  const counts = monitorCounts(students)
  const matching = filterStudents(students, filter).filter((s) =>
    matchesSearch(
      `${s.student.full_name} ${s.student.username} ${s.student.student_no ?? ''}`,
      search,
    ),
  )
  const shown = startedSort ? sortByStarted(matching, startedSort) : matching
  // Ended at its scheduled end, even if the server has not swept it closed yet (up to 15 s).
  const isOpen =
    snapshot.data === undefined
      ? undefined
      : snapshot.data.is_open && !(session && hasEnded(session, now))

  return (
    <div className="page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* "Live" only while the session is open: a closed one is a record of where things stood. */}
          <h1 className="text-2xl font-semibold">
            {isOpen === undefined ? 'Lab session' : isOpen ? 'Live monitor' : 'Session view'}
          </h1>
          <p className="text-ink-muted">
            {cls.data?.name ?? 'Class'}
            {session ? ` · ${session.name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOpen !== undefined && (
            <Badge tone={isOpen ? 'open' : 'pending'}>
              {isOpen ? 'Laboratory OPEN' : 'Session closed'}
            </Badge>
          )}
          {isOpen && session && <SessionClock session={session} className="text-sm" />}
          {isOpen !== false && <ConnectionBadge status={socketStatus} refused={refused} />}
          {isOpen && session && (
            <Button
              size="sm"
              loading={extend.isPending}
              title={`Move the end to ${formatTimeOfDay(extendedEnd(session, now))}`}
              onClick={() =>
                extend.mutate(
                  { id: session.id, body: { ends_at: extendedEnd(session, Date.now()) } },
                  {
                    onSuccess: (s) =>
                      toast.success(`Extended: it now ends at ${formatTimeOfDay(s.ends_at)}`),
                    onError: (err) => toast.error(errorMessage(err)),
                  },
                )
              }
            >
              <TimerReset aria-hidden className="size-3.5" />
              Extend 30 min
            </Button>
          )}
          {session && (
            <Button
              size="sm"
              title="Move the session to another lab"
              onClick={() => setChangingLab(true)}
            >
              <LayoutGrid aria-hidden className="size-3.5" />
              Change lab
            </Button>
          )}
        </div>
      </header>

      {refused && (
        <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
          {refused}
        </p>
      )}
      {isOpen === false && (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-ink-muted">
          This session is closed. Live updates only arrive while a session is open, so this shows
          where things stood.
        </p>
      )}

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Online" value={`${counts.online} of ${counts.total}`} />
        <Stat label="Ran code" value={String(counts.ran)} />
        <Stat label="Submitted" value={String(counts.submitted)} />
        <Stat label="Started" value={`${counts.started} of ${counts.total}`} />
      </section>

      <Tabs
        label="Monitor views"
        active={tab}
        onChange={(id) => setTab(id as MonitorView)}
        tabs={[
          { id: 'students', label: 'Students' },
          { id: 'logins', label: 'Sign-ins' },
        ]}
      />
      {tab === 'logins' ? (
        <TabPanel id="logins">
          <SignInsTable sessionId={sessionId} live={isOpen === true} />
        </TabPanel>
      ) : (
        <StudentsView>
          {students.length > 0 && (
            <TableToolbar
              what="students"
              placeholder="Name, username or student no."
              search={search}
              onSearch={setSearch}
              active={search.trim() !== '' || filter !== 'all'}
              onClear={() => {
                setSearch('')
                setFilter('all')
              }}
              shown={shown.length}
              total={students.length}
            />
          )}

          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const n =
                f.id === 'all'
                  ? counts.total
                  : f.id === 'offline'
                    ? counts.offline
                    : f.id === 'errors'
                      ? counts.errors
                      : f.id === 'notstarted'
                        ? counts.notStarted
                        : counts.notSubmitted
              const active = filter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${
                    active
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-line bg-surface hover:bg-surface-2'
                  }`}
                >
                  {f.label} <span className={active ? 'text-white/80' : 'text-ink-muted'}>{n}</span>
                </button>
              )
            })}
          </div>

          {snapshot.isPending ? (
            <div className="flex flex-col gap-2" role="status" aria-label="Loading students">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : students.length === 0 ? (
            <EmptyState title="No students in this class yet">
              Approve students on the Students tab and they appear here.
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState title="No one matches this filter" />
          ) : (
            <Table caption="Every student in the class and what they are doing">
              <thead>
                <tr>
                  <Th>Student</Th>
                  <StartedTh sort={startedSort} onSort={setStartedSort} />
                  <Th>Last run</Th>
                  <Th>Tests</Th>
                  <Th>Last save</Th>
                  <Th>Submitted</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <StudentRow
                    key={s.student.id}
                    classId={classId}
                    sessionId={sessionId}
                    s={s}
                    test={tests[s.student.id]}
                    now={now}
                  />
                ))}
              </tbody>
            </Table>
          )}
        </StudentsView>
      )}
      <ChangeLabDialog
        classId={classId}
        session={changingLab && session ? session : null}
        onClose={() => setChangingLab(false)}
      />
    </div>
  )
}

/** The table view, under the Students tab. */
function StudentsView({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>
}

function ConnectionBadge({ status, refused }: { status: SocketStatus; refused: string | null }) {
  if (refused || status === 'closed') {
    return (
      <Badge tone="error">
        <WifiOff aria-hidden className="mr-1 size-3" />
        Not live
      </Badge>
    )
  }
  if (status === 'open') {
    return (
      <Badge tone="ok">
        <Wifi aria-hidden className="mr-1 size-3" />
        Live
      </Badge>
    )
  }
  return (
    <Badge tone="warn">
      <Wifi aria-hidden className="mr-1 size-3" />
      Reconnecting…
    </Badge>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  )
}

function formatDuration(ms: number | null): string {
  return ms === null ? '' : `${(ms / 1000).toFixed(1)} s`
}

function LastRunCell({ run, now }: { run: LastRun | null; now: number }) {
  if (!run) return <span className="text-ink-muted">Not run yet</span>
  const label = RUN_LABEL[run.status]
  const when = run.finished_at ?? run.queued_at
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={label.tone}>{label.text}</Badge>
        <span className="font-mono text-xs" title={run.entry_path}>
          {run.entry_path ? baseName(run.entry_path) : ''}
        </span>
      </div>
      <span className="text-xs text-ink-muted">
        {[formatDuration(run.duration_ms), when ? timeAgo(when, now) : '']
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
  )
}

function TestsCell({ test, now }: { test: LastTestInfo | undefined; now: number }) {
  if (!test) return <span className="text-ink-muted">—</span>
  const all = test.total > 0 && test.passed === test.total
  return (
    <div className="flex flex-col gap-0.5">
      <Badge tone={all ? 'ok' : test.passed === 0 ? 'error' : 'warn'}>
        {test.passed}/{test.total} passed
      </Badge>
      <span className="text-xs text-ink-muted">
        {test.score !== null && test.maxScore !== null
          ? `${test.score}/${test.maxScore} pts · `
          : ''}
        {timeAgo(test.at, now)}
      </span>
    </div>
  )
}

function StudentRow({
  classId,
  sessionId,
  s,
  test,
  now,
}: {
  classId: number
  sessionId: number
  s: StudentMonitor
  test: LastTestInfo | undefined
  now: number
}) {
  const navigate = useNavigate()
  const to = `/classes/${classId}/students/${s.student.id}/workspace`
  const state = { backTo: `/classes/${classId}/sessions/${sessionId}/monitor` }

  return (
    <tr
      // The whole row opens the workspace for the mouse; the name and the button are real links
      // for the keyboard.
      onClick={() => navigate(to, { state })}
      className="cursor-pointer hover:bg-surface-2/60"
    >
      <Td>
        <div className="flex items-center gap-2.5">
          <span
            className={`size-2.5 shrink-0 rounded-full ${s.online ? 'bg-ok' : 'bg-line'}`}
            aria-hidden
          />
          <span className="sr-only">{s.online ? 'Online' : 'Offline'}</span>
          <div>
            <Link to={to} state={state} className="font-medium hover:underline">
              {s.student.full_name}
            </Link>
            <p className="font-mono text-xs text-ink-muted">{s.student.username}</p>
          </div>
        </div>
      </Td>
      <Td className="whitespace-nowrap">
        <StartedCell s={s} now={now} />
      </Td>
      <Td>
        <LastRunCell run={s.last_run} now={now} />
      </Td>
      <Td>
        <TestsCell test={test} now={now} />
      </Td>
      <Td className="whitespace-nowrap text-ink-muted">
        {s.last_save ? timeAgo(s.last_save, now) : '—'}
      </Td>
      <Td>
        {s.submitted ? (
          <span className="flex items-center gap-1.5 text-ok">
            <Check aria-hidden className="size-4" />
            <span className="sr-only">Submitted</span>
            <span className="text-xs text-ink-muted">
              {s.last_submitted_at ? timeAgo(s.last_submitted_at, now) : ''}
            </span>
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </Td>
      <Td>
        <div className="flex justify-end">
          <Link
            to={to}
            state={state}
            aria-label={`View the workspace of ${s.student.full_name}`}
            onClick={(e) => e.stopPropagation()}
            className={buttonClass('secondary', 'sm')}
          >
            <Eye aria-hidden className="size-3.5" />
            Workspace
          </Link>
        </div>
      </Td>
    </tr>
  )
}

/** "8:03 AM" today; with the date for an older session. */
const startTime = (iso: string, now: number) =>
  isToday(iso, now) ? formatTimeOfDay(iso) : formatDateTime(iso)

/**
 * When the student started working in this session (first opened their workspace while it was open), and when
 * they first opened each activity: "Lab 3 — 8:05 AM" on hover, and listed under a disclosure.
 */
function StartedCell({ s, now }: { s: StudentMonitor; now: number }) {
  if (!s.started_at) return <span className="text-ink-muted">Not started</span>
  const starts = s.activity_starts ?? []
  const lines = starts.map((a) => `${a.title} — ${startTime(a.started_at, now)}`)
  return (
    <div title={lines.length > 0 ? lines.join('\n') : undefined}>
      <time dateTime={s.started_at} className="font-medium">
        {startTime(s.started_at, now)}
      </time>
      {lines.length > 0 && (
        // Its own clicks stay here: the rest of the row opens the student's workspace.
        <details className="text-xs text-ink-muted" onClick={(e) => e.stopPropagation()}>
          <summary className="cursor-pointer select-none">
            {lines.length} {lines.length === 1 ? 'activity' : 'activities'}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** The Started column's heading: sorts earliest first, then latest first (those not started stay last). */
function StartedTh({
  sort,
  onSort,
}: {
  sort: StartedSort | null
  onSort: (next: StartedSort) => void
}) {
  const Icon = sort === null ? ArrowUpDown : sort === 'earliest' ? ArrowUp : ArrowDown
  return (
    <Th aria-sort={sort === null ? 'none' : sort === 'earliest' ? 'ascending' : 'descending'}>
      <button
        type="button"
        onClick={() => onSort(sort === 'earliest' ? 'latest' : 'earliest')}
        title={sort === 'earliest' ? 'Latest first' : 'Earliest first'}
        className="inline-flex items-center gap-1 tracking-wide uppercase hover:text-ink"
      >
        Started
        <Icon aria-hidden className={`size-3 ${sort === null ? 'opacity-60' : 'text-ink'}`} />
      </button>
    </Th>
  )
}
