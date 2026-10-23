import { NavLink } from 'react-router-dom'
import { CheckCircle2, Circle, Lock, PlayCircle } from 'lucide-react'
import { useLessons } from '@/api/queries/tutorial'
import { errorMessage } from '@/api/errors'
import { useSecondarySidebar } from '@/components/secondarySidebar'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Spinner'
import { currentLesson, progressText } from '@/lib/tutorial'

/** The student's second side bar: every lesson with its state, and how far along they are. */
export function LessonListPanel() {
  const hidden = useSecondarySidebar((s) => s.hidden)
  const lessons = useLessons()
  const items = lessons.data ?? []
  const passed = items.filter((l) => l.passed).length
  const current = currentLesson(items)

  if (hidden) return null

  return (
    <aside
      aria-label="Lessons"
      className="flex w-64 shrink-0 flex-col border-r border-line bg-surface"
    >
      <div className="px-3 pt-2 pb-2">
        <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          Python Tutorial
        </h2>
        {items.length > 0 && (
          <div className="mt-2">
            <div
              role="progressbar"
              aria-label="Tutorial progress"
              aria-valuemin={0}
              aria-valuemax={items.length}
              aria-valuenow={passed}
              aria-valuetext={progressText(items)}
              className="h-1.5 overflow-hidden rounded-full bg-surface-2"
            >
              <div
                className="h-full rounded-full bg-ok transition-[width]"
                style={{ width: `${(passed / items.length) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-ink-muted">{progressText(items)}</p>
          </div>
        )}
      </div>

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
        ) : items.length === 0 ? (
          <p className="px-3 py-2 text-sm text-ink-muted">There are no lessons yet.</p>
        ) : (
          <ol>
            {items.map((l, i) => {
              const isCurrent = l.slug === current?.slug && !l.passed
              const icon = l.passed ? (
                <CheckCircle2 aria-hidden className="size-4 shrink-0 text-ok" />
              ) : l.locked ? (
                <Lock aria-hidden className="size-4 shrink-0 text-ink-muted" />
              ) : isCurrent ? (
                <PlayCircle aria-hidden className="size-4 shrink-0 text-open" />
              ) : (
                <Circle aria-hidden className="size-4 shrink-0 text-ink-muted/60" />
              )
              const state = l.passed
                ? 'passed'
                : l.locked
                  ? 'locked'
                  : isCurrent
                    ? 'current lesson'
                    : ''
              const label = (
                <>
                  {icon}
                  <span className="w-5 shrink-0 text-right text-xs text-ink-muted tabular-nums">
                    {i + 1}.
                  </span>
                  <span className="min-w-0 flex-1 truncate">{l.title}</span>
                  {state && <span className="sr-only">({state})</span>}
                </>
              )
              return (
                <li key={l.slug}>
                  {l.locked ? (
                    <span
                      aria-disabled="true"
                      title="Finish the previous lesson first"
                      className="flex cursor-not-allowed items-center gap-2 border-l-2 border-transparent px-3 py-1.5 text-sm text-ink-muted"
                    >
                      {label}
                    </span>
                  ) : (
                    <NavLink
                      to={`/tutorial/${l.slug}`}
                      className={({ isActive }) =>
                        `flex items-center gap-2 border-l-2 px-3 py-1.5 text-sm ${
                          isActive
                            ? 'border-focus bg-brand-100 text-ink-strong'
                            : 'border-transparent text-ink hover:bg-hover'
                        }`
                      }
                    >
                      {label}
                    </NavLink>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </nav>
    </aside>
  )
}
