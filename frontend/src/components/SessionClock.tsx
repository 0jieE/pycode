import { Clock } from 'lucide-react'
import type { LabSession } from '@/api/types'
import { COUNTDOWN_FROM_MS, msLeft } from '@/lib/labSession'
import { formatCountdown, formatDateTime, formatTimeOfDay, isToday } from '@/lib/time'
import { useNow } from '@/lib/useNow'

/**
 * When the lab session ends: "Ends at 11:00 AM", then a countdown in its last 10 minutes ("Ends in 9:05"),
 * then "Ended". Ticks by itself, so the page around it does not re-render every second.
 */
export function SessionClock({
  session,
  className = '',
  plain = false,
}: {
  session: Pick<LabSession, 'ends_at'>
  className?: string
  /** No amber in the last minutes (on the coloured status bar, where the text stays white). */
  plain?: boolean
}) {
  const now = useNow(1000)
  const left = msLeft(session, now)
  const soon = left > 0 && left <= COUNTDOWN_FROM_MS
  return (
    <span
      // Screen readers get whole minutes, not seconds that change every tick.
      aria-label={
        left <= 0
          ? 'The lab session has ended'
          : soon
            ? `The lab session ends in ${Math.ceil(left / 60_000)} minutes`
            : `The lab session ends at ${formatTimeOfDay(session.ends_at)}`
      }
      title={`Scheduled end: ${formatTimeOfDay(session.ends_at)}`}
      className={`inline-flex items-center gap-1.5 tabular-nums ${soon ? 'font-semibold' : ''} ${soon && !plain ? 'text-warn' : ''} ${className}`}
    >
      <Clock aria-hidden className="size-3.5 shrink-0" />
      <span aria-hidden>
        {left <= 0
          ? 'Ended'
          : soon
            ? `Ends in ${formatCountdown(left)}`
            : isToday(session.ends_at, now)
              ? `Ends at ${formatTimeOfDay(session.ends_at)}`
              : `Ends ${formatDateTime(session.ends_at)}`}
      </span>
    </span>
  )
}
