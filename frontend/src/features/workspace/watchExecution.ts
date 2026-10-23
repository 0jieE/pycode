import { ApiError } from '@/api/errors'
import { fetchExecution } from '@/api/queries/run'
import type { ExecutionOut } from '@/api/types'
import { connectSocket, type ServerMessage, type SocketHandle } from '@/api/ws'
import { isFinal } from './runStatus'

const POLL_EVERY_MS = 1000
/** A job that has not finished after this long is given up on (the server expires lost jobs at 60 s). */
const GIVE_UP_MS = 3 * 60_000

export interface WatchDeps {
  connect: (
    executionId: number,
    handlers: { onMessage: (m: ServerMessage) => void; onClose: () => void },
  ) => SocketHandle
  fetchExecution: (executionId: number) => Promise<ExecutionOut>
  now?: () => number
}

export interface CaseEvent {
  caseId: number
  passed: boolean
  status: string
}

export interface WatchHandlers {
  onStatus?: (status: string) => void
  /** One case finished (the server sends these together when the container ends, then `done`). */
  onCase?: (event: CaseEvent) => void
  /** The stored, complete result. Always called once, last, unless the watch gives up or is closed. */
  onFinished: (execution: ExecutionOut) => void
  onGiveUp: () => void
}

export const defaultWatchDeps: WatchDeps = {
  connect: (executionId, handlers) =>
    connectSocket({
      path: `/ws/run/${executionId}`,
      reconnect: false, // one job: if the socket fails, we poll instead
      onMessage: handlers.onMessage,
      onClose: () => handlers.onClose(),
    }),
  fetchExecution,
}

/**
 * Follows one test or try job: the socket gives live progress, and the stored execution (fetched when the
 * socket says `done`, or by polling if the socket fails) is the truth, because it holds each case's name
 * and output, which the socket never carries.
 */
export function watchExecution(
  executionId: number,
  handlers: WatchHandlers,
  deps: WatchDeps = defaultWatchDeps,
): { close: () => void } {
  const now = deps.now ?? Date.now
  let closed = false
  let socket: SocketHandle | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let polling = false

  function stop() {
    closed = true
    socket?.close()
    socket = null
    clearTimeout(timer)
  }

  function startPolling() {
    if (polling || closed) return
    polling = true
    socket?.close()
    socket = null
    const startedAt = now()
    const tick = async () => {
      if (closed) return
      try {
        const ex = await deps.fetchExecution(executionId)
        if (closed) return
        if (isFinal(ex.status)) {
          stop()
          handlers.onFinished(ex)
          return
        }
        handlers.onStatus?.(ex.status)
      } catch (err) {
        // Signed out: the app is already heading to the login page. Anything else is a hiccup.
        if (err instanceof ApiError && err.status === 401) return
      }
      if (now() - startedAt > GIVE_UP_MS) {
        stop()
        handlers.onGiveUp()
        return
      }
      timer = setTimeout(() => void tick(), POLL_EVERY_MS)
    }
    timer = setTimeout(() => void tick(), 0)
  }

  socket = deps.connect(executionId, {
    onMessage: (m) => {
      if (closed) return
      switch (m.type) {
        case 'status':
          handlers.onStatus?.(String(m.status ?? ''))
          break
        case 'test_result':
          handlers.onCase?.({
            caseId: Number(m.case_id),
            passed: m.passed === true,
            status: String(m.status ?? ''),
          })
          break
        case 'done':
        case 'error':
          // Fetch the full stored result (the first poll answers at once).
          startPolling()
          break
      }
    },
    onClose: () => startPolling(),
  })

  return { close: stop }
}
