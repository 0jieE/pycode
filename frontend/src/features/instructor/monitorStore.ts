import { create } from 'zustand'
import type { MonitorSnapshot, StudentMonitor } from '@/api/types'
import {
  applyMonitorEvent,
  newerTest,
  testedFromEvent,
  testsFromSnapshot,
  type LastTestInfo,
  type MonitorEvent,
} from './monitorState'

interface MonitorStore {
  /** The snapshot `students` was built from. */
  base: MonitorSnapshot | null
  /** The snapshot's students with every live event since applied. */
  students: StudentMonitor[]
  /** Each student's latest Test result: the snapshot's `last_test`, then newer ones from live events. */
  tests: Record<number, LastTestInfo>
  /** A fresh snapshot arrived: it replaces everything (it is the authority). */
  seed: (snapshot: MonitorSnapshot) => void
  /** Apply one live event. Returns true when it is about a student the list does not have. */
  apply: (event: MonitorEvent) => boolean
  reset: () => void
}

export const useMonitorStore = create<MonitorStore>((set, get) => ({
  base: null,
  students: [],
  tests: {},
  seed: (snapshot) =>
    set((s) => {
      const tests = { ...s.tests }
      for (const [id, t] of Object.entries(testsFromSnapshot(snapshot.students))) {
        tests[Number(id)] = newerTest(tests[Number(id)], t)
      }
      return { base: snapshot, students: snapshot.students, tests }
    }),
  apply: (event) => {
    const tested = testedFromEvent(event)
    if (tested) {
      set((s) => ({
        tests: {
          ...s.tests,
          [tested.studentId]: newerTest(s.tests[tested.studentId], tested.test),
        },
      }))
      return false
    }
    const { students } = get()
    const result = applyMonitorEvent(students, event)
    if (result.students !== students) set({ students: result.students })
    return result.unknownStudent
  },
  reset: () => set({ base: null, students: [], tests: {} }),
}))
