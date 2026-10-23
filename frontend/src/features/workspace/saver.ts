import { ApiError } from '@/api/errors'
import { dirtyIds, isDirty, useWorkspaceStore } from './workspaceStore'

export type SaveOutcome = 'saved' | 'skipped' | 'conflict' | 'locked' | 'error'

export interface SaverDeps {
  /** Sends one save. `token` is the previous response's `updated_at`, passed back untouched. */
  request: (
    id: number,
    content: string,
    token: string,
    makeVersion: boolean,
  ) => Promise<{ updated_at: string }>
  /** Called after each successful save (e.g. to refresh the quota bar). */
  onSaved?: (id: number) => void
  /** Show a problem to the student. */
  onError: (message: string) => void
  /** The file is gone from the server (e.g. an admin cleared the workspace): reload the tree. */
  onMissing?: (id: number) => void
}

export interface Saver {
  /** Saves one file. `version: true` is the manual Ctrl+S save, which also keeps a history entry. */
  save: (id: number, opts?: { version?: boolean }) => Promise<SaveOutcome>
  /** Saves every file with unsaved changes. Resolves 'saved' only if nothing is left unsaved. */
  saveAll: () => Promise<SaveOutcome>
}

/**
 * Saves are sent one at a time per file. A save always reads the file's text and token at the moment
 * it runs, so text typed while the previous save was in flight goes out next, with the token that
 * save returned. That is what keeps the server's optimistic lock from rejecting our own saves.
 */
export function createSaver(deps: SaverDeps): Saver {
  const store = useWorkspaceStore
  const tails = new Map<number, Promise<unknown>>()

  async function saveNow(id: number, makeVersion: boolean): Promise<SaveOutcome> {
    const file = store.getState().files[id]
    if (!file || file.conflict) return 'skipped'
    if (!isDirty(file) && !makeVersion) return 'skipped'

    const sent = file.content
    store.getState().setSaving(id, true)
    try {
      const meta = await deps.request(id, sent, file.updatedAt, makeVersion)
      store.getState().applySaved(id, sent, meta.updated_at)
      deps.onSaved?.(id)
      return 'saved'
    } catch (err) {
      return handleFailure(id, err)
    } finally {
      store.getState().setSaving(id, false)
    }
  }

  function handleFailure(id: number, err: unknown): SaveOutcome {
    const state = store.getState()
    if (err instanceof ApiError) {
      if (err.status === 409) {
        state.setConflict(id, true)
        return 'conflict'
      }
      if (
        err.status === 403 &&
        (err.code === 'ACTIVITY_ARCHIVED' || err.code === 'ACTIVITY_PAST_DUE')
      ) {
        // The activity was archived, or its due date passed while the file was open: its folder is read-only.
        // What was typed cannot be saved, so the editor goes back to the saved text (otherwise Run, which saves
        // first, would refuse).
        const file = state.files[id]
        const first = Object.keys(state.archived).length === 0
        state.markArchived(id, err.detail)
        if (file) state.replaceFromServer(id, file.savedContent, file.updatedAt)
        if (first) deps.onError(err.detail)
        return 'skipped'
      }
      if (err.status === 404 && err.code === 'FILE_NOT_FOUND') {
        // Deleted on the server (an admin cleared the workspace): its tab closes, the tree is fetched again.
        state.drop([id])
        deps.onMissing?.(id)
        deps.onError('This file no longer exists.')
        return 'error'
      }
      if (err.status === 403 && err.code === 'LAB_CLOSED') {
        // The text stays in the editor's memory; the student is told it was not saved.
        state.setLocked(true)
        state.setUnsavedNotice(true)
        return 'locked'
      }
      // 401 means the session ended: the app is already sending the user to the login page.
      if (err.status !== 401) deps.onError(err.detail)
    } else {
      deps.onError('Your changes could not be saved. Please try again.')
    }
    return 'error'
  }

  function save(id: number, opts: { version?: boolean } = {}): Promise<SaveOutcome> {
    const run = (tails.get(id) ?? Promise.resolve()).then(() => saveNow(id, !!opts.version))
    const tail = run.catch(() => undefined)
    tails.set(id, tail)
    void tail.then(() => {
      if (tails.get(id) === tail) tails.delete(id)
    })
    return run
  }

  async function saveAll(): Promise<SaveOutcome> {
    const outcomes = await Promise.all(dirtyIds(store.getState().files).map((id) => save(id)))
    const failed = outcomes.find((o) => o !== 'saved' && o !== 'skipped')
    return failed ?? 'saved'
  }

  return { save, saveAll }
}
