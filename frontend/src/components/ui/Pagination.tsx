import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button'

interface PaginationProps {
  page: number
  size: number
  total: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, size, total, onPageChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / size))
  const from = total === 0 ? 0 : (page - 1) * size + 1
  const to = Math.min(total, page * size)

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-sm">
      <p className="text-ink-muted" aria-live="polite">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft aria-hidden className="size-4" />
          Previous
        </Button>
        <span className="text-ink-muted">
          Page {page} of {pages}
        </span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Next
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </nav>
  )
}
