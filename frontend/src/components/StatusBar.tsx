import type { ReactNode } from 'react'

interface StatusBarProps {
  /** The orange variant: something needs attention (the laboratory is closed). */
  alert?: boolean
  left?: ReactNode
  right?: ReactNode
}

/** The thin strip along the bottom of the window, as in VS Code: small facts about where you are. */
export function StatusBar({ alert = false, left, right }: StatusBarProps) {
  return (
    <footer
      className={`flex h-6 shrink-0 items-center justify-between gap-4 px-3 text-xs font-medium text-white ${
        alert ? 'bg-statusbar-alert' : 'bg-linear-to-r from-statusbar to-statusbar-2'
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">{left}</div>
      <div className="flex min-w-0 items-center gap-3">{right}</div>
    </footer>
  )
}

export function StatusItem({
  icon,
  title,
  children,
}: {
  icon?: ReactNode
  title?: string
  children: ReactNode
}) {
  return (
    <span title={title} className="flex min-w-0 items-center gap-1.5 truncate">
      {icon}
      {children}
    </span>
  )
}
