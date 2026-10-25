import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, LogOut, UserRound } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { initials } from '@/lib/initials'

/**
 * Who is signed in, top right, for every role: opens a small menu with My account (name, username, password)
 * and Sign out. Closes on Escape, on a click outside, and after choosing.
 */
export function UserMenu() {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu: ${user.full_name} (@${user.username})`}
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-right leading-tight hover:bg-hover"
      >
        <span className="hidden min-w-0 md:block">
          <span className="block truncate text-sm font-semibold text-ink-strong">
            {user.full_name}
          </span>
          <span className="block truncate text-xs text-ink-muted">@{user.username}</span>
        </span>
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-linear-135 from-brand-600 to-accent text-xs font-semibold text-white"
        >
          {initials(user.full_name)}
        </span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-ink-muted" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute top-full right-0 z-40 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          <p className="border-b border-line px-3 pt-1 pb-2 text-xs text-ink-muted">
            Signed in as <span className="font-medium text-ink-strong">@{user.username}</span>
          </p>
          <Link
            role="menuitem"
            to="/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-hover"
          >
            <UserRound aria-hidden className="size-4 text-ink-muted" />
            My account
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false)
              void signOut()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover"
          >
            <LogOut aria-hidden className="size-4 text-ink-muted" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
