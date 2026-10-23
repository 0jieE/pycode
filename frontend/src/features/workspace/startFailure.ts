import { ApiError } from '@/api/errors'
import type { RunNotice } from './runStore'

const RATE_LIMIT_PAUSE_MS = 3000
const BUSY_PAUSE_MS = 5000

export interface StartFailure {
  notice: RunNotice
  /** The button stays off until this time (the short countdown after a 429 or 503), or null. */
  blockedUntil: number | null
  /** The server said the laboratory is closed: the whole workspace becomes read-only. */
  labClosed: boolean
}

/** What to tell the student when a Run or a Test could not even be queued. */
export function describeStartFailure(
  err: unknown,
  now: number,
  words: { stillGoing: string; tooFast: string; couldNot: string },
): StartFailure {
  if (err instanceof ApiError && err.status === 429) {
    return {
      notice: {
        tone: 'warn',
        text: err.code === 'RUN_IN_PROGRESS' ? words.stillGoing : words.tooFast,
      },
      blockedUntil: now + RATE_LIMIT_PAUSE_MS,
      labClosed: false,
    }
  }
  if (err instanceof ApiError && err.status === 503) {
    return {
      notice: { tone: 'warn', text: 'The server is busy right now.' },
      blockedUntil: now + BUSY_PAUSE_MS,
      labClosed: false,
    }
  }
  if (err instanceof ApiError && err.code === 'LAB_CLOSED') {
    return {
      notice: { tone: 'warn', text: 'Laboratory access is closed.' },
      blockedUntil: null,
      labClosed: true,
    }
  }
  if (err instanceof ApiError && err.status === 401) {
    return {
      notice: { tone: 'error', text: 'You were signed out.' },
      blockedUntil: null,
      labClosed: false,
    }
  }
  return {
    notice: { tone: 'error', text: err instanceof ApiError ? err.detail : words.couldNot },
    blockedUntil: null,
    labClosed: false,
  }
}
