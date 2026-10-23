import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { renameSubtree } from '@/features/workspace/treeUtils'
import { api } from '../client'
import type {
  CreateEntryRequest,
  FileMeta,
  FileOut,
  TreeOut,
  VersionOut,
  VersionPage,
} from '../types'
import { workspaceEndpoints, type WorkspaceScope } from '../workspaceScope'

/** `scope` is a class id (the lab workspace) or 'practice' (the student's own space). */
export const treeKey = (scope: WorkspaceScope) => ['workspace', scope, 'tree'] as const

export function useTree(scope: WorkspaceScope) {
  return useQuery({
    queryKey: treeKey(scope),
    queryFn: ({ signal }) => api.get<TreeOut>(workspaceEndpoints(scope).tree, { signal }),
  })
}

// --- plain functions: used by the editor store and saver, which live outside React components

export const fetchFile = (scope: WorkspaceScope, fileId: number) =>
  api.get<FileOut>(workspaceEndpoints(scope).file(fileId))

/**
 * `lastUpdatedAt` is the `updated_at` string of the previous response, passed back untouched: it has
 * microseconds, so it must never be parsed or reformatted.
 */
export const saveFileRequest = (
  scope: WorkspaceScope,
  fileId: number,
  content: string,
  lastUpdatedAt: string,
  makeVersion: boolean,
) =>
  api.put<FileMeta>(workspaceEndpoints(scope).file(fileId), {
    query: { version: makeVersion ? 'true' : undefined },
    body: { content, last_updated_at: lastUpdatedAt },
  })

export const fetchVersion = (scope: WorkspaceScope, versionId: number) =>
  api.get<VersionOut>(workspaceEndpoints(scope).version(versionId))

// --- hooks

export function useVersions(scope: WorkspaceScope, fileId: number | null) {
  return useQuery({
    queryKey: ['workspace', scope, 'versions', fileId],
    // The backend keeps at most 20 versions per file, so one page is the whole history.
    queryFn: ({ signal }) =>
      api.get<VersionPage>(workspaceEndpoints(scope).versions(fileId!), {
        query: { page: 1, size: 100 },
        signal,
      }),
    enabled: fileId !== null,
    // A drawer that is opened again must show versions saved since.
    staleTime: 0,
  })
}

export function useVersion(scope: WorkspaceScope, versionId: number | null) {
  return useQuery({
    queryKey: ['workspace', scope, 'version', versionId],
    queryFn: ({ signal }) =>
      api.get<VersionOut>(workspaceEndpoints(scope).version(versionId!), { signal }),
    enabled: versionId !== null,
    staleTime: Infinity, // a saved version never changes
  })
}

// The dialogs show server rejections (name taken, quota, lab closed) inline, hence silent.
export function useCreateEntry(scope: WorkspaceScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateEntryRequest) =>
      api.post<FileOut>(workspaceEndpoints(scope).create, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: treeKey(scope) }),
    meta: { silent: true },
  })
}

export function useRenameEntry(scope: WorkspaceScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, newPath }: { id: number; newPath: string }) =>
      api.patch<FileMeta>(workspaceEndpoints(scope).file(id), { body: { new_path: newPath } }),
    // Show the rename at once; the tree is reloaded from the server when it answers.
    onMutate: async ({ id, newPath }) => {
      await qc.cancelQueries({ queryKey: treeKey(scope) })
      const previous = qc.getQueryData<TreeOut>(treeKey(scope))
      const target = previous?.entries.find((e) => e.id === id)
      if (previous && target) {
        qc.setQueryData<TreeOut>(treeKey(scope), {
          ...previous,
          entries: renameSubtree(previous.entries, target.path, newPath),
        })
      }
      return { previous }
    },
    // Refused (name taken, lab closed...): put the tree back as it was.
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(treeKey(scope), context.previous)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: treeKey(scope) }),
    meta: { silent: true },
  })
}

export function useDeleteEntry(scope: WorkspaceScope) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(workspaceEndpoints(scope).file(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: treeKey(scope) }),
    meta: { silent: true },
  })
}
