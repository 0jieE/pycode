import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { EyeOff, GripVertical, Plus, Search, X } from 'lucide-react'
import { useManageLessons, useReorderLessons } from '@/api/queries/tutorial'
import { errorMessage } from '@/api/errors'
import { useSecondarySidebar } from '@/components/secondarySidebar'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Spinner'
import { toast } from '@/components/ui/toastStore'
import { matchesSearch } from '@/lib/tableView'
import { moveItem } from '@/lib/tutorial'
import { NewLessonDialog } from './NewLessonDialog'

/**
 * The staff's second side bar on the tutorial pages: every lesson, hidden ones too. Drag a lesson to change the
 * order students see; the + adds a lesson.
 */
export function ManageLessonPanel() {
  const hidden = useSecondarySidebar((s) => s.hidden)
  const lessons = useManageLessons()
  const reorder = useReorderLessons()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [dragSlug, setDragSlug] = useState<string | null>(null)
  const [overSlug, setOverSlug] = useState<string | null>(null)
  const all = lessons.data ?? []
  const searching = search.trim() !== ''
  const items = all.filter((l) => matchesSearch(`${l.title} ${l.slug}`, search))

  if (hidden) return null

  function move(slug: string, to: number) {
    const from = all.findIndex((l) => l.slug === slug)
    if (from === -1 || from === to) return
    reorder.mutate(
      moveItem(all, from, to).map((l) => l.slug),
      { onError: (err) => toast.error(errorMessage(err)) },
    )
  }

  return (
    <aside
      aria-label="Lessons"
      className="flex w-64 shrink-0 flex-col border-r border-line bg-surface"
    >
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          Python Tutorial
        </h2>
        <button
          type="button"
          title="Add a lesson"
          aria-label="Add a lesson"
          onClick={() => setCreating(true)}
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
              aria-label="Search lessons"
              placeholder="Search lessons"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="h-7 w-full rounded-md border border-line bg-field pr-7 pl-7 text-sm placeholder:text-ink-muted/70"
            />
            {searching && (
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

      <nav aria-label="Lessons list" className="relative min-h-0 flex-1 overflow-auto pb-2">
        {lessons.isPending ? (
          <div className="flex flex-col gap-1.5 px-3" role="status" aria-label="Loading lessons">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : lessons.isError && !lessons.data ? (
          <div className="px-3 py-2 text-sm">
            <p className="text-error">{errorMessage(lessons.error)}</p>
            <Button size="sm" className="mt-2" onClick={() => void lessons.refetch()}>
              Try again
            </Button>
          </div>
        ) : all.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-muted">No lessons yet. Use + to add one.</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-muted">No lesson matches your search.</p>
        ) : (
          <ol>
            {items.map((l) => {
              const index = all.indexOf(l)
              return (
                <li
                  key={l.slug}
                  // Reordering works on the whole list only, not on search results.
                  draggable={!searching && !reorder.isPending}
                  onDragStart={(e) => {
                    setDragSlug(l.slug)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', l.slug)
                  }}
                  onDragOver={(e) => {
                    if (dragSlug === null) return
                    e.preventDefault()
                    setOverSlug(l.slug)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragSlug !== null && dragSlug !== l.slug) move(dragSlug, index)
                    setDragSlug(null)
                    setOverSlug(null)
                  }}
                  onDragEnd={() => {
                    setDragSlug(null)
                    setOverSlug(null)
                  }}
                  className={`group flex items-center ${
                    overSlug === l.slug && dragSlug !== l.slug ? 'border-t-2 border-t-focus' : ''
                  } ${dragSlug === l.slug ? 'opacity-50' : ''}`}
                >
                  <NavLink
                    to={`/tutorial/${l.slug}`}
                    className={({ isActive }) =>
                      `flex min-w-0 flex-1 items-center gap-1.5 border-l-2 py-1.5 pr-3 pl-1 text-sm ${
                        isActive
                          ? 'border-focus bg-brand-100 text-ink-strong'
                          : 'border-transparent text-ink hover:bg-hover'
                      } ${l.is_hidden ? 'opacity-60' : ''}`
                    }
                  >
                    <GripVertical
                      aria-hidden
                      className={`size-3.5 shrink-0 text-ink-muted ${searching ? 'invisible' : 'cursor-grab'}`}
                    />
                    <span className="w-5 shrink-0 text-right text-xs text-ink-muted tabular-nums">
                      {index + 1}.
                    </span>
                    <span className="min-w-0 flex-1 truncate">{l.title}</span>
                    {l.is_hidden && (
                      <EyeOff aria-label="Hidden from students" className="size-3.5 shrink-0" />
                    )}
                  </NavLink>
                </li>
              )
            })}
          </ol>
        )}
      </nav>
      {all.length > 1 && !searching && (
        <p className="border-t border-line px-3 py-1.5 text-xs text-ink-muted">
          Drag a lesson to change the order students see.
        </p>
      )}

      <NewLessonDialog open={creating} onClose={() => setCreating(false)} />
    </aside>
  )
}
