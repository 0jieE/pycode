import { create } from 'zustand'
import type { EchoRange, RunMode } from './interactive'
import type { RunResult } from './runStatus'

/** idle -> saving -> queued -> running -> finished. A failure to start goes back to idle with a notice. */
export type RunPhase = 'idle' | 'saving' | 'queued' | 'running' | 'finished'

export interface RunNotice {
  tone: 'warn' | 'error'
  text: string
}

export interface RunState {
  phase: RunPhase
  executionId: number | null
  /** Place in the queue when the run was accepted (1 = next). */
  queuePosition: number | null
  /** When the run started executing (client clock), for the elapsed timer. */
  runningSince: number | null
  output: string
  result: RunResult | null
  /** Why nothing started (rate limit, busy server, lab closed, save problem...). */
  notice: RunNotice | null
  /** Run is switched off until this time (the short countdown after a 429 or 503). */
  blockedUntil: number | null
  /** How this run gets its input. */
  mode: RunMode | null
  /** Every line the student typed into an interactive run, in order. */
  inputs: string[]
  /** The program is stopped at an input() and waiting for a line. */
  waitingForInput: boolean
  /** When it started waiting (client clock): the 2 minute countdown runs from here. */
  inputRequestedAt: number | null
  /** Why the last line could not be sent (too long, limit reached...). */
  inputError: string | null
  /** Stop was pressed; the run is ending. */
  stopping: boolean
  /** The stretches of the output that are lines the student typed (echoed back by the server). */
  echoes: EchoRange[]
  /** The echo of the line just sent, still to come. */
  pendingEcho: string
}

export const initialRunState: RunState = {
  phase: 'idle',
  executionId: null,
  queuePosition: null,
  runningSince: null,
  output: '',
  result: null,
  notice: null,
  blockedUntil: null,
  mode: null,
  inputs: [],
  waitingForInput: false,
  inputRequestedAt: null,
  inputError: null,
  stopping: false,
  echoes: [],
  pendingEcho: '',
}

/** The terminal only shows ~64 KB, so memory keeps a bit more than that and no more. */
export const OUTPUT_KEEP_CHARS = 200_000

export const capOutput = (text: string): string =>
  text.length <= OUTPUT_KEEP_CHARS ? text : text.slice(text.length - OUTPUT_KEEP_CHARS)

export const useRunStore = create<RunState>(() => initialRunState)

export const isBusy = (phase: RunPhase): boolean =>
  phase === 'saving' || phase === 'queued' || phase === 'running'
