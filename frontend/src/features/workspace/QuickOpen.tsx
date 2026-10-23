import { useMemo, useState, type KeyboardEvent } from 'react'
import { FileText } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'

interface QuickOpenProps {
  open: boolean
  onClose: () => void
  /** Paths of the files (not folders) in the workspace. */
  paths: string[]
  onPick: (path: string) => void
}

/** Ctrl+P: type part of a file name, Enter opens the first match. */
export function QuickOpen({ open, onClose, paths, onPick }: QuickOpenProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Open file" width="max-w-lg">
      <QuickOpenBody paths={paths} onPick={onPick} onClose={onClose} />
    </Dialog>
  )
}

function QuickOpenBody({ paths, onPick, onClose }: Omit<QuickOpenProps, 'open'>) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return paths.filter((p) => p.toLowerCase().includes(q)).slice(0, 50)
  }, [paths, query])

  function pick(path: string) {
    onClose()
    onPick(path)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const path = matches[active]
      if (path) pick(path)
    }
  }

  return (
    <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="p-4 pb-2">
        <label htmlFor="quick-open" className="sr-only">
          File name
        </label>
        <input
          id="quick-open"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Type a file name…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          role="combobox"
          aria-expanded
          aria-controls="quick-open-list"
          aria-activedescendant={matches[active] ? `qo-${active}` : undefined}
          className="h-8 w-full rounded-md border border-line bg-field px-2.5 text-sm"
        />
      </div>
      <ul
        id="quick-open-list"
        role="listbox"
        aria-label="Matching files"
        className="max-h-72 overflow-auto px-2 pb-3"
      >
        {matches.length === 0 && (
          <li className="px-3 py-2 text-sm text-ink-muted">No file matches.</li>
        )}
        {matches.map((p, i) => (
          <li
            key={p}
            id={`qo-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(p)}
            className={`flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 text-sm ${
              i === active ? 'bg-brand-100 text-ink-strong' : ''
            }`}
          >
            <FileText aria-hidden className="size-4 shrink-0 text-ink-muted" />
            <span className="truncate">{p}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
