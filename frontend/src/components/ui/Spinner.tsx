import { Loader2 } from 'lucide-react'

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <Loader2 aria-hidden className={`animate-spin ${className}`} />
}

export function PageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex h-full min-h-48 items-center justify-center gap-3 text-ink-muted"
    >
      <Spinner className="size-5" />
      <span>{label}…</span>
    </div>
  )
}

/** Placeholder block that keeps layout stable while data loads. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-surface-2 ${className}`} />
}
