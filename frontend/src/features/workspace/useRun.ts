import { useEffect, useMemo } from 'react'
import { fetchExecution, startRun } from '@/api/queries/run'
import { connectSocket } from '@/api/ws'
import type { WorkspaceScope } from '@/api/workspaceScope'
import type { RunMode } from './interactive'
import { createRunner } from './runner'
import type { Saver } from './saver'
import { initialRunState, useRunStore, type RunState } from './runStore'
import { useWorkspaceStore } from './workspaceStore'

interface UseRun {
  state: RunState
  run: (entryPath: string, stdin: string, mode?: RunMode) => Promise<void>
  sendInput: (value: string) => void
  endInput: () => void
  stop: () => void
  clear: () => void
}

/** The server said the laboratory is closed: the whole workspace becomes read-only. */
const lockWorkspace = () => useWorkspaceStore.getState().setLocked(true)

/** The Run button's behaviour: see `createRunner` for the steps. */
export function useRun(
  scope: WorkspaceScope,
  saver: Saver,
  onTyped?: (inputs: string[]) => void,
): UseRun {
  const state = useRunStore()

  const runner = useMemo(
    () =>
      createRunner({
        saveAll: saver.saveAll,
        start: (entry, stdin, mode) => startRun(scope, entry, stdin, mode),
        fetchExecution,
        connect: (executionId, handlers) =>
          connectSocket({
            path: `/ws/run/${executionId}`,
            reconnect: false, // one run: if the socket fails, the runner polls instead
            onMessage: handlers.onMessage,
            onClose: () => handlers.onClose(),
          }),
        onLabClosed: lockWorkspace,
        onTyped,
      }),
    [scope, saver, onTyped],
  )

  // A fresh terminal for each visit; stop listening when the page goes away.
  useEffect(() => {
    useRunStore.setState(initialRunState)
    return () => runner.dispose()
  }, [runner])

  return {
    state,
    run: runner.run,
    sendInput: runner.sendInput,
    endInput: runner.endInput,
    stop: runner.stop,
    clear: runner.clear,
  }
}
