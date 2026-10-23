import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { connectSocket, type SocketHandle, type SocketStatus } from '@/api/ws'
import { handleClassEvent, resyncClass } from './classEvents'

/** Students must ping every 25 s: that is their "online" signal for the instructor's monitor. */
export const PING_EVERY_MS = 25_000
/** One extra ping soon after connecting (see `heartbeat.firstAfterMs` in api/ws.ts). */
export const FIRST_PING_AFTER_MS = 1500

interface Options {
  /** True for students (they send the presence ping); the instructor only listens. */
  heartbeat: boolean
  enabled?: boolean
}

/**
 * Keeps one /ws/class/{id} socket open while a page is showing: lab opened/closed, new activity
 * published. Reconnects by itself (1 s, up to 15 s) and re-syncs after every reconnect.
 */
export function useClassSocket(
  classId: number,
  { heartbeat, enabled = true }: Options,
): SocketStatus {
  const qc = useQueryClient()
  const [status, setStatus] = useState<SocketStatus>('connecting')

  useEffect(() => {
    if (!enabled) return
    let socket: SocketHandle | null = null
    // Connect a tick later: when React mounts, unmounts and mounts again in development, the first
    // (throw-away) mount never reaches the server, so it cannot clear the real one's "online" mark.
    const timer = setTimeout(() => {
      socket = connectSocket({
        path: `/ws/class/${classId}`,
        heartbeat: heartbeat
          ? {
              everyMs: PING_EVERY_MS,
              message: JSON.stringify({ type: 'ping' }),
              firstAfterMs: FIRST_PING_AFTER_MS,
            }
          : undefined,
        onStatus: setStatus,
        onOpen: ({ reconnected }) => {
          if (reconnected) resyncClass(qc, classId)
        },
        onMessage: (m) => handleClassEvent(qc, classId, m),
      })
    }, 0)
    return () => {
      clearTimeout(timer)
      socket?.close()
    }
  }, [qc, classId, heartbeat, enabled])

  return status
}
