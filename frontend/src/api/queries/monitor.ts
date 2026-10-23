import { useQuery } from '@tanstack/react-query'
import { api } from '../client'
import type { MonitorSnapshot } from '../types'

export const monitorKey = (sessionId: number) => ['monitor', sessionId] as const

/**
 * Where every student stands right now. Live events are applied on top of this; reloading it is how
 * the page re-syncs (after a reconnect, or as a slow safety net).
 */
export function useMonitorSnapshot(sessionId: number, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: monitorKey(sessionId),
    queryFn: ({ signal }) => api.get<MonitorSnapshot>(`/sessions/${sessionId}/monitor`, { signal }),
    refetchInterval: 60_000,
    enabled: options.enabled ?? true,
  })
}
