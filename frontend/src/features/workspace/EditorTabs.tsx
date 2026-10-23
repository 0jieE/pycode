import { useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { X } from 'lucide-react'
import { baseName } from '@/lib/paths'
import { isDirty, useWorkspaceStore } from './workspaceStore'

interface EditorTabsProps {
  /** File id -> its current path, from the tree. A renamed folder shows up here automatically. */
  pathById: ReadonlyMap<number, string>
  onClose: (id: number) => void
}

export function EditorTabs({ pathById, onClose }: EditorTabsProps) {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const files = useWorkspaceStore((s) => s.files)
  const activeId = useWorkspaceStore((s) => s.activeId)
  const activate = useWorkspaceStore((s) => s.activate)
  const refs = useRef(new Map<number, HTMLButtonElement>())

  if (tabs.length === 0) return null

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    e.preventDefault()
    const target = tabs[(index + step + tabs.length) % tabs.length]
    if (target === undefined) return
    activate(target)
    refs.current.get(target)?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Open files"
      className="flex shrink-0 overflow-x-auto bg-surface"
    >
      {tabs.map((id, index) => {
        const path = pathById.get(id) ?? ''
        const active = id === activeId
        const dirty = isDirty(files[id])
        return (
          <div
            key={id}
            className={`group flex shrink-0 items-center border-t border-r border-r-canvas ${
              active
                ? 'border-t-focus bg-canvas'
                : 'border-t-transparent bg-surface-2 hover:bg-hover'
            }`}
          >
            <button
              ref={(el) => {
                if (el) refs.current.set(id, el)
                else refs.current.delete(id)
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={path}
              onClick={() => activate(id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              // Middle click closes, like most editors.
              onAuxClick={(e: MouseEvent) => {
                if (e.button === 1) onClose(id)
              }}
              className={`flex items-center gap-1.5 py-2 pr-1 pl-3 text-sm ${
                active ? 'text-ink-strong' : 'text-ink-muted'
              }`}
            >
              {baseName(path)}
              {dirty && (
                <span
                  role="img"
                  aria-label="unsaved changes"
                  className="text-xs leading-none text-ink"
                >
                  ●
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label={`Close ${baseName(path)}`}
              onClick={() => onClose(id)}
              className="mr-1 rounded p-1 text-ink-muted hover:bg-hover hover:text-ink"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
