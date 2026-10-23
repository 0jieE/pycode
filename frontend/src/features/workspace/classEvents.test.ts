import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { sessionsKey, useLabCloseReason } from '@/api/queries/sessions'
import { treeKey } from '@/api/queries/workspace'
import { useToastStore } from '@/components/ui/toastStore'
import { handleClassEvent } from './classEvents'

const CLASS = 7
const current = [...sessionsKey(CLASS), 'current']
const openSession = { id: 1, name: 'Week 1', is_open: true }

let qc: QueryClient
beforeEach(() => {
  qc = new QueryClient()
  useToastStore.setState({ toasts: [] })
})

describe('handleClassEvent', () => {
  it('session_closed sets the cached session to "none" immediately', () => {
    qc.setQueryData(current, openSession)
    handleClassEvent(qc, CLASS, { type: 'session_closed' })
    expect(qc.getQueryData(current)).toBeNull()
  })

  it('session_closed remembers why: its scheduled end, or the instructor', () => {
    handleClassEvent(qc, CLASS, { type: 'session_closed', reason: 'scheduled_end' })
    expect(useLabCloseReason.getState().byClass[CLASS]).toBe('scheduled_end')
    handleClassEvent(qc, CLASS, { type: 'session_closed' })
    expect(useLabCloseReason.getState().byClass[CLASS]).toBe('manual')
  })

  it('session_closed beats a request that was already on its way with the old answer', async () => {
    qc.setQueryData(current, openSession)
    // A refetch is in flight and will come back saying "open".
    void qc.fetchQuery({
      queryKey: current,
      queryFn: () => new Promise((resolve) => setTimeout(() => resolve(openSession), 20)),
      staleTime: 0,
    })
    handleClassEvent(qc, CLASS, { type: 'session_closed' })
    await new Promise((r) => setTimeout(r, 60))
    expect(qc.getQueryData(current)).toBeNull()
  })

  it('a session opened long before its start, put back by the server, says so', () => {
    handleClassEvent(qc, CLASS, { type: 'session_closed', reason: 'before_start' })
    expect(useLabCloseReason.getState().byClass[CLASS]).toBe('before_start')
  })

  it('session_opened marks the session stale so it is fetched again', () => {
    qc.setQueryData(current, null)
    handleClassEvent(qc, CLASS, { type: 'session_opened' })
    expect(qc.getQueryState(current)?.isInvalidated).toBe(true)
  })

  it('activity_published reloads the tree and shows the title in a toast', () => {
    qc.setQueryData(treeKey(CLASS), { entries: [] })
    handleClassEvent(qc, CLASS, { type: 'activity_published', activity_id: 3, title: 'Lab 2' })
    expect(qc.getQueryState(treeKey(CLASS))?.isInvalidated).toBe(true)
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['New activity: Lab 2'])
  })

  it('ignores events it does not know (pong, future ones)', () => {
    qc.setQueryData(current, openSession)
    handleClassEvent(qc, CLASS, { type: 'pong' })
    handleClassEvent(qc, CLASS, { type: 'something_new' })
    expect(qc.getQueryData(current)).toEqual(openSession)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('only touches its own class', () => {
    const other = [...sessionsKey(8), 'current']
    qc.setQueryData(other, openSession)
    handleClassEvent(qc, CLASS, { type: 'session_closed' })
    expect(qc.getQueryData(other)).toEqual(openSession)
  })
})
