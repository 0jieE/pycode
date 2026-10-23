import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import type { ExecutionOut } from '@/api/types'
import type { ServerMessage } from '@/api/ws'
import { createRunner, type RunnerDeps } from './runner'
import { initialRunState, OUTPUT_KEEP_CHARS, useRunStore } from './runStore'
import type { SaveOutcome } from './saver'

const state = () => useRunStore.getState()

/** A run socket the test controls. */
function fakeSocketFactory() {
  const sockets: {
    id: number
    send: (m: ServerMessage) => void
    drop: () => void
    closed: boolean
    /** What the page sent to the server over this socket. */
    sent: unknown[]
  }[] = []
  const connect: RunnerDeps['connect'] = (id, handlers) => {
    const s = {
      id,
      closed: false,
      sent: [] as unknown[],
      send: (m: ServerMessage) => handlers.onMessage(m),
      drop: () => handlers.onClose(),
    }
    sockets.push(s)
    return {
      send: (message: unknown) => {
        s.sent.push(message)
        return true
      },
      close: () => {
        s.closed = true
      },
    }
  }
  return { connect, sockets, last: () => sockets[sockets.length - 1]! }
}

function setup(overrides: Partial<RunnerDeps> = {}) {
  const sock = fakeSocketFactory()
  const order: string[] = []
  const deps: RunnerDeps = {
    saveAll: vi.fn(async (): Promise<SaveOutcome> => {
      order.push('save')
      return 'saved'
    }),
    start: vi.fn(async () => {
      order.push('start')
      return { execution_id: 41, queue_position: 3 }
    }),
    fetchExecution: vi.fn(),
    connect: sock.connect,
    onLabClosed: vi.fn(),
    ...overrides,
  }
  return { runner: createRunner(deps), deps, sock, order }
}

const execution = (patch: Partial<ExecutionOut>): ExecutionOut => ({
  id: 41,
  class_id: 1,
  practice: false,
  kind: 'run',
  mode: 'batch',
  entry_path: 'a/main.py',
  status: 'running',
  exit_code: null,
  output: null,
  duration_ms: null,
  queued_at: null,
  started_at: null,
  finished_at: null,
  ...patch,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
  useRunStore.setState(initialRunState)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a normal run', () => {
  it('saves first, queues, streams output and finishes', async () => {
    const { runner, sock, order, deps } = setup()
    await runner.run('a/main.py', '5\n6\n')

    expect(order).toEqual(['save', 'start'])
    expect(deps.start).toHaveBeenCalledWith('a/main.py', '5\n6\n', 'batch')
    expect(state()).toMatchObject({ phase: 'queued', executionId: 41, queuePosition: 3 })

    sock.last().send({ type: 'status', status: 'running' })
    expect(state().phase).toBe('running')
    expect(state().runningSince).toBe(Date.now())

    sock.last().send({ type: 'output', data: 'hello ' })
    sock.last().send({ type: 'output', data: 'world\n' })
    expect(state().output).toBe('hello world\n')

    sock.last().send({ type: 'done', status: 'ok', exit_code: 0, duration_ms: 1500 })
    expect(state()).toMatchObject({
      phase: 'finished',
      output: 'hello world\n',
      result: { status: 'ok', exitCode: 0, durationMs: 1500 },
    })
    expect(sock.last().closed).toBe(true)
  })

  it('treats the first output as the start of running even if no status message came', async () => {
    const { runner, sock } = setup()
    await runner.run('main.py', '')
    sock.last().send({ type: 'output', data: 'x' })
    expect(state().phase).toBe('running')
  })

  it('uses the complete output from `done` instead of what was streamed', async () => {
    const { runner, sock } = setup()
    await runner.run('main.py', '')
    sock.last().send({ type: 'output', data: 'partial, maybe with gaps' })
    sock.last().send({
      type: 'done',
      status: 'error',
      exit_code: 1,
      duration_ms: 9,
      output: 'the full text from the database\n',
    })
    expect(state().output).toBe('the full text from the database\n')
    expect(state().result).toMatchObject({ status: 'error', exitCode: 1 })
  })

  it('keeps only the newest part of runaway output in memory', async () => {
    const { runner, sock } = setup()
    await runner.run('main.py', '')
    sock.last().send({ type: 'output', data: 'a'.repeat(OUTPUT_KEEP_CHARS) })
    sock.last().send({ type: 'output', data: 'END' })
    expect(state().output.length).toBe(OUTPUT_KEEP_CHARS)
    expect(state().output.endsWith('END')).toBe(true)
  })

  it('cannot be started again while it is saving, queued or running', async () => {
    const { runner, deps } = setup()
    await runner.run('main.py', '')
    await runner.run('main.py', '')
    expect(deps.start).toHaveBeenCalledTimes(1)
  })

  it('can be run again after it finished, and the new run starts clean', async () => {
    const { runner, sock } = setup()
    await runner.run('main.py', '')
    sock.last().send({ type: 'output', data: 'old' })
    sock.last().send({ type: 'done', status: 'ok', exit_code: 0, duration_ms: 1 })

    await runner.run('main.py', '')
    expect(state()).toMatchObject({ phase: 'queued', output: '', result: null })
  })

  it('ignores late messages from an earlier run', async () => {
    const { runner, sock } = setup()
    await runner.run('main.py', '')
    const first = sock.last()
    first.send({ type: 'done', status: 'ok', exit_code: 0, duration_ms: 1 })
    await runner.run('main.py', '')
    first.send({ type: 'output', data: 'STALE' })
    first.send({ type: 'done', status: 'error', exit_code: 9, duration_ms: 1 })
    expect(state()).toMatchObject({ phase: 'queued', output: '', result: null })
  })
})

describe('when saving fails', () => {
  it.each([
    ['conflict', /changed somewhere else/],
    ['error', /could not be saved/],
  ] as const)('%s stops before anything is sent', async (outcome, message) => {
    const { runner, deps } = setup({ saveAll: vi.fn(async () => outcome) })
    await runner.run('main.py', '')
    expect(deps.start).not.toHaveBeenCalled()
    expect(state().phase).toBe('idle')
    expect(state().notice?.text).toMatch(message)
  })

  it('tells the page the lab is closed when the save was refused', async () => {
    const { runner, deps } = setup({ saveAll: vi.fn(async () => 'locked' as const) })
    await runner.run('main.py', '')
    expect(deps.onLabClosed).toHaveBeenCalled()
    expect(state().notice?.text).toMatch(/closed/)
  })
})

describe('when the server says no', () => {
  it('429 (too fast): friendly notice and a 3 s pause during which Run does nothing', async () => {
    const start = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(429, 'RUN_TOO_FAST', 'Please wait a few seconds'))
      .mockResolvedValue({ execution_id: 7, queue_position: 1 })
    const { runner } = setup({ start })

    await runner.run('main.py', '')
    expect(state()).toMatchObject({ phase: 'idle' })
    expect(state().notice).toEqual({ tone: 'warn', text: 'You are running too fast.' })
    expect(state().blockedUntil).toBe(Date.now() + 3000)

    await runner.run('main.py', '') // still paused
    expect(start).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(3000)
    await runner.run('main.py', '')
    expect(start).toHaveBeenCalledTimes(2)
    expect(state().phase).toBe('queued')
  })

  it('429 (previous run still going) says so', async () => {
    const start = vi.fn().mockRejectedValue(new ApiError(429, 'RUN_IN_PROGRESS', 'busy'))
    const { runner } = setup({ start })
    await runner.run('main.py', '')
    expect(state().notice?.text).toBe('Your last run is still going.')
  })

  it('429 from Nginx (no known code) is also "too fast"', async () => {
    const start = vi.fn().mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many requests'))
    const { runner } = setup({ start })
    await runner.run('main.py', '')
    expect(state().notice?.text).toBe('You are running too fast.')
  })

  it('503 (server busy): friendly notice and a 5 s pause', async () => {
    const start = vi.fn().mockRejectedValue(new ApiError(503, 'SERVER_BUSY', 'Server busy'))
    const { runner } = setup({ start })
    await runner.run('main.py', '')
    expect(state().notice).toEqual({ tone: 'warn', text: 'The server is busy right now.' })
    expect(state().blockedUntil).toBe(Date.now() + 5000)
  })

  it('403 LAB_CLOSED switches the page to read-only', async () => {
    const start = vi.fn().mockRejectedValue(new ApiError(403, 'LAB_CLOSED', 'closed'))
    const { runner, deps } = setup({ start })
    await runner.run('main.py', '')
    expect(deps.onLabClosed).toHaveBeenCalled()
    expect(state().phase).toBe('idle')
  })

  it('any other error shows the server’s own words', async () => {
    const start = vi
      .fn()
      .mockRejectedValue(new ApiError(404, 'ENTRY_NOT_FOUND', 'File not found: a.py'))
    const { runner } = setup({ start })
    await runner.run('a.py', '')
    expect(state().notice).toEqual({ tone: 'error', text: 'File not found: a.py' })
  })
})

describe('when the live socket fails', () => {
  it('polls the stored result every second until it is final', async () => {
    const fetchExecution = vi
      .fn()
      .mockResolvedValueOnce(execution({ status: 'queued' }))
      .mockResolvedValueOnce(execution({ status: 'running' }))
      .mockResolvedValueOnce(
        execution({ status: 'ok', exit_code: 0, duration_ms: 800, output: 'from the database\n' }),
      )
    const { runner, sock } = setup({ fetchExecution })
    await runner.run('main.py', '')

    sock.last().drop() // the socket died without a result
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchExecution).toHaveBeenCalledTimes(1)
    expect(state().phase).toBe('queued')

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchExecution).toHaveBeenCalledTimes(2)
    expect(state().phase).toBe('running')

    await vi.advanceTimersByTimeAsync(1000)
    expect(state()).toMatchObject({
      phase: 'finished',
      output: 'from the database\n',
      result: { status: 'ok', exitCode: 0, durationMs: 800 },
    })

    await vi.advanceTimersByTimeAsync(5000) // and it stops asking
    expect(fetchExecution).toHaveBeenCalledTimes(3)
  })

  it('falls back to polling on a stream error message too', async () => {
    const fetchExecution = vi
      .fn()
      .mockResolvedValue(execution({ status: 'timeout', output: 'loop\n', duration_ms: 10_000 }))
    const { runner, sock } = setup({ fetchExecution })
    await runner.run('main.py', '')
    sock.last().send({ type: 'error', code: 'RUN_STREAM_TIMEOUT', detail: 'Still running' })
    await vi.advanceTimersByTimeAsync(0)
    expect(state().result?.status).toBe('timeout')
  })

  it('survives a failed poll and keeps trying', async () => {
    const fetchExecution = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValueOnce(execution({ status: 'ok', exit_code: 0, duration_ms: 5, output: 'x' }))
    const { runner, sock } = setup({ fetchExecution })
    await runner.run('main.py', '')
    sock.last().drop()
    await vi.advanceTimersByTimeAsync(0)
    expect(state().phase).toBe('queued')
    await vi.advanceTimersByTimeAsync(1000)
    expect(state().phase).toBe('finished')
  })

  it('does not poll once the socket already delivered the result', async () => {
    const fetchExecution = vi.fn()
    const { runner, sock } = setup({ fetchExecution })
    await runner.run('main.py', '')
    sock.last().send({ type: 'done', status: 'ok', exit_code: 0, duration_ms: 1 })
    sock.last().drop() // closing after done is normal
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchExecution).not.toHaveBeenCalled()
  })
})

describe('clear and dispose', () => {
  it('clear empties the terminal and the result line once finished', async () => {
    const { runner, sock } = setup()
    await runner.run('main.py', '')
    sock.last().send({ type: 'output', data: 'text' })
    sock.last().send({ type: 'done', status: 'ok', exit_code: 0, duration_ms: 1 })
    runner.clear()
    expect(state()).toMatchObject({ phase: 'idle', output: '', result: null })
  })

  it('clear during a run empties only the text', async () => {
    const { runner, sock } = setup()
    await runner.run('main.py', '')
    sock.last().send({ type: 'output', data: 'text' })
    runner.clear()
    expect(state()).toMatchObject({ phase: 'running', output: '' })
  })

  it('dispose stops listening: nothing more happens after leaving the page', async () => {
    const fetchExecution = vi.fn()
    const { runner, sock } = setup({ fetchExecution })
    await runner.run('main.py', '')
    runner.dispose()
    expect(sock.last().closed).toBe(true)
    sock.last().send({ type: 'output', data: 'late' })
    sock.last().drop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(state().output).toBe('')
    expect(fetchExecution).not.toHaveBeenCalled()
  })
})

describe('an interactive run', () => {
  const begin = async (overrides: Partial<RunnerDeps> = {}) => {
    const t = setup(overrides)
    await t.runner.run('a/main.py', '', 'interactive')
    t.sock.last().send({ type: 'status', status: 'running' })
    return t
  }

  it('starts in interactive mode', async () => {
    const { deps } = await begin()
    expect(deps.start).toHaveBeenCalledWith('a/main.py', '', 'interactive')
    expect(state().mode).toBe('interactive')
  })

  it('waits when the program asks, sends the answer, and the echo is marked as typed text', async () => {
    const { runner, sock } = await begin()
    sock.last().send({ type: 'output', data: 'Enter first number: ' })
    sock.last().send({ type: 'input_request' })
    expect(state()).toMatchObject({ waitingForInput: true, inputRequestedAt: Date.now() })

    runner.sendInput('5')
    expect(sock.last().sent).toEqual([{ type: 'stdin', data: '5' }])
    expect(state()).toMatchObject({ waitingForInput: false, inputs: ['5'], inputRequestedAt: null })

    // The server echoes the line after the prompt: that part is the student's.
    sock.last().send({ type: 'output', data: '5\nEnter second number: ' })
    const before = 'Enter first number: '.length
    expect(state().output).toBe('Enter first number: 5\nEnter second number: ')
    expect(state().echoes).toEqual([{ start: before, end: before + 2 }])
  })

  it('does not echo the line itself: the output is only what the server sent', async () => {
    const { runner, sock } = await begin()
    sock.last().send({ type: 'output', data: 'Name: ' })
    sock.last().send({ type: 'input_request' })
    runner.sendInput('Ana')
    expect(state().output).toBe('Name: ')
  })

  it('ignores an answer when the program is not waiting', async () => {
    const { runner, sock } = await begin()
    runner.sendInput('early')
    expect(sock.last().sent).toEqual([])
    expect(state().inputs).toEqual([])
  })

  it('refuses a line that is too long without sending it', async () => {
    const { runner, sock } = await begin()
    sock.last().send({ type: 'input_request' })
    runner.sendInput('x'.repeat(1001))
    expect(sock.last().sent).toEqual([])
    expect(state().inputError).toMatch(/too long/)
    expect(state().waitingForInput).toBe(true)
  })

  it('ends the input on request', async () => {
    const { runner, sock } = await begin()
    sock.last().send({ type: 'input_request' })
    runner.endInput()
    expect(sock.last().sent).toEqual([{ type: 'eof' }])
    expect(state().waitingForInput).toBe(false)
  })

  it('stops the program while it runs, or is still queued', async () => {
    const { runner, sock } = await begin()
    sock.last().send({ type: 'input_request' })
    runner.stop()
    expect(sock.last().sent).toEqual([{ type: 'stop' }])
    expect(state()).toMatchObject({ stopping: true, waitingForInput: false })

    sock.last().send({ type: 'done', status: 'stopped', exit_code: null, duration_ms: 50 })
    expect(state()).toMatchObject({
      phase: 'finished',
      stopping: false,
      result: { status: 'stopped' },
    })
  })

  it('has no Stop for a batch run (the server ignores it)', async () => {
    const { runner, sock } = setup()
    await runner.run('a/main.py', 'x', 'batch')
    sock.last().send({ type: 'status', status: 'running' })
    runner.stop()
    expect(sock.last().sent).toEqual([])
  })

  it('shows a refused line and keeps waiting, rather than falling back to polling', async () => {
    const { sock, deps } = await begin()
    sock.last().send({ type: 'input_request' })
    sock.last().send({ type: 'error', code: 'INPUT_LIMIT', detail: 'x' })
    expect(state().inputError).toMatch(/200 inputs/)
    expect(state().waitingForInput).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(deps.fetchExecution).not.toHaveBeenCalled()
  })

  it('hands every typed line to the page when the run ends, so it can be run again with them', async () => {
    const onTyped = vi.fn()
    const { runner, sock } = await begin({ onTyped })
    for (const answer of ['3', '4']) {
      sock.last().send({ type: 'input_request' })
      runner.sendInput(answer)
    }
    sock.last().send({ type: 'done', status: 'ok', exit_code: 0, duration_ms: 90 })
    expect(onTyped).toHaveBeenCalledWith(['3', '4'])
  })

  it('does not offer a rerun when nothing was typed, or for a batch run', async () => {
    const onTyped = vi.fn()
    const quiet = await begin({ onTyped })
    quiet.sock.last().send({ type: 'done', status: 'ok', exit_code: 0, duration_ms: 5 })
    expect(onTyped).not.toHaveBeenCalled()

    const batch = setup({ onTyped })
    await batch.runner.run('a/main.py', '1\n', 'batch')
    batch.sock.last().send({ type: 'done', status: 'ok', exit_code: 0, duration_ms: 5 })
    expect(onTyped).not.toHaveBeenCalled()
  })

  it('understands the two new end states', async () => {
    const a = await begin()
    a.sock.last().send({ type: 'done', status: 'input_timeout', exit_code: null, duration_ms: 1 })
    expect(state().result?.status).toBe('input_timeout')
    useRunStore.setState(initialRunState)
    const b = await begin()
    b.sock.last().send({ type: 'done', status: 'stopped', exit_code: null, duration_ms: 1 })
    expect(state().result?.status).toBe('stopped')
  })
})
