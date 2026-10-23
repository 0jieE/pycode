import { AlertTriangle, Loader2 } from 'lucide-react'
import { useNow } from '@/lib/useNow'
import type { TestState } from './testStore'

const TONE_CLASS = { warn: 'text-warn', error: 'text-error' } as const

/** The one line under the buttons while a Test is going, or why it did not start. */
export function TestStatusLine({ test }: { test: TestState }) {
  const counting = test.phase === 'running' || test.blockedUntil !== null
  const now = useNow(counting ? 250 : 60_000)

  if (test.phase === 'saving') {
    return (
      <p className="flex items-center gap-1.5 text-ink-muted">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Saving your files…
      </p>
    )
  }
  if (test.phase === 'queued') {
    return (
      <p className="flex items-center gap-1.5 text-open">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Queued — #{test.queuePosition ?? '?'}
      </p>
    )
  }
  if (test.phase === 'running') {
    const seconds = Math.max(0, Math.floor((now - (test.runningSince ?? now)) / 1000))
    return (
      <p className="flex items-center gap-1.5 text-open">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Testing… {seconds} s
      </p>
    )
  }
  if (test.notice) {
    const wait =
      test.blockedUntil !== null && test.blockedUntil > now
        ? Math.ceil((test.blockedUntil - now) / 1000)
        : 0
    return (
      <p className={`flex items-start gap-1.5 ${TONE_CLASS[test.notice.tone]}`}>
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {test.notice.text}
          {wait > 0 && ` You can try again in ${wait} s.`}
        </span>
      </p>
    )
  }
  return null
}
