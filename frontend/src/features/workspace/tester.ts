import type { ExecutionOut, RunResponse } from '@/api/types'
import { isBusy } from './runStore'
import type { SaveOutcome } from './saver'
import { describeStartFailure } from './startFailure'
import { initialTestState, useTestStore } from './testStore'
import { parseTestResults, totalsOf, type TestTotals } from './testResults'
import type { WatchHandlers } from './watchExecution'

export interface TesterDeps {
  /** Saves every file with unsaved changes. */
  saveAll: () => Promise<SaveOutcome>
  start: (activityId: number, entryPath: string) => Promise<RunResponse>
  /** Follows the job (see watchExecution). */
  watch: (executionId: number, handlers: WatchHandlers) => { close: () => void }
  /** The server said the laboratory is closed. */
  onLabClosed?: () => void
  /** A test finished with a verdict for every case. */
  onTested?: (activityId: number, totals: TestTotals, finishedAt: string | null) => void
  now?: () => number
}

export interface Tester {
  test: (activityId: number, entryPath: string) => Promise<void>
  dispose: () => void
}

const saveProblem = (outcome: SaveOutcome): string =>
  outcome === 'locked'
    ? 'Laboratory access is closed, so your files could not be saved and nothing was tested.'
    : outcome === 'conflict'
      ? 'A file was changed somewhere else. Choose which version to keep, then test again.'
      : 'Your files could not be saved, so nothing was tested.'

/**
 * The Test button: save every file, queue the job, then follow it. Cases tick over as the server
 * reports them, and the stored result (names, outputs for the visible cases) replaces them at the end.
 */
export function createTester(deps: TesterDeps): Tester {
  const now = deps.now ?? Date.now
  const set = useTestStore.setState
  const get = useTestStore.getState

  /** Bumped by every new test; events of an older one check it and do nothing. */
  let current = 0
  let watching: { close: () => void } | null = null

  function stopWatching() {
    watching?.close()
    watching = null
  }

  function finished(activityId: number, ex: ExecutionOut) {
    stopWatching()
    const results = parseTestResults(ex.test_results)
    // "system_error": the container itself failed, so there is nothing to show but a retry.
    if (results.length === 0) {
      set({
        phase: 'idle',
        runningSince: null,
        notice: {
          tone: 'error',
          text:
            ex.status === 'system_error'
              ? 'Server problem, try again.'
              : 'The tests did not produce a result. Please try again.',
        },
      })
      return
    }
    const totals = ex.test_summary
      ? {
          passed: ex.test_summary.passed,
          total: ex.test_summary.total,
          score: ex.test_summary.score,
          maxScore: ex.test_summary.max_score,
        }
      : totalsOf(results)
    set({ phase: 'finished', runningSince: null, results, totals, jobStatus: ex.status })
    deps.onTested?.(activityId, totals, ex.finished_at)
  }

  async function test(activityId: number, entryPath: string): Promise<void> {
    const state = get()
    if (isBusy(state.phase)) return
    if (state.blockedUntil !== null && state.blockedUntil > now()) return

    const mine = ++current
    stopWatching()
    set({ ...initialTestState, phase: 'saving', activityId })

    const saved = await deps.saveAll()
    if (mine !== current) return
    if (saved !== 'saved') {
      if (saved === 'locked') deps.onLabClosed?.()
      set({ ...initialTestState, activityId, notice: { tone: 'warn', text: saveProblem(saved) } })
      return
    }

    let accepted: RunResponse
    try {
      accepted = await deps.start(activityId, entryPath)
    } catch (err) {
      if (mine !== current) return
      const failure = describeStartFailure(err, now(), {
        stillGoing: 'Your last run or test is still going.',
        tooFast: 'You are testing too fast.',
        couldNot: 'The tests could not be started.',
      })
      if (failure.labClosed) deps.onLabClosed?.()
      set({
        ...initialTestState,
        activityId,
        notice: failure.notice,
        blockedUntil: failure.blockedUntil,
      })
      return
    }
    if (mine !== current) return

    set({
      phase: 'queued',
      executionId: accepted.execution_id,
      queuePosition: accepted.queue_position,
    })
    const markRunning = () => {
      const { phase } = get()
      if (phase === 'queued' || phase === 'saving') set({ phase: 'running', runningSince: now() })
    }
    watching = deps.watch(accepted.execution_id, {
      onStatus: (status) => {
        if (mine === current && status === 'running') markRunning()
      },
      onCase: (event) => {
        if (mine !== current) return
        markRunning()
        set((s) => ({
          live: { ...s.live, [event.caseId]: { passed: event.passed, status: event.status } },
        }))
      },
      onFinished: (ex) => {
        if (mine === current) finished(activityId, ex)
      },
      onGiveUp: () => {
        if (mine !== current) return
        stopWatching()
        set({
          phase: 'idle',
          runningSince: null,
          notice: { tone: 'error', text: 'The result did not arrive. Please test again.' },
        })
      },
    })
  }

  return {
    test,
    dispose: () => {
      current++
      stopWatching()
    },
  }
}
