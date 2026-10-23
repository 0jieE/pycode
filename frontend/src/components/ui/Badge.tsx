import type { ReactNode } from 'react'

/** One tone per meaning, used identically on every screen. */
export type Tone = 'ok' | 'error' | 'warn' | 'pending' | 'open'

const TONES: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  error: 'bg-error-soft text-error',
  warn: 'bg-warn-soft text-warn',
  pending: 'bg-pending-soft text-pending',
  open: 'bg-open-soft text-open',
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}
