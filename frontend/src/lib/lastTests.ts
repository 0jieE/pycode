import { create } from 'zustand'
import type { TestTotals } from '@/features/workspace/testResults'

/**
 * The result of the student's most recent Test of each activity, kept in this browser so the class home
 * can show it. It is only what the Test button reported (the server gives students no graded score to
 * read back), and it is stored per user so a shared lab computer never shows one student's results to the
 * next.
 */
export interface LastTest extends TestTotals {
  /** ISO time of the test. */
  at: string
}

const KEY = 'lab.lastTests.v1'

type Store = Record<string, LastTest> // "userId:activityId" -> result

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

const useStore = create<{ tests: Store }>(() => ({ tests: load() }))

const keyOf = (userId: number, activityId: number) => `${userId}:${activityId}`

export function setLastTest(
  userId: number,
  activityId: number,
  totals: TestTotals,
  at: string = new Date().toISOString(),
): void {
  const tests = {
    ...useStore.getState().tests,
    [keyOf(userId, activityId)]: { ...totals, at },
  }
  useStore.setState({ tests })
  try {
    localStorage.setItem(KEY, JSON.stringify(tests))
  } catch {
    // Storage blocked or full: the result simply is not remembered after a reload.
  }
}

/** The last Test result of an activity for this user, or undefined. */
export function useLastTest(userId: number | null, activityId: number): LastTest | undefined {
  return useStore((s) => (userId === null ? undefined : s.tests[keyOf(userId, activityId)]))
}
