import { useEffect, useMemo } from 'react'
import { startTest } from '@/api/queries/testCases'
import { setLastTest } from '@/lib/lastTests'
import { createTester } from './tester'
import type { Saver } from './saver'
import { initialTestState, useTestStore, type TestState } from './testStore'
import { watchExecution } from './watchExecution'
import { useWorkspaceStore } from './workspaceStore'

interface UseTest {
  state: TestState
  test: (activityId: number, entryPath: string) => Promise<void>
}

/** The Test button's behaviour: see `createTester` for the steps. Class workspaces only (Practice has no tests). */
export function useTest(classId: number | null, userId: number | null, saver: Saver): UseTest {
  const state = useTestStore()

  const tester = useMemo(
    () =>
      createTester({
        saveAll: saver.saveAll,
        start: (activityId, entry) => {
          if (classId === null) return Promise.reject(new Error('Practice has no tests'))
          return startTest(classId, activityId, entry)
        },
        watch: (executionId, handlers) => watchExecution(executionId, handlers),
        onLabClosed: () => useWorkspaceStore.getState().setLocked(true),
        onTested: (activityId, totals, finishedAt) => {
          if (userId !== null) setLastTest(userId, activityId, totals, finishedAt ?? undefined)
        },
      }),
    [classId, userId, saver],
  )

  // A fresh panel for each visit; stop listening when the page goes away.
  useEffect(() => {
    useTestStore.setState(initialTestState)
    return () => tester.dispose()
  }, [tester])

  return { state, test: tester.test }
}
