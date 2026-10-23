import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionOut } from '@/api/types'
import type { ServerMessage } from '@/api/ws'
import { watchExecution, type WatchDeps, type WatchHandlers } from './watchExecution'

const execution = (patch: Partial<ExecutionOut>): ExecutionOut => ({
  id: 7,
  class_id: 1,
  practice: false,
  kind: 'test',
  mode: 'batch',
  entry_path: 'a/main.py',
  status: 'ok',
  exit_code: 0,
  output: null,
  duration_ms: 10,
  queued_at: null,
  started_at: null,
  finished_at: null,
  ...patch,
})

function setup(fetchResults: (ExecutionOut | Error)[] = [execution({})]) {
  const socket = {
    onMessage: ((): void => undefined) as (m: ServerMessage) => void,
    onClose: () => {},
    closed: false,
  }
  const queue = [...fetchResults]
  const deps: WatchDeps = {
    connect: (_id, handlers) => {
      socket.onMessage = handlers.onMessage
      socket.onClose = handlers.onClose
      return {
        send: () => true,
        close: () => {
          socket.closed = true
        },
      }
    },
    fetchExecution: vi.fn(async () => {
      const next = queue.length > 1 ? queue.shift()! : queue[0]!
      if (next instanceof Error) throw next
      return next
    }),
  }
  const handlers = {
    onStatus: vi.fn(),
    onCase: vi.fn(),
    onFinished: vi.fn(),
    onGiveUp: vi.fn(),
  } satisfies WatchHandlers
  const watcher = watchExecution(7, handlers, deps)
  return { socket, deps, handlers, watcher }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('watchExecution', () => {
  it('passes live case results on, then fetches the stored result when the socket says done', async () => {
    const final = execution({ test_summary: { passed: 1, total: 2, score: 1, max_score: 2 } })
    const { socket, deps, handlers } = setup([final])

    socket.onMessage({ type: 'status', status: 'running' })
    socket.onMessage({ type: 'test_result', case_id: 4, passed: true, status: 'ok' })
    socket.onMessage({ type: 'test_result', case_id: 5, passed: false, status: 'timeout' })
    expect(handlers.onStatus).toHaveBeenCalledWith('running')
    expect(handlers.onCase).toHaveBeenNthCalledWith(1, { caseId: 4, passed: true, status: 'ok' })
    expect(handlers.onCase).toHaveBeenNthCalledWith(2, {
      caseId: 5,
      passed: false,
      status: 'timeout',
    })
    expect(handlers.onFinished).not.toHaveBeenCalled()

    socket.onMessage({ type: 'done', kind: 'test', status: 'ok' })
    await vi.advanceTimersByTimeAsync(1)
    expect(deps.fetchExecution).toHaveBeenCalledWith(7)
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
    expect(handlers.onFinished).toHaveBeenCalledWith(final)
    expect(socket.closed).toBe(true)
  })

  it('polls when the socket closes without a result, until the job is final', async () => {
    const { socket, deps, handlers } = setup([
      execution({ status: 'queued' }),
      execution({ status: 'running' }),
      execution({ status: 'ok' }),
    ])
    socket.onClose()
    await vi.advanceTimersByTimeAsync(1)
    expect(handlers.onFinished).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(deps.fetchExecution).toHaveBeenCalledTimes(3)
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
    expect(handlers.onStatus).toHaveBeenCalledWith('running')
  })

  it('keeps trying after a failed fetch', async () => {
    const { socket, handlers } = setup([new Error('network'), execution({ status: 'ok' })])
    socket.onClose()
    await vi.advanceTimersByTimeAsync(1)
    expect(handlers.onFinished).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(handlers.onFinished).toHaveBeenCalledTimes(1)
  })

  it('gives up when a job never finishes', async () => {
    const { socket, handlers } = setup([execution({ status: 'running' })])
    socket.onClose()
    await vi.advanceTimersByTimeAsync(3 * 60_000 + 2000)
    expect(handlers.onGiveUp).toHaveBeenCalledTimes(1)
    expect(handlers.onFinished).not.toHaveBeenCalled()
  })

  it('does nothing more after close()', async () => {
    const { socket, handlers, watcher } = setup()
    watcher.close()
    socket.onMessage({ type: 'test_result', case_id: 1, passed: true, status: 'ok' })
    socket.onMessage({ type: 'done' })
    socket.onClose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(handlers.onCase).not.toHaveBeenCalled()
    expect(handlers.onFinished).not.toHaveBeenCalled()
  })
})
