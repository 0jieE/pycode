import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { fetchExecution } from '@/api/queries/run'
import { refreshAfterCheck, startExerciseCheck, startTutorialRun } from '@/api/queries/tutorial'
import { connectSocket } from '@/api/ws'
import { createRunner } from '@/features/workspace/runner'
import { initialRunState, useRunStore } from '@/features/workspace/runStore'
import { createTester } from '@/features/workspace/tester'
import { initialTestState, useTestStore } from '@/features/workspace/testStore'
import { watchExecution } from '@/features/workspace/watchExecution'

/** Which editor the last run came from: its output shows under that editor only. */
export type RunOwner = 'try' | 'exercise'

type Files = { path: string; content: string }[]

/**
 * Running code in a lesson: the workspace's runner (live output, the input box at each input(), Stop), with
 * the code sent as it is instead of saved files. One run at a time, shared by "Try it" and the exercise.
 */
export function useTutorialRun() {
  const state = useRunStore()
  const [owner, setOwner] = useState<RunOwner>('exercise')
  // Made once per lesson page. The code to run is handed over just before each run.
  const [tools] = useState(() => {
    let code = ''
    const runner = createRunner({
      saveAll: () => Promise.resolve('saved'),
      start: (_entry, stdin, mode) => startTutorialRun(code, stdin, mode),
      fetchExecution,
      connect: (executionId, handlers) =>
        connectSocket({
          path: `/ws/run/${executionId}`,
          reconnect: false,
          onMessage: handlers.onMessage,
          onClose: () => handlers.onClose(),
        }),
    })
    return {
      runner,
      run: (source: string) => {
        code = source
        void runner.run('main.py', '', 'interactive')
      },
    }
  })
  const { runner } = tools

  useEffect(() => {
    useRunStore.setState(initialRunState)
    return () => runner.dispose()
  }, [runner])

  const runCode = useCallback(
    (source: string, from: RunOwner) => {
      setOwner(from)
      tools.run(source)
    },
    [tools],
  )

  return {
    state,
    owner,
    runCode,
    sendInput: runner.sendInput,
    endInput: runner.endInput,
    stop: runner.stop,
    clear: runner.clear,
  }
}

/**
 * The exercise's Check: the workspace's test flow, against this lesson's tests. `beforeCheck` saves the code
 * first (the server keeps it as the student's last code). Made once per lesson page.
 */
export function useExerciseCheck(
  slug: string,
  files: () => Files,
  beforeCheck: () => Promise<void>,
) {
  const qc = useQueryClient()
  const state = useTestStore()
  const [tools] = useState(() => {
    // The latest callbacks, so a check in flight is never lost to a new tester on a keystroke.
    let latest = { files, beforeCheck }
    const tester = createTester({
      saveAll: async () => {
        try {
          await latest.beforeCheck()
        } catch {
          // The check sends the code itself: a failed autosave does not stop it.
        }
        return 'saved'
      },
      start: () => startExerciseCheck(slug, latest.files()),
      watch: (executionId, handlers) => watchExecution(executionId, handlers),
      onTested: () => refreshAfterCheck(qc, slug),
    })
    return {
      tester,
      update: (next: typeof latest) => {
        latest = next
      },
    }
  })

  useEffect(() => {
    tools.update({ files, beforeCheck })
  })

  useEffect(() => {
    useTestStore.setState(initialTestState)
    return () => tools.tester.dispose()
  }, [tools])

  const check = useCallback(() => void tools.tester.test(0, 'main.py'), [tools])
  return { state, check }
}
