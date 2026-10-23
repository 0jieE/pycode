import { ApiError } from '@/api/errors'
import type { ExecutionOut, RunResponse } from '@/api/types'
import type { ServerMessage, SocketHandle } from '@/api/ws'
import { expectEcho, MAX_INPUT_CHARS, shiftEchoes, trackEcho, type RunMode } from './interactive'
import { isFinal, type RunResult } from './runStatus'
import { capOutput, initialRunState, isBusy, useRunStore } from './runStore'
import type { SaveOutcome } from './saver'
import { describeStartFailure } from './startFailure'

const POLL_EVERY_MS = 1000
/** A run that has not finished after this long is given up on (the server expires lost runs at 60 s). */
const POLL_GIVE_UP_MS = 3 * 60_000

export interface RunnerDeps {
  /** Saves every file with unsaved changes. */
  saveAll: () => Promise<SaveOutcome>
  start: (entryPath: string, stdin: string, mode: RunMode) => Promise<RunResponse>
  fetchExecution: (executionId: number) => Promise<ExecutionOut>
  /** Opens the live socket of one run. */
  connect: (
    executionId: number,
    handlers: { onMessage: (m: ServerMessage) => void; onClose: () => void },
  ) => SocketHandle
  /** The server said the laboratory is closed. */
  onLabClosed?: () => void
  /** An interactive run ended: every line typed into it (so the page can offer to run it again with them). */
  onTyped?: (inputs: string[]) => void
  now?: () => number
}

export interface Runner {
  run: (entryPath: string, stdin: string, mode?: RunMode) => Promise<void>
  /** Answers the input() the program is waiting at. */
  sendInput: (value: string) => void
  /** Closes the program's input: input() then raises EOFError. */
  endInput: () => void
  /** Ends the program (interactive runs). */
  stop: () => void
  /** The terminal's Clear button. */
  clear: () => void
  /** Leaving the page: stop listening. */
  dispose: () => void
}

/** What the server's refusals of a typed line mean, in plain words. */
const INPUT_ERRORS: Record<string, string> = {
  INPUT_TOO_LONG: `That line is too long: ${MAX_INPUT_CHARS.toLocaleString('en-US')} characters at most.`,
  INVALID_INPUT: 'That line cannot be sent.',
  INVALID_MESSAGE: 'That line cannot be sent.',
  UNKNOWN_MESSAGE: 'That line cannot be sent.',
  INPUT_LIMIT: 'This run has reached its limit of 200 inputs. End the input or stop the program.',
}

const saveProblem = (outcome: SaveOutcome): string =>
  outcome === 'locked'
    ? 'Laboratory access is closed, so your files could not be saved and nothing was run.'
    : outcome === 'conflict'
      ? 'A file was changed somewhere else. Choose which version to keep, then run again.'
      : 'Your files could not be saved, so nothing was run.'

/**
 * The run flow:
 *  1. save every dirty file (stop if that fails),
 *  2. POST the run -> "Queued, #N",
 *  3. follow it on its WebSocket: output streams in, `done` ends it (and its `output`, if present, is
 *     the final text),
 *  4. if the socket fails, poll the stored result every second instead.
 */
export function createRunner(deps: RunnerDeps): Runner {
  const now = deps.now ?? Date.now
  const set = useRunStore.setState
  const get = useRunStore.getState

  /** Bumped by every new run; events and timers of an older run check it and do nothing. */
  let current = 0
  let socket: SocketHandle | null = null
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let polling = false

  function stopListening() {
    socket?.close()
    socket = null
    clearTimeout(pollTimer)
    polling = false
  }

  function markRunning() {
    const { phase } = get()
    if (phase === 'queued' || phase === 'saving') set({ phase: 'running', runningSince: now() })
  }

  function finish(result: RunResult, finalOutput?: string) {
    stopListening()
    set((s) => {
      const replaced = finalOutput !== undefined && capOutput(finalOutput) !== s.output
      return {
        phase: 'finished',
        runningSince: null,
        result,
        // The complete output, when the server sends it, replaces whatever was streamed.
        output: finalOutput !== undefined ? capOutput(finalOutput) : s.output,
        // The coloured typed lines were found in the streamed text: if it is replaced they may not line up.
        echoes: replaced ? [] : s.echoes,
        pendingEcho: '',
        waitingForInput: false,
        inputRequestedAt: null,
        stopping: false,
      }
    })
    const { mode, inputs } = get()
    if (mode === 'interactive' && inputs.length > 0) deps.onTyped?.(inputs)
  }

  function startPolling(run: number, executionId: number) {
    if (polling) return
    polling = true
    const startedAt = now()

    const tick = async () => {
      if (run !== current) return
      try {
        const ex = await deps.fetchExecution(executionId)
        if (run !== current) return
        if (isFinal(ex.status)) {
          finish(
            { status: ex.status, exitCode: ex.exit_code, durationMs: ex.duration_ms },
            ex.output ?? '',
          )
          return
        }
        if (ex.status === 'running') markRunning()
      } catch (err) {
        // Signed out: the app is already heading to the login page. Anything else is a hiccup.
        if (err instanceof ApiError && err.status === 401) return
      }
      if (now() - startedAt > POLL_GIVE_UP_MS) {
        stopListening()
        set({
          phase: 'idle',
          notice: { tone: 'error', text: 'The result did not arrive. Please run it again.' },
        })
        return
      }
      pollTimer = setTimeout(() => void tick(), POLL_EVERY_MS)
    }
    pollTimer = setTimeout(() => void tick(), 0)
  }

  function onMessage(run: number, executionId: number, m: ServerMessage) {
    if (run !== current) return
    switch (m.type) {
      case 'status':
        if (m.status === 'running') markRunning()
        break
      case 'output': {
        markRunning()
        const chunk = String(m.data ?? '')
        set((s) => {
          const combined = s.output + chunk
          const output = capOutput(combined)
          const tracked = trackEcho(
            { pending: s.pendingEcho, ranges: s.echoes },
            s.output.length,
            chunk,
          )
          const removed = combined.length - output.length
          return {
            output,
            pendingEcho: tracked.pending,
            echoes: removed > 0 ? shiftEchoes(tracked.ranges, removed) : tracked.ranges,
          }
        })
        break
      }
      case 'input_request':
        // The program is waiting at an input(): the page asks for a line (see InputRequestPanel).
        markRunning()
        set({ waitingForInput: true, inputRequestedAt: now(), inputError: null })
        break
      case 'done':
        finish(
          {
            status: m.status as RunResult['status'],
            exitCode: typeof m.exit_code === 'number' ? m.exit_code : null,
            durationMs: typeof m.duration_ms === 'number' ? m.duration_ms : null,
          },
          typeof m.output === 'string' ? m.output : undefined,
        )
        break
      case 'error': {
        // A refused line (too long, too many inputs...): the program is still waiting, so say why.
        const text = INPUT_ERRORS[String(m.code ?? '')]
        if (text) {
          set({ inputError: text })
          break
        }
        // e.g. RUN_STREAM_TIMEOUT: the stored result is still the truth.
        startPolling(run, executionId)
        break
      }
    }
  }

  function startFailed(err: unknown) {
    const failure = describeStartFailure(err, now(), {
      stillGoing: 'Your last run is still going.',
      tooFast: 'You are running too fast.',
      couldNot: 'The run could not be started.',
    })
    if (failure.labClosed) deps.onLabClosed?.()
    set({ ...initialRunState, notice: failure.notice, blockedUntil: failure.blockedUntil })
  }

  async function run(entryPath: string, stdin: string, mode: RunMode = 'batch'): Promise<void> {
    const state = get()
    if (isBusy(state.phase)) return
    if (state.blockedUntil !== null && state.blockedUntil > now()) return

    const mine = ++current
    stopListening()
    set({ ...initialRunState, phase: 'saving', mode })

    const saved = await deps.saveAll()
    if (mine !== current) return
    if (saved !== 'saved') {
      if (saved === 'locked') deps.onLabClosed?.()
      set({ ...initialRunState, notice: { tone: 'warn', text: saveProblem(saved) } })
      return
    }

    let accepted: RunResponse
    try {
      accepted = await deps.start(entryPath, stdin, mode)
    } catch (err) {
      if (mine === current) startFailed(err)
      return
    }
    if (mine !== current) return

    set({
      phase: 'queued',
      executionId: accepted.execution_id,
      queuePosition: accepted.queue_position,
    })
    socket = deps.connect(accepted.execution_id, {
      onMessage: (m) => onMessage(mine, accepted.execution_id, m),
      // The socket ended without a result: fetch it instead.
      onClose: () => {
        if (mine === current && get().phase !== 'finished')
          startPolling(mine, accepted.execution_id)
      },
    })
  }

  function sendInput(value: string) {
    const { phase, waitingForInput } = get()
    if (phase !== 'running' || !waitingForInput) return
    if (value.length > MAX_INPUT_CHARS) {
      set({ inputError: INPUT_ERRORS.INPUT_TOO_LONG! })
      return
    }
    if (!socket?.send({ type: 'stdin', data: value })) {
      set({ inputError: 'The connection to the server is not open, so that line was not sent.' })
      return
    }
    set((s) => ({
      inputs: [...s.inputs, value],
      waitingForInput: false,
      inputRequestedAt: null,
      inputError: null,
      // The server echoes the line back as output: expect it, so it can be coloured as typed text.
      pendingEcho: expectEcho({ pending: '', ranges: [] }, value).pending,
    }))
  }

  function endInput() {
    const { phase, waitingForInput } = get()
    if (phase !== 'running' || !waitingForInput) return
    if (!socket?.send({ type: 'eof' })) {
      set({ inputError: 'The connection to the server is not open, so the input was not closed.' })
      return
    }
    set({ waitingForInput: false, inputRequestedAt: null, inputError: null })
  }

  function stop() {
    const { phase, mode, executionId } = get()
    if (mode !== 'interactive' || executionId === null) return
    if (phase !== 'queued' && phase !== 'running') return
    // The server ends the program and answers with status "stopped".
    if (socket?.send({ type: 'stop' })) {
      set({ stopping: true, waitingForInput: false, inputRequestedAt: null })
    }
  }

  return {
    run,
    sendInput,
    endInput,
    stop,
    clear: () => {
      const { phase } = get()
      if (phase === 'finished' || phase === 'idle')
        set({ ...initialRunState, blockedUntil: get().blockedUntil })
      else set({ output: '' })
    },
    dispose: () => {
      current++
      stopListening()
    },
  }
}
