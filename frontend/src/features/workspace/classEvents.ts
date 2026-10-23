import type { QueryClient } from '@tanstack/react-query'
import { activitiesKey } from '@/api/queries/activities'
import { myClassesKey } from '@/api/queries/myClasses'
import { LAB_SCHEDULES, sessionsKey, useLabCloseReason } from '@/api/queries/sessions'
import { treeKey } from '@/api/queries/workspace'
import type { ServerMessage } from '@/api/ws'
import { toast } from '@/components/ui/toastStore'

const currentSessionKey = (classId: number) => [...sessionsKey(classId), 'current'] as const

/**
 * Reacts to what the server announces on /ws/class/{id}:
 *  - session_closed: the lab is closed NOW. The cached "current session" is set to none at once (no
 *    waiting for a refetch), which is what switches the workspace to read-only within a moment.
 *  - session_opened: ask for the current session again. With reason "scheduled_start" the server opened it by
 *    itself at its start time: say so.
 *  - activity_published: the new folder is in the workspace: reload the tree and say so.
 */
export function handleClassEvent(qc: QueryClient, classId: number, m: ServerMessage): void {
  switch (m.type) {
    case 'session_closed':
      // Its scheduled end, the instructor, or opened too early: the read-only banner says which.
      useLabCloseReason
        .getState()
        .set(
          classId,
          m.reason === 'scheduled_end' || m.reason === 'before_start' ? m.reason : 'manual',
        )
      // An older "it is open" answer still in flight must not overwrite the news.
      void qc.cancelQueries({ queryKey: currentSessionKey(classId) })
      qc.setQueryData(currentSessionKey(classId), null)
      // The instructor's session lists (not the current session, just set) and the labs' schedules.
      void qc.invalidateQueries({
        queryKey: sessionsKey(classId),
        predicate: (q) => q.queryKey[2] !== 'current',
      })
      void qc.invalidateQueries({ queryKey: LAB_SCHEDULES })
      void qc.invalidateQueries({ queryKey: myClassesKey })
      break
    case 'session_opened':
      void qc.invalidateQueries({ queryKey: sessionsKey(classId) })
      void qc.invalidateQueries({ queryKey: LAB_SCHEDULES })
      void qc.invalidateQueries({ queryKey: myClassesKey })
      if (m.reason === 'scheduled_start')
        toast.info('The lab session has started: the lab is open.')
      break
    case 'activity_published':
      void qc.invalidateQueries({ queryKey: treeKey(classId) })
      void qc.invalidateQueries({ queryKey: activitiesKey(classId) })
      toast.info(`New activity: ${String(m.title ?? '')}`)
      break
    case 'connected':
      // Also what runs after a reconnect: catch up on anything missed while offline.
      void qc.invalidateQueries({ queryKey: currentSessionKey(classId) })
      break
  }
}

/** Everything that may have changed while the socket was down. */
export function resyncClass(qc: QueryClient, classId: number): void {
  void qc.invalidateQueries({ queryKey: currentSessionKey(classId) })
  void qc.invalidateQueries({ queryKey: treeKey(classId) })
  void qc.invalidateQueries({ queryKey: activitiesKey(classId) })
  void qc.invalidateQueries({ queryKey: myClassesKey })
}
