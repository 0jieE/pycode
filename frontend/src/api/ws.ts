import { reportPasswordChangeRequired, reportUnauthorized } from './client'

/**
 * WebSockets live under /api/v1/ws/... on the same origin as the page and use the same cookie.
 * Close codes: 4401 not signed in / signed in elsewhere, 4403 not allowed, 4404 not found, 4408 idle.
 * Before refusing, the server sends {"type":"error","code","detail"}.
 */
export const FATAL_CLOSE_CODES: readonly number[] = [4401, 4403, 4404]

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface ServerMessage {
  type: string
  [key: string]: unknown
}

/** The part of WebSocket this helper uses (so tests can supply a fake). */
export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number }) => void) | null
  onerror: ((ev: unknown) => void) | null
  send(data: string): void
  close(code?: number): void
}

export interface SocketOptions {
  /** Path after /api/v1, e.g. "/ws/class/7". */
  path: string
  onMessage: (message: ServerMessage) => void
  /** `reconnected` is true for every open after the first: time to re-sync anything missed. */
  onOpen?: (info: { reconnected: boolean }) => void
  onStatus?: (status: SocketStatus) => void
  /** The server refused for good (4401, 4403 or 4404). Not retried. */
  onFatal?: (code: number, error: { code?: string; detail?: string } | null) => void
  /** Every close, with whether a reconnect is scheduled. */
  onClose?: (code: number, willReconnect: boolean) => void
  /**
   * Send `message` every `everyMs` while open (the students' presence ping). `firstAfterMs` sends one
   * early ping too: the server removes a student's "online" mark when any of their sockets closes, so
   * a quick extra ping puts it back if an old socket closed just after this one opened.
   */
  heartbeat?: { everyMs: number; message: string; firstAfterMs?: number }
  /** Default true. Short-lived sockets (one run) turn it off and fall back to polling instead. */
  reconnect?: boolean
  /** Test hook. */
  createSocket?: (url: string) => WebSocketLike
}

export interface SocketHandle {
  close: () => void
  /** Sends one JSON message. False when the socket is not open (nothing was sent). */
  send: (message: unknown) => boolean
}

export function wsUrl(path: string, loc: Pick<Location, 'protocol' | 'host'> = location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/api/v1${path}`
}

/** 1 s, 2 s, 4 s, 8 s, then 15 s for every later attempt. */
export function reconnectDelay(attempt: number, baseMs = 1000, maxMs = 15_000): number {
  return Math.min(maxMs, baseMs * 2 ** attempt)
}

export function connectSocket(options: SocketOptions): SocketHandle {
  const { path, reconnect = true } = options
  const create = options.createSocket ?? ((url: string) => new WebSocket(url) as WebSocketLike)

  let socket: WebSocketLike | null = null
  let stopped = false
  let isOpen = false
  let attempt = 0
  let everOpened = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let earlyPingTimer: ReturnType<typeof setTimeout> | undefined
  let lastError: { code?: string; detail?: string } | null = null

  const setStatus = (s: SocketStatus) => options.onStatus?.(s)

  function open() {
    setStatus(everOpened ? 'reconnecting' : 'connecting')
    lastError = null
    const ws = create(wsUrl(path))
    socket = ws

    ws.onopen = () => {
      isOpen = true
      attempt = 0
      const reconnected = everOpened
      everOpened = true
      setStatus('open')
      if (options.heartbeat) {
        const { everyMs, message, firstAfterMs } = options.heartbeat
        pingTimer = setInterval(() => ws.send(message), everyMs)
        if (firstAfterMs !== undefined) {
          earlyPingTimer = setTimeout(() => ws.send(message), firstAfterMs)
        }
      }
      options.onOpen?.({ reconnected })
    }

    ws.onmessage = (ev) => {
      let message: ServerMessage
      try {
        message = JSON.parse(String(ev.data)) as ServerMessage
      } catch {
        return // not ours: ignore
      }
      if (message.type === 'error') {
        lastError = { code: String(message.code ?? ''), detail: String(message.detail ?? '') }
      }
      options.onMessage(message)
    }

    ws.onerror = () => undefined // a close event always follows; that is where we react

    ws.onclose = (ev) => {
      isOpen = false
      clearInterval(pingTimer)
      clearTimeout(earlyPingTimer)
      if (stopped) return
      if (FATAL_CLOSE_CODES.includes(ev.code)) {
        stopped = true
        setStatus('closed')
        options.onClose?.(ev.code, false)
        options.onFatal?.(ev.code, lastError)
        if (lastError?.code === 'PASSWORD_CHANGE_REQUIRED') reportPasswordChangeRequired()
        if (ev.code === 4401) {
          // Not signed in, or signed in on another device: same as a 401 from the REST API.
          reportUnauthorized(
            lastError?.code || 'NOT_AUTHENTICATED',
            lastError?.detail || 'You are not signed in',
          )
        }
        return
      }
      if (!reconnect) {
        stopped = true
        setStatus('closed')
        options.onClose?.(ev.code, false)
        return
      }
      options.onClose?.(ev.code, true)
      setStatus('reconnecting')
      retryTimer = setTimeout(open, reconnectDelay(attempt))
      attempt++
    }
  }

  open()

  return {
    send: (message) => {
      if (!socket || !isOpen) return false
      socket.send(JSON.stringify(message))
      return true
    },
    close: () => {
      stopped = true
      clearTimeout(retryTimer)
      clearInterval(pingTimer)
      clearTimeout(earlyPingTimer)
      socket?.close()
      setStatus('closed')
    },
  }
}
