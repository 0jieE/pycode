import type { ExecutionStatus } from '@/api/types'

export type RunTone = 'ok' | 'error' | 'warn'

export interface RunResult {
  status: ExecutionStatus
  exitCode: number | null
  durationMs: number | null
}

/** Statuses that mean the run is over. */
export const FINAL_STATUSES: readonly ExecutionStatus[] = [
  'ok',
  'error',
  'timeout',
  'memory_exceeded',
  'output_limit',
  'system_error',
  'stopped',
  'input_timeout',
]

export const isFinal = (status: string): boolean =>
  (FINAL_STATUSES as readonly string[]).includes(status)

/** The one-line summary under the Run button, in plain English. */
export function describeResult(r: RunResult): { tone: RunTone; text: string } {
  switch (r.status) {
    case 'ok':
      return { tone: 'ok', text: `Finished in ${r.durationMs ?? 0} ms (exit ${r.exitCode ?? 0})` }
    case 'error':
      return {
        tone: 'error',
        text:
          r.exitCode === null
            ? 'The program stopped with an error.'
            : `Exited with code ${r.exitCode}`,
      }
    case 'timeout':
      return {
        tone: 'warn',
        text: 'Stopped: the program ran for more than 10 seconds. Look for a loop that never ends.',
      }
    case 'memory_exceeded':
      return {
        tone: 'warn',
        text: 'Stopped: the program used more memory than a run is allowed (128 MB).',
      }
    case 'output_limit':
      return {
        tone: 'warn',
        text: 'Stopped: the program printed too much (over 64 KB). Look for a loop that prints forever.',
      }
    case 'stopped':
      return { tone: 'warn', text: 'Stopped: you ended the program before it finished.' }
    case 'input_timeout':
      return {
        tone: 'warn',
        text: 'No input received in 2 minutes, so the program was stopped.',
      }
    case 'system_error':
      return { tone: 'error', text: 'Server problem, try again' }
    default:
      return { tone: 'warn', text: `The run ended with status "${r.status}".` }
  }
}
