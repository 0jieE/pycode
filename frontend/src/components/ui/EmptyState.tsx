import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-surface px-6 py-14 text-center">
      <span className="mb-1 grid size-12 place-items-center rounded-full bg-brand-50 text-brand-700">
        <Inbox aria-hidden className="size-6" />
      </span>
      <p className="text-base font-semibold text-ink-strong">{title}</p>
      {children && <p className="max-w-md text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
