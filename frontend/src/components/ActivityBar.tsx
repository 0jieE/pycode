import { Link, NavLink, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { LogOut, Settings } from 'lucide-react'
import { SettingsDialog } from '@/features/account/SettingsDialog'
import { useAuth } from '@/auth/AuthContext'
import { initials } from '@/lib/initials'
import { NAV_BY_ROLE } from './navItems'
import { useSecondarySidebar } from './secondarySidebar'

/**
 * The narrow strip of icons down the left edge, like VS Code's activity bar. It never opens: what each icon
 * is shows as a tooltip, and the names are in the page for screen readers. The pages' own panels (the class
 * list, the IDE's explorer) sit next to it.
 */
export function ActivityBar() {
  const { user, signOut } = useAuth()
  const { pathname } = useLocation()
  const sidebarHidden = useSecondarySidebar((s) => s.hidden)
  const [settingsOpen, setSettingsOpen] = useState(false)
  if (!user) return null

  return (
    <div className="flex w-12 shrink-0 flex-col border-r border-line bg-surface">
      <nav aria-label="Main" className="flex-1">
        <ul>
          {NAV_BY_ROLE[user.role].map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                title={label}
                aria-expanded={isOn(pathname, to) ? !sidebarHidden : undefined}
                onClick={(e) => {
                  // Like VS Code: the icon of the page you are on shows or hides its side bar; another
                  // icon goes there with the side bar shown.
                  if (isOn(pathname, to)) {
                    e.preventDefault()
                    useSecondarySidebar.getState().toggle()
                  } else {
                    useSecondarySidebar.getState().show()
                  }
                }}
                className={({ isActive }) =>
                  `group relative flex h-12 w-full items-center justify-center ${
                    isActive
                      ? 'text-brand-700 before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-brand-600'
                      : 'text-ink-muted hover:text-ink-strong'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`grid size-9 place-items-center rounded-lg transition-colors ${
                        isActive ? 'bg-brand-100' : 'group-hover:bg-hover'
                      }`}
                    >
                      <Icon aria-hidden className="size-[22px]" />
                    </span>
                    <span className="sr-only">{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col items-center gap-2 border-t border-line py-2">
        <button
          type="button"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
          className="grid size-8 place-items-center rounded-md text-ink-muted hover:bg-hover hover:text-ink-strong"
        >
          <Settings aria-hidden className="size-5" />
          <span className="sr-only">Settings</span>
        </button>
        <Link
          to="/account"
          title={`My account: ${user.full_name} (@${user.username})`}
          className="grid size-8 place-items-center rounded-full bg-linear-135 from-brand-600 to-accent text-xs font-semibold text-white shadow-sm hover:brightness-110"
        >
          <span aria-hidden>{initials(user.full_name)}</span>
          <span className="sr-only">My account</span>
        </Link>
        <button
          type="button"
          title="Sign out"
          onClick={() => void signOut()}
          className="grid size-8 place-items-center rounded-md text-ink-muted hover:bg-hover hover:text-ink-strong"
        >
          <LogOut aria-hidden className="size-4" />
          <span className="sr-only">Sign out</span>
        </button>
      </div>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

/** The page belongs to this icon: its own address, or anything under it. */
const isOn = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`)
