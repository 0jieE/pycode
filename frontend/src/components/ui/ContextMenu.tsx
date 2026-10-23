import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  label: string
  onClose: () => void
}

/** A small right-click / keyboard menu. Arrow keys move, Enter picks, Escape or a click outside closes. */
export function ContextMenu({ x, y, items, label, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    el?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()

    const closeOnOutside = (e: Event) => {
      if (el && !el.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', closeOnOutside, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
    ]
    if (buttons.length === 0) return
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'ArrowDown' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  // Keep the menu on screen near the screen edges.
  const left = Math.min(x, window.innerWidth - 220)
  const top = Math.min(y, window.innerHeight - items.length * 36 - 16)

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ left, top }}
      className="fixed z-50 w-52 rounded-lg border border-line bg-surface py-1 shadow-2xl"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-brand-100 hover:text-ink-strong focus-visible:bg-brand-100 focus-visible:text-ink-strong disabled:cursor-not-allowed disabled:opacity-40 ${
            item.danger ? 'text-error' : ''
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
