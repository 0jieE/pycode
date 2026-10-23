import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import type { ExecutionOut } from '@/api/types'
import type { SaveOutcome } from './saver'
import { createTester, type TesterDeps } from './tester'
import { initialTestState, useTestStore } from './testStore'
import type { WatchHandlers } from './watchExecution'

const NOW = new Date('2026-10-10T00:00:00Z').getTime()

const resultRow = (id: number, passed: boolean, hidden = false) => ({
  case_id: id,
  name: `case ${id}`,
  is_hidden: hidden,
  passed,
  points: 2,
  points_awarded: passed ? 2 : 0,
  status: 'ok',
  duration_ms: 5,
  actual_output: hidden ? null : 'out',
})

const execution = (patch: Partial<ExecutionOut>): ExecutionOut => ({
  id: 9,
  class_id: 1,
  practice: false,
  kind: 'test',
  mode: 'batch',
  activity_id: 3,
  entry_path: 'Lab 1/main.py',
  status: 'ok',
  exit_code: 0,
  output: null,
  duration_ms: 10,
  queued_at: null,
  started_at: null,
  finished_at: null,
  ...patch,
})

function setup(overrides: Partial<TesterDeps> = {}) {
  let handlers: WatchHandlers | null = null
  const deps: TesterDeps = {
    saveAll: vi.fn(async (): Promise<SaveOutcome> => 'saved'),
    start: vi.fn(async () => ({ execution_id: 9, queue_position: 2 })),
    watch: vi.fn((_id, h) => {
      handlers = h
      return { close: vi.fn() }
    }),
    onLabClosed: vi.fn(),
    onTested: vi.fn(),
    now: () => NOW,
    ...overrides,
  }
  return {
    tester: createTester(deps),
    deps,
    handlers: () => handlers!,
  }
}

beforeEach(() => useTestStore.setState(initialTestState))

describe('createTester', () => {
  it('saves, queues, ticks cases over live, then shows the stored result', async () => {
    const { tester, deps, handlers } = setup()
    await tester.test(3, 'Lab 1/main.py')

    expect(deps.saveAll).toHaveBeenCalled()
    expect(deps.start).toHaveBeenCalledWith(3, 'Lab 1/main.py')
    expect(useTestStore.getState()).toMatchObject({
      phase: 'queued',
      queuePosition: 2,
      executionId: 9,
    })

    handlers().onStatus?.('running')
    expect(useTestStore.getState().phase).toBe('running')

    handlers().onCase?.({ caseId: 1, passed: true, status: 'ok' })
    expect(useTestStore.getState().live[1]).toEqual({ passed: true, status: 'ok' })

    handlers().onFinished(
      execution({
        test_results: [resultRow(1, true), resultRow(2, false, true)],
        test_summary: { passed: 1, total: 2, score: 2, max_score: 4 },
      }),
    )
    const state = useTestStore.getState()
    expect(state.phase).toBe('finished')
    expect(state.totals).toEqual({ passed: 1, total: 2, score: 2, maxScore: 4 })
    expect(state.results?.map((r) => r.passed)).toEqual([true, false])
    expect(state.results?.[1]?.actualOutput).toBeNull() // a hidden case's output never reaches the screen
    expect(deps.onTested).toHaveBeenCalledWith(
      3,
      { passed: 1, total: 2, score: 2, maxScore: 4 },
      null,
    )
  })

  it('works out the totals itself when the server sends no summary', async () => {
    const { tester, handlers } = setup()
    await tester.test(3, 'Lab 1/main.py')
    handlers().onFinished(execution({ test_results: [resultRow(1, true), resultRow(2, true)] }))
    expect(useTestStore.getState().totals).toEqual({ passed: 2, total: 2, score: 4, maxScore: 4 })
  })

  it('stops before queueing when the files could not be saved', async () => {
    const { tester, deps } = setup({ saveAll: vi.fn(async (): Promise<SaveOutcome> => 'locked') })
    await tester.test(3, 'Lab 1/main.py')
    expect(deps.start).not.toHaveBeenCalled()
    expect(deps.onLabClosed).toHaveBeenCalled()
    expect(useTestStore.getState()).toMatchObject({ phase: 'idle' })
    expect(useTestStore.getState().notice?.text).toMatch(/nothing was tested/)
  })

  it('pauses the button after a 429 and says so', async () => {
    const { tester } = setup({
      start: vi.fn(async () => {
        throw new ApiError(429, 'RUN_IN_PROGRESS', 'wait')
      }),
    })
    await tester.test(3, 'Lab 1/main.py')
    const state = useTestStore.getState()
    expect(state.phase).toBe('idle')
    expect(state.notice).toEqual({ tone: 'warn', text: 'Your last run or test is still going.' })
    expect(state.blockedUntil).toBe(NOW + 3000)
  })

  it('tells the student when the laboratory is closed', async () => {
    const { tester, deps } = setup({
      start: vi.fn(async () => {
        throw new ApiError(403, 'LAB_CLOSED', 'closed')
      }),
    })
    await tester.test(3, 'Lab 1/main.py')
    expect(deps.onLabClosed).toHaveBeenCalled()
    expect(useTestStore.getState().notice?.text).toBe('Laboratory access is closed.')
  })

  it('shows a retry message when the server could not run the tests', async () => {
    const { tester, handlers, deps } = setup()
    await tester.test(3, 'Lab 1/main.py')
    handlers().onFinished(execution({ status: 'system_error', test_results: null }))
    expect(useTestStore.getState().phase).toBe('idle')
    expect(useTestStore.getState().notice?.text).toBe('Server problem, try again.')
    expect(deps.onTested).not.toHaveBeenCalled()
  })

  it('ignores a second press while a test is going', async () => {
    const { tester, deps } = setup()
    await tester.test(3, 'Lab 1/main.py')
    await tester.test(3, 'Lab 1/main.py')
    expect(deps.start).toHaveBeenCalledTimes(1)
  })

  it('forgets an old test when a new one starts, and ignores its late events', async () => {
    const { tester, handlers } = setup()
    await tester.test(3, 'Lab 1/main.py')
    const old = handlers()
    old.onFinished(execution({ test_results: [resultRow(1, true)] }))
    expect(useTestStore.getState().phase).toBe('finished')

    await tester.test(4, 'Other/main.py')
    expect(useTestStore.getState()).toMatchObject({ phase: 'queued', activityId: 4, results: null })
    old.onCase?.({ caseId: 1, passed: true, status: 'ok' })
    expect(useTestStore.getState().live).toEqual({})
  })
})
