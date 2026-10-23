/**
 * A workspace is either one class's (identified by the class id) or the student's personal Practice
 * workspace. The two are served by parallel endpoints with the same rules, so the whole IDE works on
 * either: it is handed a scope and asks this module where things live.
 */
export type WorkspaceScope = number | 'practice'

export const PRACTICE = 'practice' as const

export const isPractice = (scope: WorkspaceScope): scope is typeof PRACTICE => scope === PRACTICE

export interface WorkspaceEndpoints {
  tree: string
  /** POST: create a file or folder. */
  create: string
  /** GET, PUT (save), PATCH (rename) and DELETE of one entry. */
  file: (fileId: number) => string
  versions: (fileId: number) => string
  version: (versionId: number) => string
  /** POST: run a file. */
  run: string
}

export function workspaceEndpoints(scope: WorkspaceScope): WorkspaceEndpoints {
  if (isPractice(scope)) {
    return {
      tree: '/practice/tree',
      create: '/practice/files',
      file: (id) => `/practice/files/${id}`,
      versions: (id) => `/practice/files/${id}/versions`,
      version: (id) => `/practice/versions/${id}`,
      run: '/practice/run',
    }
  }
  return {
    tree: `/workspace/${scope}/tree`,
    create: `/workspace/${scope}/files`,
    file: (id) => `/workspace/files/${id}`,
    versions: (id) => `/workspace/files/${id}/versions`,
    version: (id) => `/workspace/versions/${id}`,
    run: `/workspace/${scope}/run`,
  }
}
