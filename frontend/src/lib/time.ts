/** The API sends UTC ISO strings ending in Z. Everything the user sees is in Manila time. */
const TIME_ZONE = 'Asia/Manila'

const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
})

const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, dateStyle: 'medium' })

/** "Oct 8, 2026, 8:30 AM". Display only: never parse and re-send API timestamps. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormat.format(date)
}

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** "10:42", for events of today. */
export function formatClock(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : clockFormat.format(date)
}

const timeOfDayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  timeStyle: 'short',
})

/** "11:00 AM", for a time later today (when a lab session ends). */
export function formatTimeOfDay(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : timeOfDayFormat.format(date)
}

/** The same calendar day as `now`, in Manila. */
export function isToday(iso: string, now: number = Date.now()): boolean {
  const day = (t: number | string) =>
    new Date(t).toLocaleDateString('en-US', { timeZone: TIME_ZONE })
  return day(iso) === day(now)
}

/** A countdown: "9:05" under an hour, "1:02:05" above. Never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date)
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

/*
 * <input type="datetime-local"> values ("2026-10-08T08:30") carry no time zone. They are always read
 * as Manila time, the same zone everything is displayed in, so the pickers agree with the screen
 * even when a lab PC's own clock is set to another zone. Manila has no daylight saving: UTC+8.
 */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000

/** "2026-10-08T08:30" (Manila) -> "2026-10-08T00:30:00.000Z". Returns null for an empty/invalid value. */
export function manilaInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const date = new Date(`${value}:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** A UTC instant -> the "YYYY-MM-DDTHH:mm" text a datetime-local input wants (Manila time). */
export function isoToManilaInput(iso: string | Date): string {
  const ms = (typeof iso === 'string' ? new Date(iso) : iso).getTime()
  if (Number.isNaN(ms)) return ''
  return new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 16)
}

/** Now plus `minutes`, as a datetime-local value in Manila time (seconds dropped). */
export function manilaInputFromNow(minutes = 0, now: number = Date.now()): string {
  return isoToManilaInput(new Date(now + minutes * 60_000))
}
