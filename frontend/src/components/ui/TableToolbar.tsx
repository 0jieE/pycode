import { X } from 'lucide-react'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { SelectField } from './SelectField'
import { TextField } from './TextField'

export interface ToolbarFilter {
  id: string
  label: string
  value: string
  /** The choices; an "All" choice is added in front. */
  options: { value: string; label: string }[]
  /** What the empty choice says. Default "All". */
  allLabel?: string
}

interface TableToolbarProps {
  /** What is listed, in the plural ("students"): used in the search label and the count. */
  what: string
  search: string
  onSearch: (text: string) => void
  placeholder?: string
  filters?: ToolbarFilter[]
  onFilter?: (id: string, value: string) => void
  /** Something narrows the list right now. */
  active: boolean
  onClear: () => void
  /** Rows matching, and rows in all. */
  shown: number
  total: number
}

/**
 * A search box and filters for a table, with how many rows are showing. Every table in the app uses it, so
 * they all look and work alike. The list itself narrows through `useTableView`.
 */
export function TableToolbar({
  what,
  search,
  onSearch,
  placeholder,
  filters = [],
  onFilter,
  active,
  onClear,
  shown,
  total,
}: TableToolbarProps) {
  return (
    <div
      role="search"
      aria-label={`Search and filter ${what}`}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="w-full max-w-xs min-w-48 flex-1">
        <TextField
          label={`Search ${what}`}
          type="search"
          placeholder={placeholder ?? 'Type to search'}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="w-full"
        />
      </div>
      {filters.map((f) => (
        <SelectField
          key={f.id}
          label={f.label}
          value={f.value}
          onChange={(e) => onFilter?.(f.id, e.target.value)}
          options={[{ value: '', label: f.allLabel ?? 'All' }, ...f.options]}
        />
      ))}
      {active && (
        <Button variant="ghost" onClick={onClear}>
          <X aria-hidden className="size-4" />
          Clear
        </Button>
      )}
      <p aria-live="polite" className="ml-auto pb-1.5 text-sm text-ink-muted">
        {active ? `${shown} of ${total}` : `${total}`} {total === 1 ? singular(what) : what}
      </p>
    </div>
  )
}

/** "students" -> "student", "classes" -> "class": only for the count under a table. */
function singular(plural: string): string {
  if (plural.endsWith('ies')) return `${plural.slice(0, -3)}y`
  if (plural.endsWith('sses') || plural.endsWith('ches')) return plural.slice(0, -2)
  return plural.endsWith('s') ? plural.slice(0, -1) : plural
}

/** What a table shows when the search and filters leave nothing. */
export function NoMatches({ what, onClear }: { what: string; onClear: () => void }) {
  return (
    <EmptyState
      title={`No ${what} match`}
      action={<Button onClick={onClear}>Clear search and filters</Button>}
    >
      Try fewer words, or a different filter.
    </EmptyState>
  )
}
