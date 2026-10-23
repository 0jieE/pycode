import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Search, X, type LucideIcon } from 'lucide-react'
import { RoleStatusBar } from './RoleStatusBar'
import { Shell } from './Shell'
import { useSecondarySidebar } from './secondarySidebar'

/**
 * A page with a list beside it (the administrator's Users, Registration Codes and Storage): the top bar, the icon
 * strip, the page's second side bar (`panel`) and the page. Clicking the page's icon hides or shows the side bar.
 */
export function SidePanelFrame({ panel }: { panel: ReactNode }) {
  const hidden = useSecondarySidebar((s) => s.hidden)
  return (
    <Shell>
      <div className="flex min-h-0 flex-1">
        {!hidden && panel}
        <main id="main" className="relative min-w-0 flex-1 overflow-auto bg-canvas p-6">
          <Outlet />
        </main>
      </div>
      <RoleStatusBar />
    </Shell>
  )
}

/** The second side bar: a title, an optional + button and search box, and the list (SidePanelLink rows). */
export function SidePanel({
  title,
  action,
  search,
  children,
}: {
  title: string
  action?: { label: string; icon: LucideIcon; onClick: () => void }
  search?: { value: string; onChange: (value: string) => void; placeholder: string }
  children: ReactNode
}) {
  return (
    <aside
      aria-label={title}
      className="flex w-60 shrink-0 flex-col border-r border-line bg-surface"
    >
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{title}</h2>
        {action && (
          <button
            type="button"
            title={action.label}
            aria-label={action.label}
            onClick={action.onClick}
            className="grid size-6 place-items-center rounded text-ink-muted hover:bg-hover hover:text-ink-strong"
          >
            <action.icon aria-hidden className="size-4" />
          </button>
        )}
      </div>

      {search && (
        <div className="px-2 pb-2">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-muted"
            />
            <input
              type="text"
              aria-label={search.placeholder}
              placeholder={search.placeholder}
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="h-7 w-full rounded-md border border-line bg-field pr-7 pl-7 text-sm placeholder:text-ink-muted/70"
            />
            {search.value !== '' && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => search.onChange('')}
                className="absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded text-ink-muted hover:bg-hover hover:text-ink-strong"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <nav aria-label={`${title} list`} className="relative min-h-0 flex-1 overflow-auto pb-2">
        {children}
      </nav>
    </aside>
  )
}

/** One row of a side bar: highlighted while its page is shown. */
export function SidePanelLink({
  to,
  end = false,
  icon: Icon,
  label,
  sub,
  count,
}: {
  to: string
  /** Only highlighted on exactly this address (the "All" row above its sub-pages). */
  end?: boolean
  icon?: LucideIcon
  label: string
  sub?: string
  count?: number
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2 border-l-2 px-3 py-1.5 ${
          isActive
            ? 'border-focus bg-brand-100 text-ink-strong'
            : 'border-transparent text-ink hover:bg-hover'
        }`
      }
    >
      {Icon && <Icon aria-hidden className="size-4 shrink-0 text-ink-muted" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{label}</span>
        {sub && <span className="block truncate text-xs text-ink-muted">{sub}</span>}
      </span>
      {count !== undefined && (
        <span className="shrink-0 text-xs text-ink-muted tabular-nums">{count}</span>
      )}
    </NavLink>
  )
}

/** The side bar's text when there is nothing (or nothing matching) to list. */
export function SidePanelNote({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-sm text-ink-muted">{children}</p>
}
