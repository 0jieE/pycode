import { CalendarDays } from 'lucide-react'
import { useLabSchedule } from '@/api/queries/labs'
import { errorMessage } from '@/api/errors'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Spinner'
import {
  SCHOOL_DAY,
  dayKey,
  dayLabel,
  type DaySlot,
  formatMinutes,
  formatSpan,
  freeAfter,
  minuteOfDay,
  scheduleByDay,
  type ScheduleDay,
} from '@/lib/labSchedule'
import { useNow } from '@/lib/useNow'

const SPAN = SCHOOL_DAY.to - SCHOOL_DAY.from
/** Where a minute of the day sits on the timeline, in percent (clamped to school hours). */
const at = (m: number) =>
  ((Math.min(Math.max(m, SCHOOL_DAY.from), SCHOOL_DAY.to) - SCHOOL_DAY.from) / SPAN) * 100
const TICKS = [7, 9, 11, 13, 15, 17, 19, 21].map((h) => h * 60)

function slotTone(s: DaySlot): string {
  if (s.booking.is_open) return 'bg-open'
  if (s.booking.mine) return 'bg-brand-500'
  return 'bg-accent'
}

/** The day at a glance: school hours, booked blocks, the rest is free. */
function Timeline({ day, nowMinute }: { day: ScheduleDay; nowMinute: number | null }) {
  return (
    <div aria-hidden className="px-3 pt-1 pb-0.5">
      <div className="relative h-3 overflow-hidden rounded-full bg-ok-soft ring-1 ring-line">
        {nowMinute !== null && nowMinute > SCHOOL_DAY.from && (
          // What has passed today is not free any more.
          <div
            className="absolute inset-y-0 left-0 bg-surface-2"
            style={{ width: `${at(nowMinute)}%` }}
          />
        )}
        {day.slots.map((s) => (
          <div
            key={s.booking.session_id}
            title={`${formatMinutes(s.start)} – ${formatMinutes(s.end)} · ${s.booking.class.name}`}
            className={`absolute inset-y-0 rounded-sm ${slotTone(s)}`}
            style={{ left: `${at(s.start)}%`, width: `${Math.max(at(s.end) - at(s.start), 0.8)}%` }}
          />
        ))}
      </div>
      <div className="relative mt-0.5 h-3.5 text-[10px] leading-none text-ink-muted tabular-nums">
        {TICKS.map((m, i) => (
          <span
            key={m}
            className={`absolute ${i === 0 ? '' : i === TICKS.length - 1 ? '-translate-x-full' : '-translate-x-1/2'}`}
            style={{ left: `${at(m)}%` }}
          >
            {formatMinutes(m).replace(':00 ', '').toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  )
}

type Row =
  | { kind: 'slot'; at: number; slot: DaySlot }
  | { kind: 'free'; at: number; start: number; end: number }

function SlotRow({ slot }: { slot: DaySlot }) {
  const b = slot.booking
  return (
    <li className="flex items-start gap-3 px-3 py-2 text-sm">
      <span className={`mt-1 h-8 w-1 shrink-0 rounded-full ${slotTone(slot)}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink-strong tabular-nums">
          {slot.fromBefore ? '(from the day before)' : formatMinutes(slot.start)} –{' '}
          {slot.intoNext ? '(into the next day)' : formatMinutes(slot.end)}
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {formatSpan(slot.end - slot.start)}
          </span>
        </p>
        <p className="truncate text-xs text-ink-muted">
          {b.class.name} · {b.class.year_and_section} · {b.name} · {b.instructor.full_name}
        </p>
      </div>
      <span className="flex shrink-0 gap-1">
        {b.is_open && <Badge tone="open">Running</Badge>}
        {b.mine && <Badge tone="ok">Yours</Badge>}
      </span>
    </li>
  )
}

function FreeRow({ start, end }: { start: number; end: number }) {
  return (
    <li className="flex items-center gap-3 px-3 py-1.5 text-xs text-ok">
      <span className="h-4 w-1 shrink-0 rounded-full border border-dashed border-ok" aria-hidden />
      <span className="tabular-nums">
        <span className="font-semibold">Free</span> {formatMinutes(start)} – {formatMinutes(end)}
        <span className="ml-2 text-ink-muted">{formatSpan(end - start)}</span>
      </span>
    </li>
  )
}

function Day({ day, now }: { day: ScheduleDay; now: number }) {
  const today = day.key === dayKey(now)
  const nowMinute = today ? minuteOfDay(now) : null
  const free = nowMinute === null ? day.free : freeAfter(day.free, nowMinute)
  const rows: Row[] = [
    ...day.slots.map((slot) => ({ kind: 'slot' as const, at: slot.start, slot })),
    ...free.map((g) => ({ kind: 'free' as const, at: g.start, ...g })),
  ].sort((a, b) => a.at - b.at || (a.kind === 'free' ? -1 : 1))
  const label = dayLabel(day.key, now)
  return (
    <section aria-label={label} className="rounded-md border border-line bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-line bg-surface-2 px-3 py-1.5">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink-strong">
          <CalendarDays aria-hidden className="size-4 text-ink-muted" />
          {label}
          {today && (
            <span className="text-xs font-normal text-ink-muted">· {dayLabelLong(day.key)}</span>
          )}
        </h4>
        <span className="text-xs text-ink-muted">
          {day.slots.length} booked ·{' '}
          {free.length === 0 ? (
            <span className="text-warn">no free time</span>
          ) : (
            <span className="text-ok">
              {formatSpan(free.reduce((n, g) => n + g.end - g.start, 0))} free
            </span>
          )}
        </span>
      </header>
      <Timeline day={day} nowMinute={nowMinute} />
      <ul className="flex flex-col divide-y divide-line/60">
        {rows.map((r) =>
          r.kind === 'slot' ? (
            <SlotRow key={`s${r.slot.booking.session_id}`} slot={r.slot} />
          ) : (
            <FreeRow key={`f${r.start}`} start={r.start} end={r.end} />
          ),
        )}
      </ul>
    </section>
  )
}

/** "Wed, Oct 14" next to "Today", so the date is never a guess. */
function dayLabelLong(key: string): string {
  return new Date(`${key}T12:00:00+08:00`).toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Who has a lab booked, day by day: the sessions that use it and have not ended, of every instructor, with the
 * free time between them (7 AM – 9 PM). Shown on the lab's page and under the lab picker, so a clash is visible
 * and a vacant slot easy to find before saving.
 */
export function LabSchedule({
  labId,
  exceptSessionId,
  compact = false,
}: {
  labId: number
  /** The session being edited: not a clash with itself. */
  exceptSessionId?: number
  compact?: boolean
}) {
  const schedule = useLabSchedule(labId)
  const now = useNow(60_000)
  if (schedule.isPending) return <Skeleton className={compact ? 'h-10 w-full' : 'h-24 w-full'} />
  if (schedule.isError) {
    return <p className="text-sm text-error">{errorMessage(schedule.error)}</p>
  }
  const items = schedule.data.filter((b) => b.session_id !== exceptSessionId)
  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        {compact
          ? 'Nobody else has this lab booked: any time is free.'
          : 'No upcoming sessions in this lab: any time is free.'}
      </p>
    )
  }
  return (
    <section
      aria-label="Sessions booked in this lab"
      className={`flex flex-col gap-2 ${compact ? 'max-h-72 overflow-auto pr-1' : ''}`}
    >
      {scheduleByDay(items).map((day) => (
        <Day key={day.key} day={day} now={now} />
      ))}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
        <Legend className="bg-accent">Booked</Legend>
        <Legend className="bg-brand-500">Yours</Legend>
        <Legend className="bg-open">Running</Legend>
        <Legend className="bg-ok-soft ring-1 ring-line">Free</Legend>
        <span>Free time is counted from 7 AM to 9 PM.</span>
      </p>
    </section>
  )
}

function Legend({ className, children }: { className: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className={`size-2.5 rounded-sm ${className}`} />
      {children}
    </span>
  )
}
