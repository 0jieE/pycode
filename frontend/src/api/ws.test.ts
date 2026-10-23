import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setUnauthorizedHandler } from './client'
import { connectSocket, reconnectDelay, wsUrl, type SocketOptions, type WebSocketLike } from './ws'

class FakeSocket implements WebSocketLike {
  onopen: WebSocketLike['onopen'] = null
  onmessage: WebSocketLike['onmessage'] = null
  onclose: WebSocketLike['onclose'] = null
  onerror: WebSocketLike['onerror'] = null
  sent: string[] = []
  closed = false
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
  }
  // helpers for the test
  open() {
    this.onopen?.({})
  }
  say(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  drop(code = 1006) {
    this.onclose?.({ code })
  }
}

let sockets: FakeSocket[]
const create = (url: string) => {
  const s = new FakeSocket(url)
  sockets.push(s)
  return s
}
const last = () => sockets[sockets.length - 1]!

function connect(extra: Partial<SocketOptions> = {}) {
  const onMessage = vi.fn()
  const onOpen = vi.fn()
  const onFatal = vi.fn()
  const handle = connectSocket({
    path: '/ws/class/7',
    onMessage,
    onOpen,
    onFatal,
    createSocket: create,
    ...extra,
  })
  return { handle, onMessage, onOpen, onFatal }
}

beforeEach(() => {
  sockets = []
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  setUnauthorizedHandler(null)
})

describe('wsUrl', () => {
  it('uses ws on http and wss on https, on the page’s own host', () => {
    expect(wsUrl('/ws/run/3', { protocol: 'http:', host: 'lab.local' })).toBe(
      'ws://lab.local/api/v1/ws/run/3',
    )
    expect(wsUrl('/ws/run/3', { protocol: 'https:', host: 'lab.local' })).toBe(
      'wss://lab.local/api/v1/ws/run/3',
    )
  })
})

describe('reconnectDelay', () => {
  it('doubles from 1 s up to a 15 s ceiling', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => reconnectDelay(n))).toEqual([
      1000, 2000, 4000, 8000, 15000, 15000, 15000,
    ])
  })
})

describe('messages', () => {
  it('passes parsed server messages on and ignores junk', () => {
    const { onMessage } = connect()
    last().open()
    last().say({ type: 'connected' })
    last().onmessage?.({ data: 'not json' })
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith({ type: 'connected' })
  })

  it('sends the presence ping on a timer while open, and stops after close', () => {
    const { handle } = connect({ heartbeat: { everyMs: 25_000, message: '{"type":"ping"}' } })
    last().open()
    vi.advanceTimersByTime(25_000)
    vi.advanceTimersByTime(25_000)
    expect(last().sent).toEqual(['{"type":"ping"}', '{"type":"ping"}'])
    handle.close()
    vi.advanceTimersByTime(60_000)
    expect(last().sent).toHaveLength(2)
  })
})

describe('early presence ping', () => {
  it('sends one ping shortly after opening, then keeps to the regular rhythm', () => {
    connect({ heartbeat: { everyMs: 25_000, message: 'ping', firstAfterMs: 1500 } })
    last().open()
    vi.advanceTimersByTime(1499)
    expect(last().sent).toEqual([])
    vi.advanceTimersByTime(1)
    expect(last().sent).toEqual(['ping'])
    vi.advanceTimersByTime(25_000)
    expect(last().sent).toEqual(['ping', 'ping'])
  })

  it('sends nothing early if the socket closes first', () => {
    const { handle } = connect({
      heartbeat: { everyMs: 25_000, message: 'ping', firstAfterMs: 1500 },
    })
    last().open()
    handle.close()
    vi.advanceTimersByTime(60_000)
    expect(last().sent).toEqual([])
  })
})

describe('reconnecting', () => {
  it('reconnects with growing delays, and resets the delay after a successful open', () => {
    const { onOpen } = connect()
    last().open()
    expect(onOpen).toHaveBeenLastCalledWith({ reconnected: false })

    last().drop() // 1st loss: wait 1 s
    vi.advanceTimersByTime(999)
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)

    last().drop() // never opened: next wait is 2 s
    vi.advanceTimersByTime(1999)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(3)

    last().open() // a good connection resets the backoff
    expect(onOpen).toHaveBeenLastCalledWith({ reconnected: true })
    last().drop()
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(4)
  })

  it('also reconnects after an idle close (4408)', () => {
    connect()
    last().open()
    last().drop(4408)
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(2)
  })

  it('does not reconnect after close() is called', () => {
    const { handle } = connect()
    last().open()
    handle.close()
    last().drop()
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
  })

  it('does not reconnect when told not to (a single run)', () => {
    const onClose = vi.fn()
    connect({ reconnect: false, onClose })
    last().open()
    last().drop(1006)
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
    expect(onClose).toHaveBeenCalledWith(1006, false)
  })
})

describe('refusals', () => {
  it.each([4403, 4404])('stops for good on %d and says why', (code) => {
    const { onFatal } = connect()
    last().open()
    last().say({ type: 'error', code: 'NOT_CLASS_MEMBER', detail: 'You are not a member' })
    last().drop(code)
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
    expect(onFatal).toHaveBeenCalledWith(code, {
      code: 'NOT_CLASS_MEMBER',
      detail: 'You are not a member',
    })
  })

  it('on 4401 stops and signs the user out exactly like a REST 401 would', () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    connect()
    last().open()
    last().say({ type: 'error', code: 'SESSION_REPLACED', detail: 'Signed in on another device' })
    last().drop(4401)
    vi.advanceTimersByTime(60_000)

    expect(sockets).toHaveLength(1)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0]![0]).toMatchObject({ status: 401, code: 'SESSION_REPLACED' })
  })

  it('on 4401 without an error message still signs out', () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    connect()
    last().drop(4401)
    expect(handler.mock.calls[0]![0]).toMatchObject({ code: 'NOT_AUTHENTICATED' })
  })
})
