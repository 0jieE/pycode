import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Check,
  FilePlus,
  FolderPlus,
  FolderUp,
  History as HistoryIcon,
  Loader,
  Lock,
  Pencil,
  Radio,
  Trash2,
} from 'lucide-react'
import { useActivities } from '@/api/queries/activities'
import { useStudentCases } from '@/api/queries/testCases'
import { useAuth } from '@/auth/AuthContext'
import { useMyClasses } from '@/api/queries/myClasses'
import { useLabCloseReason, useLiveSession } from '@/api/queries/sessions'
import { SessionClock } from '@/components/SessionClock'
import {
  fetchFile,
  saveFileRequest,
  treeKey,
  useDeleteEntry,
  useTree,
} from '@/api/queries/workspace'
import { ApiError, errorMessage } from '@/api/errors'
import type { Activity, FileMeta, TreeOut } from '@/api/types'
import { isPractice, PRACTICE, type WorkspaceScope } from '@/api/workspaceScope'
import { useSecondarySidebar } from '@/components/secondarySidebar'
import { StatusBar, StatusItem } from '@/components/StatusBar'
import { useEditorTheme } from '@/lib/useTheme'
import { TopbarActions } from '@/components/Topbar'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ContextMenu, type MenuItem } from '@/components/ui/ContextMenu'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Skeleton } from '@/components/ui/Spinner'
import { toast } from '@/components/ui/toastStore'
import { useIdParam } from '@/lib/params'
import { baseName, extensionOf, parentOf } from '@/lib/paths'
import { usePrefs } from '@/lib/prefs'
import { useNow } from '@/lib/useNow'
import CodeEditor from './CodeEditor'
import { ConflictDialog } from './ConflictDialog'
import { EditorTabs } from './EditorTabs'
import { FileTree, type TreeKeyAction } from './FileTree'
import type { RunMode } from './interactive'
import { NameDialog, type NameTarget } from './NameDialog'
import { QuickOpen } from './QuickOpen'
import { QuotaBar } from './QuotaBar'
import { ResizeHandle } from './ResizeHandle'
import { RunPanel } from './RunPanel'
import { isBusy } from './runStore'
import { createSaver } from './saver'
import { InstructionsButton, SubmitControl } from './SubmitControl'
import type { TreeNode } from './treeUtils'
import { useAutosave } from './useAutosave'
import { useRun } from './useRun'
import { useTest } from './useTest'
import { useLastTest } from '@/lib/lastTests'
import { VersionsDrawer } from './VersionsDrawer'
import { AttachToActivityDialog } from './AttachToActivityDialog'
import { hasSubfolders } from '@/lib/starterFiles'
import { closeReasonText } from '@/lib/labSession'
import { dirtyIds, isDirty, useWorkspaceStore } from './workspaceStore'

/**
 * Fetches a file and opens it in a tab. Failures are shown to the student. A file that is gone (an admin cleared
 * the workspace since the tree was loaded) says so, and `onMissing` reloads the tree.
 */
async function loadIntoStore(
  scope: WorkspaceScope,
  id: number,
  onMissing: () => void,
): Promise<void> {
  try {
    useWorkspaceStore.getState().load(await fetchFile(scope, id))
  } catch (err) {
    if (err instanceof ApiError && err.code === 'FILE_NOT_FOUND') {
      toast.error('This file no longer exists.')
      onMissing()
    } else {
      toast.error(errorMessage(err))
    }
  }
}

const MIN_TREE = 180
const MIN_RUN = 280
const MIN_EDITOR = 360
/** The side bar's icon strip, which sits to the left of the IDE (see WorkspaceShell). */
const SIDEBAR_WIDTH = 48

/** The language shown in the status bar, by file extension. */
const LANGUAGE_NAMES: Record<string, string> = {
  '.py': 'Python',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.csv': 'CSV',
}

/** The IDE for one class (`/my/classes/:classId/workspace`). Loaded only when opened. */
export default function WorkspacePage() {
  const classId = useIdParam('classId')
  if (classId === null) {
    return (
      <EmptyState
        title="Class not found"
        action={
          <Link to="/my/classes" className="font-medium text-brand-700 underline">
            Back to my classes
          </Link>
        }
      />
    )
  }
  return <WorkspaceGate scope={classId} />
}

/**
 * The same IDE on the student's personal Practice workspace (`/practice`): not tied to a class, never
 * locked, nothing to submit.
 */
export function PracticePage() {
  return <WorkspaceGate scope={PRACTICE} />
}

/** Starts a clean editor state for this workspace before anything renders from it. */
function WorkspaceGate({ scope }: { scope: WorkspaceScope }) {
  const owner = useWorkspaceStore((s) => s.owner)
  useEffect(() => {
    useWorkspaceStore.getState().begin(scope)
  }, [scope])
  if (owner !== scope) return <PageSpinner label="Opening your workspace" />
  return <Workspace scope={scope} />
}

function Workspace({ scope }: { scope: WorkspaceScope }) {
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const activityParam = Number(params.get('activity')) || null

  // Practice has no class: no activities, no lab session, no approval to check.
  const practice = isPractice(scope)
  const classId = practice ? null : scope
  const myClasses = useMyClasses({ enabled: !practice })
  const tree = useTree(scope)
  const activities = useActivities(classId ?? 0, { page: 1, size: 100 }, { enabled: !practice })
  const session = useLiveSession(classId ?? 0, { enabled: !practice })
  const closeReason = useLabCloseReason((s) => (classId === null ? undefined : s.byClass[classId]))
  const deleteEntry = useDeleteEntry(scope)
  const isInstructor = useAuth().user?.role === 'instructor'
  const [attachFolder, setAttachFolder] = useState<string | null>(null)

  const theme = useEditorTheme()
  const treeWidth = usePrefs((p) => p.treeWidth)
  const runWidth = usePrefs((p) => p.runWidth)
  const setPrefs = usePrefs((p) => p.set)

  const files = useWorkspaceStore((s) => s.files)
  const activeId = useWorkspaceStore((s) => s.activeId)
  const locked = useWorkspaceStore((s) => s.locked)
  const unsavedNotice = useWorkspaceStore((s) => s.unsavedNotice)

  // ---- where is the lab? (null = not known yet, or Practice, which has no lab)
  // Closed from the exact end time, without waiting for the server's sweep or the next refetch.
  const labOpen = !practice && session.isSuccess ? !!session.session : null
  // Practice is always editable: no lab session can lock it.
  const readOnly = !practice && (locked || labOpen === false)

  // ---- saving
  const saver = useMemo(
    () =>
      createSaver({
        request: async (id, content, token, version) =>
          saveFileRequest(scope, id, content, token, version),
        // Refresh the quota bar after every save.
        onSaved: () => void qc.invalidateQueries({ queryKey: treeKey(scope) }),
        onMissing: () => void qc.invalidateQueries({ queryKey: treeKey(scope) }),
        onError: (message) => toast.error(message),
      }),
    [qc, scope],
  )
  useAutosave(saver, readOnly)

  // Leaving the page: send whatever is still unsaved.
  useEffect(() => () => void saver.saveAll(), [saver])

  // The browser's own "leave this page?" prompt, only while something is unsaved.
  const hasDirty = dirtyIds(files).length > 0
  useEffect(() => {
    if (!hasDirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasDirty])

  // Access closed while the page was open: one last try to save, which the server will refuse (403),
  // keeping the text in memory and showing the notice. Access opened: unlock.
  const previousLab = useRef<boolean | null>(null)
  useEffect(() => {
    if (labOpen === null) return
    if (previousLab.current === true && labOpen === false) void saver.saveAll()
    if (labOpen) useWorkspaceStore.getState().setLocked(false)
    previousLab.current = labOpen
  }, [labOpen, saver])

  // A refused write means the lab just closed: find out for sure right away.
  const refetchSession = session.refetch
  useEffect(() => {
    if (locked && !practice) void refetchSession()
  }, [locked, practice, refetchSession])

  // The "could not be saved" notice goes away once everything is saved again.
  useEffect(() => {
    if (!readOnly && !hasDirty) useWorkspaceStore.getState().setUnsavedNotice(false)
  }, [readOnly, hasDirty])

  // ---- the tree
  const entries = useMemo(() => tree.data?.entries ?? [], [tree.data])
  const pathById = useMemo(() => new Map(entries.map((e) => [e.id, e.path])), [entries])
  const entryByPath = useMemo(() => new Map(entries.map((e) => [e.path, e])), [entries])
  const filePaths = useMemo(() => entries.filter((e) => !e.is_folder).map((e) => e.path), [entries])
  const pyPaths = useMemo(
    () => filePaths.filter((p) => p.toLowerCase().endsWith('.py')),
    [filePaths],
  )

  // Tabs for files that no longer exist (deleted from elsewhere) close.
  useEffect(() => {
    if (!tree.data || tree.isFetching) return
    const gone = useWorkspaceStore.getState().tabs.filter((id) => !pathById.has(id))
    if (gone.length > 0) {
      useWorkspaceStore.getState().drop(gone)
      toast.info('A file you had open was removed.')
    }
  }, [tree.data, tree.isFetching, pathById])

  const [selected, setSelected] = useState<{ path: string; isFolder: boolean } | null>(null)
  const [reveal, setReveal] = useState<{ path: string } | null>(null)
  const [loadingId, setLoadingId] = useState<number | null>(null)

  const openFile = useCallback(
    async (id: number) => {
      const state = useWorkspaceStore.getState()
      if (state.files[id]) {
        state.activate(id)
        return
      }
      setLoadingId(id)
      await loadIntoStore(scope, id, () => void qc.invalidateQueries({ queryKey: treeKey(scope) }))
      setLoadingId(null)
    },
    [scope, qc],
  )

  const openPath = useCallback(
    (path: string) => {
      const entry = entryByPath.get(path)
      if (entry && !entry.is_folder) {
        setReveal({ path })
        void openFile(entry.id)
      }
    },
    [entryByPath, openFile],
  )

  // Keep the tree's highlight on the file being edited. Adjusted while rendering: it only follows
  // another piece of this component's state.
  const activePath = activeId === null ? null : (pathById.get(activeId) ?? null)

  // Activity folders the server called archived (a save was refused): read-only, with its message.
  const archived = useWorkspaceStore((s) => s.archived)
  const archivedFolders = useMemo(() => {
    const folders = new Map<string, string>()
    for (const [id, message] of Object.entries(archived)) {
      const top = pathById.get(Number(id))?.split('/')[0]
      if (top) folders.set(top, message)
    }
    return folders
  }, [archived, pathById])

  /**
   * Why an entry cannot be changed right now: the tree's own flag (its activity is past due or archived), else a
   * save the server refused meanwhile (the due date passed while the page was open). Null when it can.
   */
  const lockOf = useCallback(
    (path: string): string | null =>
      path === ''
        ? null
        : (entryByPath.get(path)?.read_only_reason ??
          archivedFolders.get(path.split('/')[0] ?? '') ??
          null),
    [entryByPath, archivedFolders],
  )
  // A lock on the read-only folder itself, not on every file inside it.
  const locks = useMemo(() => {
    const out = new Map<string, string>()
    for (const e of entries) {
      const reason = lockOf(e.path)
      if (reason && !lockOf(parentOf(e.path))) out.set(e.path, reason)
    }
    return out
  }, [entries, lockOf])
  const activeLock = activePath ? lockOf(activePath) : null

  // A refused save means the tree's flags are out of date: fetch them again.
  const refusedCount = Object.keys(archived).length
  useEffect(() => {
    if (refusedCount > 0) void qc.invalidateQueries({ queryKey: treeKey(scope) })
  }, [refusedCount, qc, scope])
  const [highlightedFor, setHighlightedFor] = useState<string | null>(null)
  if (activePath !== highlightedFor) {
    setHighlightedFor(activePath)
    if (activePath) setSelected({ path: activePath, isFolder: false })
  }

  // ---- activities: "Open in workspace" lands in the activity's folder
  const activityList = useMemo(() => activities.data?.items ?? [], [activities.data])
  const requestedActivity = activityList.find((a) => a.id === activityParam) ?? null
  const activityOf = useCallback(
    (path: string | null): Activity | null =>
      path === null
        ? null
        : (activityList.find((a) => path === a.title || path.startsWith(a.title + '/')) ?? null),
    [activityList],
  )
  const currentActivity = activityOf(activePath) ?? requestedActivity

  // Arriving from "Open in workspace": show the activity's folder and open its main file, once.
  const [autoOpenId, setAutoOpenId] = useState<number | null>(null)
  const [autoHandled, setAutoHandled] = useState(false)
  if (!autoHandled && tree.data && requestedActivity) {
    setAutoHandled(true)
    const prefix = requestedActivity.title + '/'
    const inFolder = entries.filter((e) => !e.is_folder && e.path.startsWith(prefix))
    const first =
      inFolder.find((e) => e.path === prefix + 'main.py') ??
      inFolder.find((e) => e.path.endsWith('.py')) ??
      inFolder[0]
    setReveal({ path: requestedActivity.title })
    setAutoOpenId(first?.id ?? null)
  }
  useEffect(() => {
    if (autoOpenId !== null)
      void loadIntoStore(
        scope,
        autoOpenId,
        () => void qc.invalidateQueries({ queryKey: treeKey(scope) }),
      )
  }, [scope, autoOpenId, qc])

  // When the next due date passes, that folder turns read-only and Submit closes: refresh at that moment, then
  // wait for the one after it.
  const [duePassed, setDuePassed] = useState(0)
  useEffect(() => {
    const now = Date.now()
    const next = activityList
      .map((a) => (a.due_at ? new Date(a.due_at).getTime() : NaN))
      .filter((t) => t > now)
      .sort((a, b) => a - b)[0]
    if (next === undefined || next - now > 2 ** 31 - 1) return
    const id = window.setTimeout(
      () => {
        void qc.invalidateQueries({ queryKey: treeKey(scope) })
        setDuePassed((n) => n + 1)
      },
      next - now + 500,
    )
    return () => window.clearTimeout(id)
  }, [activityList, qc, scope, duePassed])

  // A closed lab still takes submissions until each activity's due date: say so only while one is open.
  const minuteNow = useNow(60_000)
  const canStillSubmit = activityList.some(
    (a) => a.due_at === null || new Date(a.due_at).getTime() > minuteNow,
  )

  // ---- file actions (new, rename, delete, menu)
  const [nameTarget, setNameTarget] = useState<NameTarget | null>(null)
  const [toDelete, setToDelete] = useState<{
    entry: FileMeta
    ids: number[]
    dirty: boolean
  } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null)
  const [closing, setClosing] = useState<number | null>(null)

  /** Where "New file" goes: inside a folder, next to a file, or at the top level. */
  const parentOfNode = (node: TreeNode | null): string =>
    node === null ? '' : node.isFolder ? node.path : parentOf(node.path)
  /** The toolbar buttons follow whatever is highlighted in the tree. */
  const parentFromSelection = (): string =>
    selected ? (selected.isFolder ? selected.path : parentOf(selected.path)) : ''

  function askDelete(entry: FileMeta) {
    const ids = entries
      .filter((e) => e.id === entry.id || (entry.is_folder && e.path.startsWith(entry.path + '/')))
      .map((e) => e.id)
    const dirty = ids.some((id) => isDirty(useWorkspaceStore.getState().files[id]))
    setToDelete({ entry, ids, dirty })
  }

  function confirmDelete() {
    if (!toDelete) return
    deleteEntry.mutate(toDelete.entry.id, {
      onSuccess: () => {
        useWorkspaceStore.getState().drop(toDelete.ids)
        setSelected(null)
        toast.success(`Deleted ${baseName(toDelete.entry.path)}`)
        setToDelete(null)
      },
      onError: (err) => {
        toast.error(errorMessage(err))
        setToDelete(null)
      },
    })
  }

  /**
   * Why an entry cannot be renamed, moved or deleted: a starter file (or a folder holding them), or a read-only
   * activity folder. Null when it can.
   */
  function fixedReason(entry: FileMeta): string | null {
    if (entry.protected) {
      return entry.is_folder
        ? `${baseName(entry.path)} holds starter files: it cannot be deleted, renamed or moved.`
        : `${baseName(entry.path)} is a starter file: it can be edited but not deleted, renamed or moved.`
    }
    return lockOf(entry.path)
  }
  const fixedLabel = (entry: FileMeta): string =>
    entry.protected
      ? entry.is_folder
        ? ' (holds starter files)'
        : ' (starter file)'
      : ' (read-only)'

  /**
   * Why nothing can be created in a folder: a class workspace's top level holds only the activity folders, and a
   * read-only (past due, archived) folder takes nothing new. Null when it can.
   */
  // In a class workspace new files and folders, and moves, only land inside an activity's folder: not at the
  // top level, nor in an older folder of the student's own (e.g. "misc").
  const activityFolders = useMemo(() => activityList.map((a) => a.title), [activityList])
  const outsideActivities = (parent: string): boolean =>
    !practice && !activityFolders.includes(parent.split('/')[0] ?? '')
  const notHere = (parent: string): string | null =>
    outsideActivities(parent)
      ? 'Files and folders go inside an activity folder. Choose one first.'
      : lockOf(parent)
  const notHereLabel = (parent: string): string =>
    outsideActivities(parent) ? ' (choose an activity folder)' : ' (read-only folder)'

  function menuItems(node: TreeNode | null): MenuItem[] {
    const entry = node ? entryByPath.get(node.path) : undefined
    // A right click on empty space means the top level, not wherever the highlight happens to be.
    const parent = parentOfNode(node)
    const blocked = notHere(parent) !== null
    const items: MenuItem[] = [
      {
        label: blocked ? `New file${notHereLabel(parent)}` : 'New file',
        icon: <FilePlus aria-hidden className="size-4" />,
        disabled: readOnly || blocked,
        onSelect: () => setNameTarget({ kind: 'new-file', parent }),
      },
      {
        label: blocked ? `New folder${notHereLabel(parent)}` : 'New folder',
        icon: <FolderPlus aria-hidden className="size-4" />,
        disabled: readOnly || blocked,
        onSelect: () => setNameTarget({ kind: 'new-folder', parent }),
      },
    ]
    // An instructor's own folder, with no folders inside, can become a class activity.
    if (entry?.is_folder && practice && isInstructor) {
      const nested = hasSubfolders(entry.path, entries)
      items.push({
        label: nested
          ? 'Attach to activity… (only folders without folders inside)'
          : 'Attach to activity…',
        icon: <FolderUp aria-hidden className="size-4" />,
        disabled: nested,
        onSelect: () => setAttachFolder(entry.path),
      })
    }
    if (entry) {
      const fixed = fixedReason(entry) !== null
      items.push(
        {
          label: fixed ? `Rename / move${fixedLabel(entry)}` : 'Rename / move',
          icon: <Pencil aria-hidden className="size-4" />,
          disabled: readOnly || fixed,
          onSelect: () => setNameTarget({ kind: 'rename', entry }),
        },
        {
          label: fixed ? `Delete${fixedLabel(entry)}` : 'Delete',
          icon: <Trash2 aria-hidden className="size-4" />,
          disabled: readOnly || fixed,
          danger: true,
          onSelect: () => askDelete(entry),
        },
      )
    }
    return items
  }

  function onTreeKeyAction(action: TreeKeyAction, node: TreeNode, anchor: DOMRect) {
    const entry = entryByPath.get(node.path)
    if (action === 'menu') setMenu({ x: anchor.left + 24, y: anchor.bottom, node })
    else if (readOnly || !entry) return
    else if (fixedReason(entry)) toast.info(fixedReason(entry)!)
    else if (action === 'rename') setNameTarget({ kind: 'rename', entry })
    else askDelete(entry)
  }

  const selectedEntry = selected ? entryByPath.get(selected.path) : undefined
  const selectedFixed = selectedEntry ? fixedReason(selectedEntry) : null
  const newHereLocked = notHere(parentFromSelection())

  // ---- tabs
  async function closeTab(id: number) {
    const file = useWorkspaceStore.getState().files[id]
    if (!isDirty(file)) return useWorkspaceStore.getState().closeTab(id)
    // Unsaved text: try to save it first; only ask before throwing it away.
    if (!readOnly && (await saver.save(id)) === 'saved')
      return useWorkspaceStore.getState().closeTab(id)
    setClosing(id)
  }

  // ---- keyboard: Ctrl+S saves a version, Ctrl+P opens a file
  const [quickOpen, setQuickOpen] = useState(false)
  const [history, setHistory] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        const id = useWorkspaceStore.getState().activeId
        if (id === null) return
        if (readOnly) {
          toast.error('The laboratory is closed, so nothing can be saved right now.')
          return
        }
        void saver.save(id, { version: true }).then((outcome) => {
          if (outcome === 'saved') toast.success('Saved (version created)')
        })
      } else if (key === 'p') {
        e.preventDefault()
        setQuickOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [readOnly, saver])

  // ---- run panel
  // The file to run follows the tab being edited, unless the student picked another one in the list
  // (that pick holds until they switch to a different tab).
  const [pick, setPick] = useState<{ forTab: string | null; entry: string } | null>(null)
  const [stdin, setStdin] = useState('')
  const entry =
    pick && pick.forTab === activePath && pyPaths.includes(pick.entry)
      ? pick.entry
      : activePath && pyPaths.includes(activePath)
        ? activePath
        : (pyPaths[0] ?? '')

  // How the next run gets its input. Interactive: the program stops at each input() and the student types.
  const [runMode, setRunMode] = useState<RunMode>('interactive')
  // When an interactive run ends, the lines typed into it fill the input list (for "Run again").
  const fillInputs = useCallback((lines: string[]) => setStdin(lines.join('\n')), [setStdin])
  const {
    state: runState,
    run: startRunNow,
    clear: clearRun,
    sendInput,
    endInput,
    stop: stopRun,
  } = useRun(scope, saver, fillInputs)

  // The Test button: only for a folder that belongs to an activity that has tests.
  const { user } = useAuth()
  const studentCases = useStudentCases(practice ? null : (currentActivity?.id ?? null))
  const cases = studentCases.data ?? []
  const { state: testState, test: startTestNow } = useTest(classId, user?.id ?? null, saver)
  const testBusy = isBusy(testState.phase)
  const testEntryPath = currentActivity
    ? `${currentActivity.title}/${currentActivity.entry_file}`
    : ''
  const testDisabledReason = readOnly
    ? 'Laboratory access is closed.'
    : !entryByPath.has(testEntryPath)
      ? `${currentActivity?.entry_file ?? 'The entry file'} is not in the ${currentActivity?.title ?? ''} folder, so there is nothing to test.`
      : null

  const canRun = !readOnly && entry !== '' && !isBusy(runState.phase) && !testBusy

  // An activity with tests can only be submitted once its latest code has been tested: a Test that
  // finished after the last save of any file in its folder, with nothing unsaved there.
  const lastTest = useLastTest(user?.id ?? null, currentActivity?.id ?? 0)
  const folder = currentActivity ? `${currentActivity.title}/` : null
  const folderFiles = folder ? entries.filter((e) => !e.is_folder && e.path.startsWith(folder)) : []
  const lastEdit = Math.max(0, ...folderFiles.map((e) => Date.parse(e.updated_at)))
  const unsavedInFolder =
    folder !== null &&
    Object.values(files).some((f) => isDirty(f) && (pathById.get(f.id) ?? '').startsWith(folder))
  const testedLatest =
    lastTest !== undefined && Date.parse(lastTest.at) >= lastEdit && !unsavedInFolder
  const submitBlockedReason =
    cases.length > 0 && !testedLatest
      ? 'Run Test first: Submit unlocks once your latest code has been tested.'
      : null

  // Ctrl+Enter runs. CodeMirror binds it to "insert a blank line", so listen first (capture phase)
  // and keep the editor from seeing it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      e.preventDefault()
      e.stopPropagation()
      if (canRun) void startRunNow(entry, stdin, runMode)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [canRun, entry, stdin, runMode, startRunNow])

  // ---- layout
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth - SIDEBAR_WIDTH)
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth - SIDEBAR_WIDTH)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const maxTree = Math.max(MIN_TREE, viewportWidth - runWidth - MIN_EDITOR)
  // A hidden explorer (toggled from the icon strip) gives all its room to the editor.
  const explorerHidden = useSecondarySidebar((s) => s.hidden)
  const maxRun = Math.max(MIN_RUN, viewportWidth - (explorerHidden ? 0 : treeWidth) - MIN_EDITOR)
  const shownTree = Math.min(treeWidth, maxTree)
  const shownRun = Math.min(runWidth, maxRun)

  const activeFile = activeId === null ? undefined : files[activeId]
  const markers = useMemo(
    () =>
      new Set(
        Object.values(files)
          .filter(isDirty)
          .flatMap((f) => pathById.get(f.id) ?? []),
      ),
    [files, pathById],
  )
  const anySaving = Object.values(files).some((f) => f.saving)

  // ---- early exits
  const notMember =
    !practice &&
    ((tree.error instanceof ApiError && tree.error.code === 'NOT_CLASS_MEMBER') ||
      (myClasses.isSuccess &&
        !myClasses.data.some((c) => c.class_id === classId && c.status === 'approved')))
  if (notMember) {
    return (
      <EmptyState
        title="You can't open this workspace"
        action={
          <Link to="/my/classes" className="font-medium text-brand-700 underline">
            Back to my classes
          </Link>
        }
      >
        You need to be approved by the instructor before you can use this class&apos;s workspace.
      </EmptyState>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {/* Their own buttons live in the top bar, which every student page has. */}
      <TopbarActions>
        {currentActivity && <InstructionsButton activity={currentActivity} />}
        {currentActivity && (
          <SubmitControl
            activity={currentActivity}
            saver={saver}
            blockedReason={submitBlockedReason}
          />
        )}
      </TopbarActions>

      {readOnly && (
        <div
          role="status"
          className="flex shrink-0 items-start gap-2 border-b border-warn/30 bg-warn-soft px-4 py-2 text-sm text-warn"
        >
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Laboratory access is closed: your workspace is read-only.</p>
            {closeReason && <p>{closeReasonText(closeReason)}</p>}
            <p>
              {canStillSubmit
                ? 'You can still read and copy your work, and submit activities that are not past due.'
                : 'You can still read and copy your work. Every activity is past due, so nothing can be submitted.'}
            </p>
            <p>
              Want to keep coding?{' '}
              {/* A new tab: this one may hold text that could not be saved, which leaving would lose. */}
              <Link
                to="/practice"
                target="_blank"
                rel="noopener noreferrer"
                title="Opens in a new tab, so the files you have open here stay as they are"
                className="font-semibold underline"
              >
                Open My workspace
              </Link>
              .
            </p>
            {unsavedNotice && (
              <p className="mt-1 font-semibold">
                Your last changes could not be saved because access was closed.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ---------------------------------------------------------------- files */}
        <aside
          aria-label="Your files"
          hidden={explorerHidden}
          style={{ width: shownTree }}
          className="flex shrink-0 flex-col bg-surface"
        >
          <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Explorer
          </p>
          <div className="flex flex-wrap items-center gap-1 px-1.5 pb-1.5">
            <Button
              size="sm"
              className="px-2!"
              disabled={readOnly || newHereLocked !== null}
              title={newHereLocked ?? undefined}
              onClick={() => setNameTarget({ kind: 'new-file', parent: parentFromSelection() })}
            >
              <FilePlus aria-hidden className="size-3.5" />
              File
            </Button>
            <Button
              size="sm"
              className="px-2!"
              disabled={readOnly || newHereLocked !== null}
              title={newHereLocked ?? undefined}
              onClick={() => setNameTarget({ kind: 'new-folder', parent: parentFromSelection() })}
            >
              <FolderPlus aria-hidden className="size-3.5" />
              Folder
            </Button>
            <Button
              size="sm"
              className="px-2!"
              variant="ghost"
              aria-label="Rename or move"
              title={selectedFixed ?? 'Rename or move (F2)'}
              disabled={readOnly || !selectedEntry || selectedFixed !== null}
              onClick={() =>
                selectedEntry && setNameTarget({ kind: 'rename', entry: selectedEntry })
              }
            >
              <Pencil aria-hidden className="size-3.5" />
            </Button>
            <Button
              size="sm"
              className="px-2!"
              variant="ghost"
              aria-label="Delete"
              title={selectedFixed ?? 'Delete (Delete key)'}
              disabled={readOnly || !selectedEntry || selectedFixed !== null}
              onClick={() => selectedEntry && askDelete(selectedEntry)}
            >
              <Trash2 aria-hidden className="size-3.5" />
            </Button>
          </div>

          <div
            className="min-h-0 flex-1 overflow-auto p-1.5"
            onContextMenu={(e: MouseEvent) => {
              // Right click on the empty area below the files.
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, node: null })
            }}
          >
            {tree.isPending ? (
              <div className="flex flex-col gap-2 p-1" role="status" aria-label="Loading files">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : tree.isError && !tree.data ? (
              <div className="p-3 text-sm">
                <p role="alert" className="text-error">
                  {errorMessage(tree.error)}
                </p>
                <Button size="sm" className="mt-2" onClick={() => void tree.refetch()}>
                  Try again
                </Button>
              </div>
            ) : (
              <FileTree
                entries={entries}
                selectedPath={selected?.path ?? null}
                selectFolders
                markers={markers}
                locks={locks}
                reveal={reveal}
                onSelect={(path, isFolder) => {
                  setSelected({ path, isFolder })
                  if (!isFolder) openPath(path)
                }}
                onContextMenu={(e, node) => {
                  setSelected({ path: node.path, isFolder: node.isFolder })
                  setMenu({ x: e.clientX, y: e.clientY, node })
                }}
                onKeyAction={onTreeKeyAction}
                emptyText="Your workspace is empty. Create a file to start."
              />
            )}
          </div>
          {tree.data && <QuotaBar usage={tree.data.usage} />}
        </aside>

        {!explorerHidden && (
          <ResizeHandle
            label="Resize the file list"
            pane="left"
            value={shownTree}
            min={MIN_TREE}
            max={maxTree}
            onChange={(w) => setPrefs({ treeWidth: w })}
          />
        )}

        {/* --------------------------------------------------------------- editor */}
        <main className="flex min-w-0 flex-1 flex-col bg-canvas">
          <EditorTabs pathById={pathById} onClose={(id) => void closeTab(id)} />
          {activeFile && activePath ? (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-0.5">
                <p className="truncate font-mono text-xs text-ink-muted">{activePath}</p>
                <Button size="sm" variant="ghost" onClick={() => setHistory(true)}>
                  <HistoryIcon aria-hidden className="size-3.5" />
                  History
                </Button>
              </div>
              <div className="min-h-0 flex-1">
                {activeLock && (
                  <p
                    role="status"
                    className="flex items-center gap-1.5 border-b border-line bg-warn-soft px-3 py-1 text-xs text-warn"
                  >
                    <Lock aria-hidden className="size-3.5" />
                    {/* The server's sentence has no full stop; Run and Test only work while the lab is open. */}
                    {/[.!?]$/.test(activeLock) ? activeLock : `${activeLock}.`}{' '}
                    {readOnly
                      ? 'You can still read its files.'
                      : 'You can still read, run and test its files.'}
                  </p>
                )}
                <CodeEditor
                  path={activePath}
                  value={activeFile.content}
                  readOnly={readOnly || activeLock !== null}
                  theme={theme}
                  label={`Editing ${activePath}`}
                  onChange={(text) => useWorkspaceStore.getState().edit(activeFile.id, text)}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              {loadingId !== null ? (
                <PageSpinner label="Opening file" />
              ) : (
                <EmptyState title="No file open">
                  Pick a file on the left{readOnly ? '' : ', or create a new one'}.
                  <br />
                  Press <kbd className="rounded border border-line px-1">Ctrl</kbd>+
                  <kbd className="rounded border border-line px-1">P</kbd> to find a file by name.
                </EmptyState>
              )}
            </div>
          )}
        </main>

        <ResizeHandle
          label="Resize the run panel"
          pane="right"
          value={shownRun}
          min={MIN_RUN}
          max={maxRun}
          onChange={(w) => setPrefs({ runWidth: w })}
        />

        {/* ------------------------------------------------------------------ run */}
        <div style={{ width: shownRun }} className="shrink-0">
          <RunPanel
            entries={pyPaths}
            entry={entry}
            onEntryChange={(path) => setPick({ forTab: activePath, entry: path })}
            stdin={stdin}
            onStdinChange={setStdin}
            mode={runMode}
            onModeChange={setRunMode}
            onRun={() => void startRunNow(entry, stdin, runMode)}
            onRunAgain={() => void startRunNow(entry, stdin, 'batch')}
            onSendInput={sendInput}
            onEndInput={endInput}
            onStop={stopRun}
            runDisabledReason={readOnly ? 'Laboratory access is closed.' : null}
            run={runState}
            onClear={clearRun}
            tests={
              currentActivity && cases.length > 0
                ? {
                    state: testState,
                    matches: testState.activityId === currentActivity.id,
                    cases,
                    onTest: () => void startTestNow(currentActivity.id, testEntryPath),
                    disabledReason: testDisabledReason,
                  }
                : undefined
            }
          />
        </div>
      </div>

      <StatusBar
        alert={readOnly}
        left={
          <>
            {labOpen !== null && (
              <StatusItem
                icon={
                  readOnly ? (
                    <Lock aria-hidden className="size-3" />
                  ) : (
                    <Radio aria-hidden className="size-3" />
                  )
                }
              >
                {readOnly ? 'Laboratory closed: read-only' : 'Laboratory OPEN'}
              </StatusItem>
            )}
            {!readOnly && session.session && <SessionClock session={session.session} plain />}
            <span aria-live="polite" className="flex items-center gap-1.5">
              {anySaving ? (
                <Loader aria-hidden className="size-3" />
              ) : (
                !hasDirty && <Check aria-hidden className="size-3" />
              )}
              {anySaving ? 'Saving…' : hasDirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
          </>
        }
        right={
          activePath && (
            <>
              <StatusItem title="Indentation">Spaces: 4</StatusItem>
              <StatusItem title="Encoding">UTF-8</StatusItem>
              <StatusItem title="Language">
                {LANGUAGE_NAMES[extensionOf(activePath)] ?? 'Plain Text'}
              </StatusItem>
            </>
          )
        }
      />

      {/* ---------------------------------------------------------------- dialogs */}
      <NameDialog
        scope={scope}
        activityFolders={practice ? undefined : activityFolders}
        target={nameTarget}
        entries={entries}
        onClose={() => setNameTarget(null)}
        onDone={(path, file) => {
          setNameTarget(null)
          setReveal({ path })
          // The tree was refreshed before this callback ran: ask the cache, not this render's copy.
          const created = qc
            .getQueryData<TreeOut>(treeKey(scope))
            ?.entries.find((e) => e.path === path)
          setSelected({ path, isFolder: created ? created.is_folder : file === undefined })
          if (file) void openFile(file.id)
        }}
      />

      <ConfirmDialog
        open={toDelete !== null}
        title={toDelete?.entry.is_folder ? 'Delete this folder?' : 'Delete this file?'}
        confirmLabel="Delete"
        destructive
        loading={deleteEntry.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      >
        <p>
          <strong className="font-mono text-ink">{toDelete?.entry.path}</strong>
          {toDelete?.entry.is_folder && ' and everything inside it'} will be deleted. This cannot be
          undone.
        </p>
        {toDelete?.dirty && (
          <p className="mt-2 font-medium text-warn">It includes changes that are not saved yet.</p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={closing !== null}
        title="Close without saving?"
        confirmLabel="Close and discard"
        destructive
        onConfirm={() => {
          if (closing !== null) useWorkspaceStore.getState().closeTab(closing)
          setClosing(null)
        }}
        onCancel={() => setClosing(null)}
      >
        {closing !== null && pathById.get(closing)
          ? `${baseName(pathById.get(closing) ?? '')} has changes that could not be saved. Closing it throws them away.`
          : ''}
      </ConfirmDialog>

      <ConflictDialog scope={scope} pathById={pathById} saver={saver} />

      {isInstructor && (
        <AttachToActivityDialog
          folder={attachFolder}
          entries={entries}
          saver={saver}
          onClose={() => setAttachFolder(null)}
        />
      )}

      <QuickOpen
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        paths={filePaths}
        onPick={openPath}
      />

      <VersionsDrawer
        scope={scope}
        open={history}
        onClose={() => setHistory(false)}
        fileId={activeId}
        path={activePath ?? ''}
        readOnly={readOnly}
        theme={theme}
        onRestore={(content) => {
          if (activeId === null) return
          useWorkspaceStore.getState().edit(activeId, content)
          toast.info('Version restored into the editor. It is saved like any other change.')
        }}
      />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="File actions"
          items={menuItems(menu.node)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
