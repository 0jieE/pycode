import type { LabBooking } from '@/api/types'

/**
 * A lab's bookings arranged by day, with the vacant time between them, in school time (Asia/Manila). Times inside a
 * day are minutes since midnight.
 */

const TIME_ZONE = 'Asia/Manila'
const DAY_MS = 24 * 60 * 60_000

/** The hours a lab is normally used: free time is looked for between these. */
export const SCHOOL_DAY = { from: 7 * 60, to: 21 * 60 }
/** Gaps shorter than this are not worth listing as free. */
const MIN_FREE_MINUTES = 15

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const clockParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** "2026-10-19": the school-time calendar day of an instant. */
export const dayKey = (t: string | number): string => dayKeyFormat.format(new Date(t))

/** Minutes since midnight, school time. */
export function minuteOfDay(t: string | number): number {
  const parts = clockParts.formatToParts(new Date(t))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return (get('hour') % 24) * 60 + get('minute')
}

/** "8:00 AM", "12:30 PM", "9:00 PM" (24:00 reads "12:00 AM"). */
export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60) % 24
  const min = String(m % 60).padStart(2, '0')
  return `${h % 12 === 0 ? 12 : h % 12}:${min} ${h < 12 ? 'AM' : 'PM'}`
}

/** "45 min", "2 h", "1 h 30 min". */
export function formatSpan(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Free time still ahead: on the current day, what has already passed is not vacant any more. */
export function freeAfter(
  free: readonly { start: number; end: number }[],
  fromMinute: number,
): { start: number; end: number }[] {
  return free
    .map((g) => ({ start: Math.max(g.start, Math.ceil(fromMinute / 5) * 5), end: g.end }))
    .filter((g) => g.end - g.start >= MIN_FREE_MINUTES)
}

/** "Today", "Tomorrow", or "Monday, Oct 19". */
export function dayLabel(key: string, now: number): string {
  if (key === dayKey(now)) return 'Today'
  if (key === dayKey(now + DAY_MS)) return 'Tomorrow'
  return new Date(`${key}T12:00:00+08:00`).toLocaleDateString('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

/** A booking's part of one day. A session past midnight shows on both days. */
export interface DaySlot {
  booking: LabBooking
  start: number
  end: number
  /** It began the day before / goes on into the next day. */
  fromBefore: boolean
  intoNext: boolean
}

export interface ScheduleDay {
  key: string
  slots: DaySlot[]
  /** Vacant stretches within school hours, at least 15 minutes long. */
  free: { start: number; end: number }[]
}

function freeTime(slots: readonly DaySlot[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let cursor = SCHOOL_DAY.from
  for (const s of [...slots].sort((a, b) => a.start - b.start)) {
    if (s.start - cursor >= MIN_FREE_MINUTES)
      out.push({ start: cursor, end: Math.min(s.start, SCHOOL_DAY.to) })
    cursor = Math.max(cursor, s.end)
    if (cursor >= SCHOOL_DAY.to) break
  }
  if (SCHOOL_DAY.to - cursor >= MIN_FREE_MINUTES) out.push({ start: cursor, end: SCHOOL_DAY.to })
  return out.filter((g) => g.end - g.start >= MIN_FREE_MINUTES)
}

/** The bookings by day (earliest first), each day's slots in order and its free time. */
export function scheduleByDay(bookings: readonly LabBooking[]): ScheduleDay[] {
  const days = new Map<string, DaySlot[]>()
  for (const b of bookings) {
    const startKey = dayKey(b.starts_at)
    const endKey = dayKey(b.ends_at)
    // Walk the days it covers (almost always one; never more than a few).
    let t = new Date(`${startKey}T12:00:00+08:00`).getTime()
    for (let guard = 0; guard < 7; guard++, t += DAY_MS) {
      const key = dayKey(t)
      const first = key === startKey
      const last = key === endKey
      const slot: DaySlot = {
        booking: b,
        start: first ? minuteOfDay(b.starts_at) : 0,
        end: last ? minuteOfDay(b.ends_at) || 24 * 60 : 24 * 60,
        fromBefore: !first,
        intoNext: !last,
      }
      // An end exactly at midnight belongs to the day before only.
      if (!(slot.start === 0 && slot.end === 0)) {
        days.set(key, [...(days.get(key) ?? []), slot])
      }
      if (last) break
    }
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, slots]) => {
      const ordered = slots.sort((a, b) => a.start - b.start || a.end - b.end)
      return { key, slots: ordered, free: freeTime(ordered) }
    })
}
