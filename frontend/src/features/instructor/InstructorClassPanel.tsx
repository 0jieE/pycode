import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Archive, Plus, Search, X } from 'lucide-react'
import { useAllClasses } from '@/api/queries/classes'
import { errorMessage } from '@/api/errors'
import type { ClassOut } from '@/api/types'
import { useSecondarySidebar } from '@/components/secondarySidebar'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Spinner'
import { matchesSearch } from '@/lib/tableView'
import { ClassFormDialog } from './ClassFormDialog'

/**
 * The instructor's second side bar: every class they teach, with a search box. Choosing one opens it in the
 * page next to this panel; a badge shows how many students are waiting to be approved.
 */
export function InstructorClassPanel() {
  const hidden = useSecondarySidebar((s) => s.hidden)
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const classes = useAllClasses(showArchived)
  const all = classes.data ?? []
  const items = all.filter((c) =>
    matchesSearch(`${c.name} ${c.year_and_section} ${c.school_year}`, search),
  )

  // Hidden from the icon strip: the page takes the room.
  if (hidden) return null

  return (
    <aside
      aria-label="Your classes"
      className="flex w-60 shrink-0 flex-col border-r border-line bg-surface"
    >
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Classes</h2>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title={showArchived ? 'Hide archived classes' : 'Show archived classes'}
            aria-label="Show archived"
            aria-pressed={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className={`grid size-6 place-items-center rounded hover:bg-hover hover:text-ink-strong ${
              showArchived ? 'bg-hover text-ink-strong' : 'text-ink-muted'
            }`}
          >
            <Archive aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            title="Create a class"
            aria-label="Create a class"
            onClick={() => setCreating(true)}
            className="grid size-6 place-items-center rounded text-ink-muted hover:bg-hover hover:text-ink-strong"
          >
            <Plus aria-hidden className="size-4" />
          </button>
        </div>
      </div>

      {all.length > 0 && (
        <div className="px-2 pb-2">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="text"
              aria-label="Search classes"
              placeholder="Search classes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="h-7 w-full rounded-md border border-line bg-field pr-7 pl-7 text-sm placeholder:text-ink-muted/70"
            />
            {search !== '' && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
                className="absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded text-ink-muted hover:bg-hover hover:text-ink-strong"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <nav aria-label="Classes" className="relative min-h-0 flex-1 overflow-auto pb-2">
        {classes.isPending ? (
          <div
            className="flex flex-col gap-1.5 px-3 pt-1"
            role="status"
            aria-label="Loading classes"
          >
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : classes.isError && !classes.data ? (
          <div className="px-3 py-2 text-sm">
            <p className="text-error">{errorMessage(classes.error)}</p>
            <Button size="sm" className="mt-2" onClick={() => void classes.refetch()}>
              Try again
            </Button>
          </div>
        ) : all.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-muted">
            No classes yet. Use + to create your first one.
          </p>
        ) : items.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-muted">No class matches your search.</p>
        ) : (
          <ul>
            {items.map((c) => (
              <li key={c.id}>
                <ClassItem c={c} />
              </li>
            ))}
          </ul>
        )}
      </nav>

      <ClassFormDialog open={creating} onClose={() => setCreating(false)} />
    </aside>
  )
}

function ClassItem({ c }: { c: ClassOut }) {
  return (
    <NavLink
      to={`/classes/${c.id}`}
      className={({ isActive }) =>
        `block border-l-2 px-3 py-1.5 ${c.is_archived ? 'opacity-70' : ''} ${
          isActive
            ? 'border-focus bg-brand-100 text-ink-strong'
            : 'border-transparent text-ink hover:bg-hover'
        }`
      }
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
        {c.pending_count > 0 && (
          <span
            title={`${c.pending_count} waiting for approval`}
            className="shrink-0 rounded-full bg-warn-soft px-1.5 text-xs font-semibold text-warn"
          >
            {c.pending_count}
            <span className="sr-only"> waiting for approval</span>
          </span>
        )}
      </span>
      <span className="block truncate text-xs text-ink-muted">
        {c.year_and_section} · {c.school_year}
        {c.is_archived ? ' · Archived' : ''}
      </span>
    </NavLink>
  )
}
