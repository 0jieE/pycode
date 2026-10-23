import { api } from '../client'
import type { ExecutionOut, RunResponse } from '../types'
import { workspaceEndpoints, type WorkspaceScope } from '../workspaceScope'

/** Queues a run (of a class workspace file, or of a Practice file). 202 with the execution id and queue place. */
export const startRun = (
  scope: WorkspaceScope,
  entryPath: string,
  stdin: string,
  mode: 'interactive' | 'batch',
) =>
  api.post<RunResponse>(workspaceEndpoints(scope).run, {
    // Interactive: the program stops at each input() and the student types live (stdin is ignored).
    // Batch: every input is given up front in stdin.
    body: { entry_path: entryPath, stdin, mode },
  })

/** The stored result of a run: the fallback when the live socket is not available. */
export const fetchExecution = (executionId: number) =>
  api.get<ExecutionOut>(`/executions/${executionId}`)
