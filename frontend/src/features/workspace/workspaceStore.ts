import { create } from 'zustand'
import type { WorkspaceScope } from '@/api/workspaceScope'

/**
 * Editor state for the student workspace: which files are open, what is typed in them, and the
 * `updated_at` token each file was last saved with. Everything is keyed by FILE ID, not path: the
 * backend keeps the id (and the token) when a file or its folder is renamed, so tabs and unsaved
 * text follow the file to its new path with no bookkeeping.
 */
export interface OpenFile {
  id: number
  /** What the editor shows right now. */
  content: string
  /** The last content known to be on the server. content !== savedContent means unsaved changes. */
  savedContent: string
  /** The server's `updated_at` string, exactly as received. Echoed back on save. */
  updatedAt: string
  /** Bumped on every edit: lets autosave tell "typed again" from "nothing happened". */
  rev: number
  /** Another save changed the file on the server (HTTP 409): waiting for the student's choice. */
  conflict: boolean
  /** A save request is in flight. */
  saving: boolean
}

interface WorkspaceState {
  /** Which workspace (a class, or Practice) this state belongs to; the page waits until it matches its own. */
  owner: WorkspaceScope | null
  files: Record<number, OpenFile>
  /** Open tabs, in order. */
  tabs: number[]
  activeId: number | null
  /** The server refused a write because the lab is closed (HTTP 403). */
  locked: boolean
  /** Changes could not be saved because access closed: the text is still here, in memory. */
  unsavedNotice: boolean
  /**
   * Files the server refused to save because their activity was archived (403 ACTIVITY_ARCHIVED), with its
   * message. The page makes their whole activity folder read-only.
   */
  archived: Record<number, string>

  reset: () => void
  /** Start fresh for a workspace: nothing from a previously open one may show. */
  begin: (scope: WorkspaceScope) => void
  /** A file arrived from the server: remember it and show it. Keeps typing that is already there. */
  load: (file: { id: number; content: string | null; updated_at: string }) => void
  activate: (id: number) => void
  closeTab: (id: number) => void
  edit: (id: number, content: string) => void
  /** A save succeeded: `sentContent` is what the server now has. Typing since then stays unsaved. */
  applySaved: (id: number, sentContent: string, updatedAt: string) => void
  /** Throw away local changes and take the server's version. */
  replaceFromServer: (id: number, content: string, updatedAt: string) => void
  /** Keep the text but adopt a fresh save token (the "Keep my version" choice). */
  adoptToken: (id: number, updatedAt: string) => void
  setConflict: (id: number, conflict: boolean) => void
  setSaving: (id: number, saving: boolean) => void
  /** Files were deleted: close their tabs and forget them. */
  drop: (ids: number[]) => void
  setLocked: (locked: boolean) => void
  setUnsavedNotice: (shown: boolean) => void
  markArchived: (id: number, message: string) => void
}

const initial = {
  owner: null as WorkspaceScope | null,
  files: {} as Record<number, OpenFile>,
  tabs: [] as number[],
  activeId: null as number | null,
  locked: false,
  unsavedNotice: false,
  archived: {} as Record<number, string>,
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  ...initial,

  reset: () => set({ ...initial, files: {}, archived: {} }),
  begin: (scope) => set({ ...initial, files: {}, archived: {}, owner: scope }),

  load: (file) =>
    set((s) => {
      const content = file.content ?? ''
      const existing = s.files[file.id]
      const next: OpenFile = existing
        ? existing // already open: the buffer (maybe unsaved) is the truth, not the server copy
        : {
            id: file.id,
            content,
            savedContent: content,
            updatedAt: file.updated_at,
            rev: 0,
            conflict: false,
            saving: false,
          }
      return {
        files: { ...s.files, [file.id]: next },
        tabs: s.tabs.includes(file.id) ? s.tabs : [...s.tabs, file.id],
        activeId: file.id,
      }
    }),

  activate: (id) => set((s) => (s.tabs.includes(id) ? { activeId: id } : s)),

  closeTab: (id) =>
    set((s) => {
      const index = s.tabs.indexOf(id)
      if (index === -1) return s
      const tabs = s.tabs.filter((t) => t !== id)
      const { [id]: _closed, ...files } = s.files
      void _closed
      // Closing the active tab shows its right neighbour, else the left one.
      const activeId = s.activeId === id ? (tabs[index] ?? tabs[index - 1] ?? null) : s.activeId
      return { tabs, files, activeId }
    }),

  edit: (id, content) =>
    set((s) => {
      const f = s.files[id]
      if (!f || f.content === content) return s
      return { files: { ...s.files, [id]: { ...f, content, rev: f.rev + 1 } } }
    }),

  applySaved: (id, sentContent, updatedAt) =>
    set((s) => {
      const f = s.files[id]
      if (!f) return s
      return { files: { ...s.files, [id]: { ...f, savedContent: sentContent, updatedAt } } }
    }),

  replaceFromServer: (id, content, updatedAt) =>
    set((s) => {
      const f = s.files[id]
      if (!f) return s
      return {
        files: {
          ...s.files,
          [id]: {
            ...f,
            content,
            savedContent: content,
            updatedAt,
            rev: f.rev + 1,
            conflict: false,
          },
        },
      }
    }),

  adoptToken: (id, updatedAt) =>
    set((s) => {
      const f = s.files[id]
      if (!f) return s
      return { files: { ...s.files, [id]: { ...f, updatedAt, conflict: false } } }
    }),

  setConflict: (id, conflict) =>
    set((s) => {
      const f = s.files[id]
      if (!f || f.conflict === conflict) return s
      return { files: { ...s.files, [id]: { ...f, conflict } } }
    }),

  setSaving: (id, saving) =>
    set((s) => {
      const f = s.files[id]
      if (!f || f.saving === saving) return s
      return { files: { ...s.files, [id]: { ...f, saving } } }
    }),

  drop: (ids) =>
    set((s) => {
      const gone = new Set(ids)
      const openGone = s.tabs.filter((t) => gone.has(t))
      if (openGone.length === 0) return s
      const tabs = s.tabs.filter((t) => !gone.has(t))
      const files = Object.fromEntries(
        Object.entries(s.files).filter(([id]) => !gone.has(Number(id))),
      )
      let activeId = s.activeId
      if (activeId !== null && gone.has(activeId)) {
        const at = s.tabs.indexOf(activeId)
        // Prefer a surviving tab next to where the active one was.
        activeId =
          s.tabs.slice(at + 1).find((t) => !gone.has(t)) ??
          [...s.tabs.slice(0, at)].reverse().find((t) => !gone.has(t)) ??
          null
      }
      return { tabs, files, activeId }
    }),

  setLocked: (locked) => set((s) => (s.locked === locked ? s : { locked })),
  markArchived: (id, message) =>
    set((s) => (s.archived[id] === message ? s : { archived: { ...s.archived, [id]: message } })),
  setUnsavedNotice: (unsavedNotice) =>
    set((s) => (s.unsavedNotice === unsavedNotice ? s : { unsavedNotice })),
}))

export const isDirty = (f: OpenFile | undefined): boolean => !!f && f.content !== f.savedContent

export const dirtyIds = (files: Record<number, OpenFile>): number[] =>
  Object.values(files)
    .filter(isDirty)
    .map((f) => f.id)
