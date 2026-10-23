import { create } from 'zustand'
import type { RunNotice, RunPhase } from './runStore'
import type { TestCaseResult, TestTotals } from './testResults'

/** One case's verdict as it arrives live (before the full result is fetched). */
export interface LiveCase {
  passed: boolean
  status: string
}

export interface TestState {
  /** Same steps as a run: idle -> saving -> queued -> running -> finished. */
  phase: RunPhase
  activityId: number | null
  executionId: number | null
  queuePosition: number | null
  runningSince: number | null
  /** case id -> verdict, filled while the job runs. */
  live: Record<number, LiveCase>
  results: TestCaseResult[] | null
  totals: TestTotals | null
  /** The job's own status: "ok", or e.g. "system_error" when the server could not run the tests. */
  jobStatus: string | null
  notice: RunNotice | null
  blockedUntil: number | null
}

export const initialTestState: TestState = {
  phase: 'idle',
  activityId: null,
  executionId: null,
  queuePosition: null,
  runningSince: null,
  live: {},
  results: null,
  totals: null,
  jobStatus: null,
  notice: null,
  blockedUntil: null,
}

export const useTestStore = create<TestState>(() => initialTestState)
