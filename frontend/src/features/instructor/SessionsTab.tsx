import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  CalendarClock,
  DoorClosed,
  DoorOpen,
  LayoutGrid,
  Plus,
  TimerReset,
} from 'lucide-react'
import {
  useAllSessions,
  useLiveSession,
  useSessions,
  useSetSessionOpen,
  useUpdateSession,
} from '@/api/queries/sessions'
import { useLabs } from '@/api/queries/labs'
import { ApiError, errorMessage } from '@/api/errors'
import type { LabSession } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { SelectField } from '@/components/ui/SelectField'
import { Skeleton } from '@/components/ui/Spinner'
import { Table, Td, Th } from '@/components/ui/Table'
import { NoMatches, TableToolbar } from '@/components/ui/TableToolbar'
import { toast } from '@/components/ui/toastStore'
import { SessionClock } from '@/components/SessionClock'
import { extendedEnd, hasEnded, isRunning, opensFrom, tooEarly } from '@/lib/labSession'
import { useTableView } from '@/lib/tableView'
import { formatDateTime, formatTimeOfDay } from '@/lib/time'
import { useNow } from '@/lib/useNow'
import { ChangeLabDialog } from '@/features/labs/LabField'
import { SessionFormDialog } from './SessionFormDialog'
import { SessionScheduleDialog } from './SessionScheduleDialog'
import { buttonClass } from '@/components/ui/buttonStyles'

const HISTORY_PAGE_SIZE = 8

/** Where a session is in its life, for the Status filter. Past its end it counts as closed even if not swept yet. */
const sessionState = (s: LabSession, now: number): 'open' | 'closed' | 'planned' =>
  isRunning(s, now) ? 'open' : s.opened_at ? 'closed' : 'planned'

/** Opens the "name and times" dialog, with an optional reason on top. */
type Reschedule = (session: LabSession, notice?: string) => void

/** A refused Open: past its end, offer to change the end time; anything else was already toasted. */
const openFailed = (session: LabSession, reschedule: Reschedule) => (err: unknown) => {
  if (
    err instanceof ApiError &&
    (err.code === 'SESSION_ENDED' || err.code === 'SESSION_NOT_STARTED')
  ) {
    reschedule(session, err.detail)
  }
}

/** "It starts Oct 19, 2026, 8:00 AM: it opens by itself then, or can be opened from 7:45 AM." */
const tooEarlyText = (s: LabSession): string =>
  `It starts ${formatDateTime(s.starts_at)}: it opens by itself then, or can be opened from ${formatDateTime(
    new Date(opensFrom(s)).toISOString(),
  )}.`

export function SessionsTab({ classId, archived }: { classId: number; archived: boolean }) {
  const [creating, setCreating] = useState(false)
  const [schedule, setSchedule] = useState<{ session: LabSession; notice: string | null } | null>(
    null,
  )
  const reschedule: Reschedule = (session, notice) =>
    setSchedule({ session, notice: notice ?? null })

  return (
    <div className="flex flex-col gap-6">
      <AccessControl
        classId={classId}
        archived={archived}
        onCreate={() => setCreating(true)}
        onReschedule={reschedule}
      />
      <History
        classId={classId}
        archived={archived}
        onCreate={() => setCreating(true)}
        onReschedule={reschedule}
      />
      <SessionFormDialog classId={classId} open={creating} onClose={() => setCreating(false)} />
      <SessionScheduleDialog
        classId={classId}
        session={schedule?.session ?? null}
        notice={schedule?.notice}
        onClose={() => setSchedule(null)}
      />
    </div>
  )
}

function sessionLabel(s: LabSession): string {
  return `${s.name} (${formatDateTime(s.starts_at)})`
}

/** Which session is the natural one to open: the one whose window contains now, else the next. */
function suggestedSession(sessions: LabSession[], now: number): LabSession | undefined {
  const inWindow = sessions.find(
    (s) => new Date(s.starts_at).getTime() <= now && now <= new Date(s.ends_at).getTime(),
  )
  if (inWindow) return inWindow
  const upcoming = sessions
    .filter((s) => new Date(s.starts_at).getTime() > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
  return upcoming ?? sessions.find((s) => !hasEnded(s, now)) ?? sessions[0]
}

// ----------------------------------------------------- the big OPEN/CLOSE control

function AccessControl({
  classId,
  archived,
  onCreate,
  onReschedule,
}: {
  classId: number
  archived: boolean
  onCreate: () => void
  onReschedule: Reschedule
}) {
  const current = useLiveSession(classId)
  const candidates = useSessions(classId, { page: 1, size: 100 })
  const setOpen = useSetSessionOpen(classId)
  const update = useUpdateSession(classId)
  const [picked, setPicked] = useState<string>('')
  const [confirmClose, setConfirmClose] = useState(false)
  const now = useNow(15_000)

  if (current.isPending) return <Skeleton className="h-40 w-full" />

  const openSession = current.session

  if (openSession) {
    return (
      <section
        aria-labelledby="access-heading"
        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border-2 border-open bg-open-soft p-6"
      >
        <div>
          <h2 id="access-heading" className="flex items-center gap-2 text-2xl font-bold text-open">
            <DoorOpen aria-hidden className="size-7" />
            Laboratory is OPEN
          </h2>
          <p className="mt-1 text-ink">
            {openSession.name} · opened{' '}
            {openSession.opened_at ? formatDateTime(openSession.opened_at) : ''}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            <SessionClock session={openSession} className="text-ink" />
            <span>Students can edit and run their code; it closes by itself at the end.</span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={update.isPending}
              title={`Move the end to ${formatTimeOfDay(extendedEnd(openSession, now))}`}
              onClick={() =>
                update.mutate(
                  { id: openSession.id, body: { ends_at: extendedEnd(openSession, Date.now()) } },
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
            <Button size="sm" onClick={() => onReschedule(openSession)}>
              <CalendarClock aria-hidden className="size-3.5" />
              Change times
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={`/classes/${classId}/sessions/${openSession.id}/monitor`}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-open bg-surface px-5 text-base font-medium text-open hover:bg-open-soft"
          >
            <Activity aria-hidden className="size-5" />
            Live monitor
          </Link>
          <Button
            variant="danger"
            size="lg"
            className="min-w-52 text-lg"
            onClick={() => setConfirmClose(true)}
          >
            <DoorClosed aria-hidden className="size-5" />
            CLOSE ACCESS
          </Button>
        </div>

        <ConfirmDialog
          open={confirmClose}
          title="Close laboratory access?"
          confirmLabel="Close access"
          destructive
          loading={setOpen.isPending}
          onConfirm={() =>
            setOpen.mutate(
              { id: openSession.id, open: false },
              {
                onSuccess: () => toast.success('Access is closed'),
                onSettled: () => setConfirmClose(false),
              },
            )
          }
          onCancel={() => setConfirmClose(false)}
        >
          Every student&apos;s workspace becomes read-only right away and Run stops working. Unsaved
          work in their editors may not be saved. Students can still view their files and submit.
        </ConfirmDialog>
      </section>
    )
  }

  const sessions = candidates.data?.items ?? []
  const chosenId = picked || String(suggestedSession(sessions, now)?.id ?? '')
  const chosen = sessions.find((s) => String(s.id) === chosenId)
  const chosenEnded = chosen ? hasEnded(chosen, now) : false
  // Opening long before its start would use the room outside the booked slot.
  const chosenEarly = chosen ? tooEarly(chosen, now) : false

  return (
    <section
      aria-labelledby="access-heading"
      className="flex flex-wrap items-end justify-between gap-4 rounded-xl border-2 border-line bg-surface p-6"
    >
      <div className="min-w-64 flex-1">
        <h2 id="access-heading" className="flex items-center gap-2 text-2xl font-bold text-pending">
          <DoorClosed aria-hidden className="size-7" />
          Laboratory is CLOSED
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Students can read their files, but they cannot edit or run code.
        </p>
        {sessions.length > 0 && (
          <div className="mt-4 max-w-md">
            <SelectField
              label="Session to open"
              value={chosenId}
              onChange={(e) => setPicked(e.target.value)}
              options={sessions.map((s) => ({
                value: String(s.id),
                label: hasEnded(s, now)
                  ? `${sessionLabel(s)} · ended`
                  : tooEarly(s, now)
                    ? `${sessionLabel(s)} · upcoming`
                    : sessionLabel(s),
              }))}
            />
            {chosen && chosenEnded && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-warn">
                Its end time ({formatDateTime(chosen.ends_at)}) has passed. Change it to open this
                session again.
                <Button size="sm" onClick={() => onReschedule(chosen)}>
                  <CalendarClock aria-hidden className="size-3.5" />
                  Change times
                </Button>
              </p>
            )}
            {chosen &&
              !chosenEarly &&
              !chosenEnded &&
              !chosen.opened_at &&
              now < new Date(chosen.starts_at).getTime() && (
                <p className="mt-2 text-sm text-ink-muted">
                  It opens by itself at {formatTimeOfDay(chosen.starts_at)}, or open it now.
                </p>
              )}
            {chosen && chosenEarly && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                {tooEarlyText(chosen)} To hold it now instead, change its times.
                <Button size="sm" onClick={() => onReschedule(chosen)}>
                  <CalendarClock aria-hidden className="size-3.5" />
                  Change times
                </Button>
              </p>
            )}
          </div>
        )}
      </div>
      {sessions.length > 0 ? (
        <Button
          variant="primary"
          size="lg"
          className="min-w-52 text-lg"
          disabled={!chosen || archived || chosenEnded || chosenEarly}
          loading={setOpen.isPending}
          onClick={() =>
            chosen &&
            setOpen.mutate(
              { id: chosen.id, open: true },
              {
                onSuccess: () => toast.success(`${chosen.name} is open`),
                onError: openFailed(chosen, onReschedule),
              },
            )
          }
        >
          <DoorOpen aria-hidden className="size-5" />
          OPEN ACCESS
        </Button>
      ) : candidates.isPending ? null : (
        <Button variant="primary" size="lg" disabled={archived} onClick={onCreate}>
          <Plus aria-hidden className="size-5" />
          Create the first session
        </Button>
      )}
    </section>
  )
}

// ------------------------------------------------------------------- history

function History({
  classId,
  archived,
  onCreate,
  onReschedule,
}: {
  classId: number
  archived: boolean
  onCreate: () => void
  onReschedule: Reschedule
}) {
  const sessions = useAllSessions(classId)
  const items = sessions.data ?? []
  const [changingLab, setChangingLab] = useState<LabSession | null>(null)
  const now = useNow(15_000)
  const view = useTableView(items, {
    pageSize: HISTORY_PAGE_SIZE,
    searchText: (s) => s.name,
    filters: { status: (s, v) => sessionState(s, now) === v },
  })

  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          Lab sessions
        </h2>
        <Button disabled={archived} onClick={onCreate}>
          <Plus aria-hidden className="size-4" />
          New session
        </Button>
      </div>

      {items.length > 0 && (
        <TableToolbar
          what="lab sessions"
          placeholder="Session name"
          search={view.search}
          onSearch={view.setSearch}
          onFilter={view.setFilter}
          active={view.active}
          onClear={view.clear}
          shown={view.matches.length}
          total={items.length}
          filters={[
            {
              id: 'status',
              label: 'Status',
              value: view.filterValues.status ?? '',
              allLabel: 'Any status',
              options: [
                { value: 'open', label: 'Open now' },
                { value: 'closed', label: 'Closed' },
                { value: 'planned', label: 'Not opened yet' },
              ],
            },
          ]}
        />
      )}

      {sessions.isPending ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading sessions">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : sessions.isError && !sessions.data ? (
        <EmptyState
          title="Sessions could not be loaded"
          action={<Button onClick={() => void sessions.refetch()}>Try again</Button>}
        >
          {errorMessage(sessions.error)}
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState title="No sessions yet">
          A session is one lab meeting of the class, e.g. &ldquo;Week 3&rdquo;. Create one, then
          open access when class starts.
        </EmptyState>
      ) : view.matches.length === 0 ? (
        <NoMatches what="lab sessions" onClear={view.clear} />
      ) : (
        <div>
          <Table caption="Lab session history">
            <thead>
              <tr>
                <Th>Session</Th>
                <Th>Planned</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((s) => (
                <SessionRow
                  key={s.id}
                  classId={classId}
                  session={s}
                  archived={archived}
                  now={now}
                  onChangeLab={() => setChangingLab(s)}
                  onReschedule={onReschedule}
                />
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {view.matches.length > 0 && (
        <Pagination
          page={view.page}
          size={HISTORY_PAGE_SIZE}
          total={view.matches.length}
          onPageChange={view.setPage}
        />
      )}
      <ChangeLabDialog
        classId={classId}
        session={changingLab}
        onClose={() => setChangingLab(null)}
      />
    </section>
  )
}

function SessionRow({
  classId,
  session: s,
  archived,
  now,
  onChangeLab,
  onReschedule,
}: {
  classId: number
  session: LabSession
  archived: boolean
  now: number
  onChangeLab: () => void
  onReschedule: Reschedule
}) {
  const setOpen = useSetSessionOpen(classId)
  const running = isRunning(s, now)
  const ended = hasEnded(s, now)
  const labs = useLabs()
  const lab = labs.data?.find((l) => l.id === s.lab_id)
  return (
    <tr>
      <Td>
        <p className="font-medium">{s.name}</p>
        {lab ? (
          <p className="text-xs text-ink-muted">{lab.name}</p>
        ) : (
          // Only an ended session whose lab was deleted later has none.
          s.lab_id === null && <p className="text-xs text-ink-muted">No lab</p>
        )}
      </Td>
      <Td className="text-ink-muted">
        <p>{formatDateTime(s.starts_at)}</p>
        <p>to {formatDateTime(s.ends_at)}</p>
      </Td>
      <Td>
        {running ? (
          <div className="flex flex-col items-start gap-1">
            <Badge tone="open">Open now</Badge>
            <SessionClock session={s} className="text-xs text-ink-muted" />
          </div>
        ) : s.opened_at ? (
          <div>
            <Badge tone="pending">Closed</Badge>
            <p className="mt-1 text-xs text-ink-muted">
              {s.is_open || !s.closed_at
                ? `Ended ${formatDateTime(s.ends_at)}`
                : formatDateTime(s.closed_at)}
            </p>
          </div>
        ) : ended ? (
          <div>
            <Badge tone="pending">Not opened</Badge>
            <p className="mt-1 text-xs text-ink-muted">Its end time has passed</p>
          </div>
        ) : (
          <Badge tone="pending">Not opened yet</Badge>
        )}
      </Td>
      <Td>
        <div className="flex justify-end gap-1.5">
          <Link
            to={`/classes/${s.class_id}/sessions/${s.id}/monitor`}
            // Only an open session is watched live; a closed one is just looked at.
            aria-label={`${running ? 'Monitor' : 'View'} ${s.name}`}
            className={buttonClass('secondary', 'sm')}
          >
            {running ? 'Monitor' : 'View'}
          </Link>
          <Button
            size="sm"
            aria-label={`Change the times of ${s.name}`}
            title="Session name and times"
            onClick={() => onReschedule(s)}
          >
            <CalendarClock aria-hidden className="size-3.5" />
            Times
          </Button>
          <Button
            size="sm"
            aria-label={`Change the lab of ${s.name}`}
            title="Move the session to another lab"
            onClick={onChangeLab}
          >
            <LayoutGrid aria-hidden className="size-3.5" />
            Lab
          </Button>
          {running ? (
            <Button
              size="sm"
              aria-label={`Close ${s.name}`}
              loading={setOpen.isPending}
              onClick={() => setOpen.mutate({ id: s.id, open: false })}
            >
              Close
            </Button>
          ) : (
            <Button
              size="sm"
              aria-label={`Open ${s.name}`}
              disabled={archived || ended || tooEarly(s, now)}
              title={
                ended
                  ? 'Its end time has passed: change the times to open it again'
                  : tooEarly(s, now)
                    ? tooEarlyText(s)
                    : undefined
              }
              loading={setOpen.isPending}
              onClick={() =>
                setOpen.mutate({ id: s.id, open: true }, { onError: openFailed(s, onReschedule) })
              }
            >
              Open
            </Button>
          )}
        </div>
      </Td>
    </tr>
  )
}
