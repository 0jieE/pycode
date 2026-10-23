import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Lock,
} from 'lucide-react'
import { extensionOf, parentOf } from '@/lib/paths'
import { buildTree, type PathEntry, type TreeNode } from './treeUtils'

export type TreeKeyAction = 'rename' | 'delete' | 'menu'

interface FileTreeProps {
  entries: readonly PathEntry[]
  selectedPath: string | null
  onSelect: (path: string, isFolder: boolean) => void
  /** Also report clicks on folders (to use one as a target). Otherwise folders only expand/collapse. */
  selectFolders?: boolean
  /** Paths that show an "unsaved" dot. */
  markers?: ReadonlySet<string>
  /** Read-only entries, by path, with why ("'Lab 1' was due on ...: its folder is read-only"): a lock is shown. */
  locks?: ReadonlyMap<string, string>
  /**
   * Expand the folders above `path` (e.g. after creating a file inside a collapsed folder). Pass a
   * new object each time: asking again for the same path expands it again.
   */
  reveal?: { path: string } | null
  /** Right click. `node` is null when the click was on the empty area (handled by the caller). */
  onContextMenu?: (event: MouseEvent, node: TreeNode) => void
  /** F2, Delete and the context-menu key on the focused row. */
  onKeyAction?: (action: TreeKeyAction, node: TreeNode, anchor: DOMRect) => void
  /** Shown when there is nothing to list. */
  emptyText?: string
  label?: string
}

/**
 * Flat paths as a folder tree. Folders start expanded. Used read-only (submission viewer, starter
 * files) and as the student's file manager (selection, markers, context menu, shortcuts).
 */
export function FileTree({
  entries,
  selectedPath,
  onSelect,
  selectFolders = false,
  markers,
  locks,
  reveal,
  onContextMenu,
  onKeyAction,
  emptyText = 'No files.',
  label = 'Files',
}: FileTreeProps) {
  const nodes = useMemo(() => buildTree(entries), [entries])
  // Remember what the user collapsed; anything new (a fresh folder) shows expanded.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  // A new reveal request expands the folders above its path. Done while rendering (not in an effect)
  // because it only adjusts this component's own state in response to a prop.
  const [handledReveal, setHandledReveal] = useState<typeof reveal>(null)
  if (reveal && reveal !== handledReveal) {
    setHandledReveal(reveal)
    const ancestors: string[] = []
    for (let p = parentOf(reveal.path); p !== ''; p = parentOf(p)) ancestors.push(p)
    if (ancestors.some((a) => collapsed.has(a))) {
      const next = new Set(collapsed)
      ancestors.forEach((a) => next.delete(a))
      setCollapsed(next)
    }
  }

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  if (nodes.length === 0) return <p className="px-3 py-2 text-sm text-ink-muted">{emptyText}</p>

  return (
    <ul role="tree" aria-label={label} className="text-sm">
      {nodes.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          collapsed={collapsed}
          markers={markers}
          locks={locks}
          selectFolders={selectFolders}
          onToggle={toggle}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          onKeyAction={onKeyAction}
        />
      ))}
    </ul>
  )
}

interface RowProps {
  node: TreeNode
  depth: number
  selectedPath: string | null
  collapsed: ReadonlySet<string>
  markers?: ReadonlySet<string>
  locks?: ReadonlyMap<string, string>
  selectFolders: boolean
  onToggle: (path: string) => void
  onSelect: (path: string, isFolder: boolean) => void
  onContextMenu?: (event: MouseEvent, node: TreeNode) => void
  onKeyAction?: (action: TreeKeyAction, node: TreeNode, anchor: DOMRect) => void
}

function TreeRow(props: RowProps) {
  const { node, depth, selectedPath, collapsed, markers, selectFolders } = props
  const isOpen = node.isFolder && !collapsed.has(node.path)
  const selected = node.path === selectedPath
  const unsaved = !node.isFolder && markers?.has(node.path)
  const lock = props.locks?.get(node.path)

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!props.onKeyAction) return
    const anchor = e.currentTarget.getBoundingClientRect()
    if (e.key === 'F2') {
      e.preventDefault()
      props.onKeyAction('rename', node, anchor)
    } else if (e.key === 'Delete') {
      e.preventDefault()
      props.onKeyAction('delete', node, anchor)
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault()
      props.onKeyAction('menu', node, anchor)
    }
  }

  return (
    <li role="none">
      <button
        type="button"
        role="treeitem"
        aria-selected={selected}
        aria-expanded={node.isFolder ? isOpen : undefined}
        title={lock ? `${node.path}: ${lock}` : node.path}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => {
          if (node.isFolder) props.onToggle(node.path)
          if (!node.isFolder || selectFolders) props.onSelect(node.path, node.isFolder)
        }}
        onContextMenu={
          props.onContextMenu
            ? (e) => {
                e.preventDefault()
                e.stopPropagation()
                props.onContextMenu?.(e, node)
              }
            : undefined
        }
        onKeyDown={onKeyDown}
        className={`flex w-full items-center gap-1.5 py-0.5 pr-2 text-left ${
          selected ? 'bg-brand-100 text-ink-strong' : 'hover:bg-hover'
        }`}
      >
        {node.isFolder ? (
          <>
            {isOpen ? (
              <ChevronDown aria-hidden className="size-3.5 shrink-0" />
            ) : (
              <ChevronRight aria-hidden className="size-3.5 shrink-0" />
            )}
            {isOpen ? (
              <FolderOpen aria-hidden className="size-4 shrink-0 text-ink-muted" />
            ) : (
              <Folder aria-hidden className="size-4 shrink-0 text-ink-muted" />
            )}
          </>
        ) : (
          <>
            <span className="size-3.5 shrink-0" />
            <FileIcon path={node.path} />
          </>
        )}
        <span className="truncate">{node.name}</span>
        {lock && (
          <Lock role="img" aria-label="read-only" className="ml-auto size-3.5 shrink-0 text-warn" />
        )}
        {unsaved && (
          <span
            role="img"
            aria-label="unsaved changes"
            className="ml-auto text-xs leading-none text-ink"
          >
            ●
          </span>
        )}
      </button>
      {node.isFolder && isOpen && node.children.length > 0 && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeRow key={child.path} {...props} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** A file's icon, tinted by its type like the editor's file icons: Python blue, JSON yellow. */
function FileIcon({ path }: { path: string }) {
  const ext = extensionOf(path)
  if (ext === '.py') return <FileCode aria-hidden className="size-4 shrink-0 text-[#519aba]" />
  if (ext === '.json') return <FileJson aria-hidden className="size-4 shrink-0 text-[#cbcb41]" />
  if (ext === '.md') return <FileText aria-hidden className="size-4 shrink-0 text-[#519aba]" />
  return <FileText aria-hidden className="size-4 shrink-0 text-ink-muted" />
}
