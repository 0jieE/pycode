/** How long the server waits for one answer before it ends the run (status `input_timeout`). */
export const INPUT_TIMEOUT_MS = 120_000

/** The longest line the server accepts for one input(). */
export const MAX_INPUT_CHARS = 1000

export type RunMode = 'interactive' | 'batch'

/**
 * The prompt: the last unfinished line of the output, i.e. what the program printed before it stopped to wait
 * ("Enter first number: "). Empty when the program called input() with no prompt.
 */
export function promptOf(output: string): string {
  return output.slice(output.lastIndexOf('\n') + 1)
}

/** 120000 -> "2:00", 105000 -> "1:45". Never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** A stretch of the output the student typed (the server echoes each typed line back as output). */
export interface EchoRange {
  start: number
  end: number
}

export interface EchoTracker {
  /** What is still to come of the line just sent: the typed text and its line break. */
  pending: string
  ranges: EchoRange[]
}

export const noEchoes: EchoTracker = { pending: '', ranges: [] }

/** A line was just sent: expect it back, right after the prompt. */
export const expectEcho = (tracker: EchoTracker, typed: string): EchoTracker => ({
  ...tracker,
  pending: `${typed}\n`,
})

/**
 * New output arrived (`chunk`), after `before` characters of earlier output. The part of it that is the line we
 * just sent is the echo: remember where it is so the terminal can colour it. A pipe has no terminal, so the
 * server prints the typed line itself; the page must not print it a second time.
 */
export function trackEcho(tracker: EchoTracker, before: number, chunk: string): EchoTracker {
  if (tracker.pending === '' || chunk === '') return tracker
  let used = 0
  while (
    used < chunk.length &&
    used < tracker.pending.length &&
    chunk[used] === tracker.pending[used]
  ) {
    used++
  }
  // Something else came first: this was not the echo, so there is nothing to colour.
  if (used === 0) return { ...tracker, pending: '' }

  const last = tracker.ranges[tracker.ranges.length - 1]
  const ranges =
    last && last.end === before
      ? [...tracker.ranges.slice(0, -1), { start: last.start, end: before + used }]
      : [...tracker.ranges, { start: before, end: before + used }]
  return { pending: tracker.pending.slice(used), ranges }
}

/** The output lost `removed` characters from its front (it is kept to a maximum size): move the ranges with it. */
export function shiftEchoes(ranges: readonly EchoRange[], removed: number): EchoRange[] {
  return ranges
    .map((r) => ({ start: r.start - removed, end: r.end - removed }))
    .filter((r) => r.end > 0)
    .map((r) => ({ start: Math.max(0, r.start), end: r.end }))
}

export interface Segment {
  text: string
  /** True for text the student typed. */
  typed: boolean
}

/** The output cut into plain pieces and typed pieces, in order. */
export function segmentOutput(text: string, ranges: readonly EchoRange[]): Segment[] {
  const out: Segment[] = []
  let at = 0
  for (const r of ranges) {
    const start = Math.min(Math.max(r.start, at), text.length)
    const end = Math.min(r.end, text.length)
    if (end <= start) continue
    if (start > at) out.push({ text: text.slice(at, start), typed: false })
    out.push({ text: text.slice(start, end), typed: true })
    at = end
  }
  if (at < text.length) out.push({ text: text.slice(at), typed: false })
  return out
}
