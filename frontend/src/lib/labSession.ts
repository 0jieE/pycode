import type { CloseReason } from '@/api/queries/sessions'
import type { LabSession } from '@/api/types'

/** In the last 10 minutes the end time turns into a countdown. */
export const COUNTDOWN_FROM_MS = 10 * 60_000

/** "Extend" adds this much (from the end time, or from now if it has already passed). */
export const EXTEND_BY_MS = 30 * 60_000

/** A session can be opened this long before it starts (to set up the room), not earlier. */
export const EARLY_OPEN_MS = 15 * 60_000

const endOf = (s: Pick<LabSession, 'ends_at'>): number => new Date(s.ends_at).getTime()

/** When the session may be opened at the earliest: a little before its start. */
export const opensFrom = (s: Pick<LabSession, 'starts_at'>): number =>
  new Date(s.starts_at).getTime() - EARLY_OPEN_MS

/** Too early to open it: its start is more than EARLY_OPEN_MS away. */
export const tooEarly = (s: Pick<LabSession, 'starts_at'>, now: number): boolean =>
  now < opensFrom(s)

/** Its scheduled end has passed: the server treats it as closed from that instant. */
export const hasEnded = (s: Pick<LabSession, 'ends_at'>, now: number): boolean => endOf(s) <= now

/**
 * The lab is really running: open, and before its end. `is_open` alone can say true for up to 15 seconds after
 * the end, until the server's sweep closes it.
 */
export const isRunning = (s: Pick<LabSession, 'is_open' | 'ends_at'>, now: number): boolean =>
  s.is_open && !hasEnded(s, now)

export const msLeft = (s: Pick<LabSession, 'ends_at'>, now: number): number => endOf(s) - now

/** The later end time "Extend" sends: 30 minutes after the end, or after now if the end has passed. */
export function extendedEnd(s: Pick<LabSession, 'ends_at'>, now: number): string {
  return new Date(Math.max(endOf(s), now) + EXTEND_BY_MS).toISOString()
}

/** How often a page showing this session needs the time: every second near the end, else now and then. */
export const tickFor = (s: Pick<LabSession, 'ends_at'> | null | undefined, now: number): number =>
  s && msLeft(s, now) <= COUNTDOWN_FROM_MS + 60_000 ? 1000 : 15_000

/** The read-only banner's reason. */
export function closeReasonText(reason: CloseReason): string {
  switch (reason) {
    case 'scheduled_end':
      return 'The lab session has ended.'
    case 'before_start':
      return 'The lab session has not started yet: it opens by itself at its start time.'
    case 'manual':
      return 'Your instructor closed the lab.'
  }
}
