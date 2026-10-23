import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useNow } from '@/lib/useNow'
import { formatCountdown, INPUT_TIMEOUT_MS } from './interactive'
import { describeResult } from './runStatus'
import type { RunState } from './runStore'

const TONE_CLASS = { ok: 'text-ok', error: 'text-error', warn: 'text-warn' } as const

/** The one line under the Run button: where the run is, how it ended, or why it did not start. */
export function RunStatusLine({ run }: { run: RunState }) {
  // Tick only while something on this line changes with time.
  const counting = run.phase === 'running' || run.blockedUntil !== null
  const waiting = run.phase === 'running' && run.waitingForInput && run.inputRequestedAt !== null
  const now = useNow(counting ? 250 : 60_000)

  if (run.phase === 'saving') {
    return (
      <p className="flex items-center gap-1.5 text-ink-muted">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Saving your files…
      </p>
    )
  }

  if (run.phase === 'queued') {
    return (
      <p className="flex items-center gap-1.5 text-open">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Queued — #{run.queuePosition ?? '?'}
      </p>
    )
  }

  if (run.stopping) {
    return (
      <p className="flex items-center gap-1.5 text-ink-muted">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Stopping…
      </p>
    )
  }

  if (waiting) {
    // The server ends the run if no line arrives within two minutes: show how long is left.
    const left = INPUT_TIMEOUT_MS - (now - (run.inputRequestedAt ?? now))
    return (
      <p className="flex items-center gap-1.5 text-open">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Waiting for input… {formatCountdown(left)}
      </p>
    )
  }

  if (run.phase === 'running') {
    const seconds = Math.max(0, Math.floor((now - (run.runningSince ?? now)) / 1000))
    return (
      <p className="flex items-center gap-1.5 text-open">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Running… {seconds} s
      </p>
    )
  }

  if (run.phase === 'finished' && run.result) {
    const { tone, text } = describeResult(run.result)
    const Icon = tone === 'ok' ? CheckCircle2 : tone === 'error' ? XCircle : AlertTriangle
    return (
      <p className={`flex items-start gap-1.5 font-medium ${TONE_CLASS[tone]}`}>
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        {text}
      </p>
    )
  }

  if (run.notice) {
    const wait =
      run.blockedUntil !== null && run.blockedUntil > now
        ? Math.ceil((run.blockedUntil - now) / 1000)
        : 0
    return (
      <p className={`flex items-start gap-1.5 ${TONE_CLASS[run.notice.tone]}`}>
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {run.notice.text}
          {wait > 0 && ` You can run again in ${wait} s.`}
        </span>
      </p>
    )
  }

  return null
}
