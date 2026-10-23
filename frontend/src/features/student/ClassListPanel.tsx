import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Plus, Search, X } from 'lucide-react'
import { useMyClasses } from '@/api/queries/myClasses'
import { errorMessage } from '@/api/errors'
import type { MyClass } from '@/api/types'
import { useSecondarySidebar } from '@/components/secondarySidebar'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Spinner'
import { matchesSearch } from '@/lib/tableView'
import { JoinClassDialog } from './JoinClassDialog'

/**
 * The student's second side bar: every class they belong to (or asked to join). Choosing one opens it in
 * the page next to this panel. It is the class-list counterpart of the IDE's explorer.
 */
export function ClassListPanel() {
  const hidden = useSecondarySidebar((s) => s.hidden)
  const classes = useMyClasses()
  const [joining, setJoining] = useState(false)
  const [search, setSearch] = useState('')
  const all = classes.data ?? []
  const items = all.filter((c) =>
    matchesSearch(
      `${c.class_name} ${c.year_and_section} ${c.school_year} ${c.instructor_name}`,
      search,
    ),
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
        <button
          type="button"
          title="Join a class with an invite code"
          aria-label="Join with a code"
          onClick={() => setJoining(true)}
          className="grid size-6 place-items-center rounded text-ink-muted hover:bg-hover hover:text-ink-strong"
        >
          <Plus aria-hidden className="size-4" />
        </button>
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
        ) : classes.isError ? (
          <div className="px-3 py-2 text-sm">
            <p className="text-error">{errorMessage(classes.error)}</p>
            <Button size="sm" className="mt-2" onClick={() => void classes.refetch()}>
              Try again
            </Button>
          </div>
        ) : all.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-muted">
            No classes yet. Use + to join one with an invite code.
          </p>
        ) : items.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-muted">No class matches your search.</p>
        ) : (
          <ul>
            {items.map((c) => (
              <li key={c.enrollment_id}>
                <ClassItem c={c} />
              </li>
            ))}
          </ul>
        )}
      </nav>

      <JoinClassDialog open={joining} onClose={() => setJoining(false)} />
    </aside>
  )
}

function ClassItem({ c }: { c: MyClass }) {
  const body = (
    <>
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">{c.class_name}</span>
        {c.status === 'approved' && c.lab_open && (
          <span
            title="The laboratory is open"
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-ok"
          />
        )}
      </span>
      <span className="block truncate text-xs text-ink-muted">
        {c.status === 'pending'
          ? 'Pending approval'
          : c.status === 'rejected'
            ? 'Not approved'
            : c.year_and_section}
      </span>
    </>
  )

  // Only a class the student is in can be opened.
  if (c.status !== 'approved') {
    return <div className="border-l-2 border-transparent px-3 py-1.5 opacity-70">{body}</div>
  }
  return (
    <NavLink
      to={`/my/classes/${c.class_id}`}
      className={({ isActive }) =>
        `block border-l-2 px-3 py-1.5 ${
          isActive
            ? 'border-focus bg-brand-100 text-ink-strong'
            : 'border-transparent text-ink hover:bg-hover'
        }`
      }
    >
      {body}
    </NavLink>
  )
}
