import { useState } from 'react'

/**
 * Lower case, and without accents, so "pena" finds "Peña" and "ANA" finds "Ana". Spaces are squeezed so a
 * pasted "Juan  Dela Cruz" still matches.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every word typed must appear somewhere in the row's text (in any order). An empty search matches all. */
export function matchesSearch(haystack: string, query: string): boolean {
  const words = normalizeText(query).split(' ').filter(Boolean)
  if (words.length === 0) return true
  const text = normalizeText(haystack)
  return words.every((w) => text.includes(w))
}

export interface TableViewOptions<T> {
  /** Everything the search looks at, joined: name, username, code... */
  searchText: (item: T) => string
  /**
   * One predicate per filter, by id. It is only called with a chosen value (never the empty "All"), and says
   * whether the item stays.
   */
  filters?: Record<string, (item: T, value: string) => boolean>
  pageSize: number
}

export interface TableView<T> {
  search: string
  setSearch: (text: string) => void
  filterValues: Record<string, string>
  setFilter: (id: string, value: string) => void
  /** Empties the search box and every filter. */
  clear: () => void
  /** Something narrows the list right now. */
  active: boolean
  /** Everything that matches, across pages. */
  matches: T[]
  /** The rows of the current page. */
  rows: T[]
  page: number
  setPage: (page: number) => void
}

/**
 * Search, filters and paging for a list that is already in the browser. Changing the search or a filter
 * goes back to page 1, and a page that no longer exists (rows were removed) falls back to the last one.
 */
export function useTableView<T>(items: readonly T[], options: TableViewOptions<T>): TableView<T> {
  const [search, setSearchText] = useState('')
  const [filterValues, setFilterValues] = useState<Record<string, string>>({})
  const [page, setPageNumber] = useState(1)

  const matches = items.filter((item) => {
    if (!matchesSearch(options.searchText(item), search)) return false
    for (const [id, value] of Object.entries(filterValues)) {
      const test = options.filters?.[id]
      if (value !== '' && test && !test(item, value)) return false
    }
    return true
  })

  const lastPage = Math.max(1, Math.ceil(matches.length / options.pageSize))
  const current = Math.min(page, lastPage)
  const rows = matches.slice((current - 1) * options.pageSize, current * options.pageSize)

  return {
    search,
    setSearch: (text) => {
      setSearchText(text)
      setPageNumber(1)
    },
    filterValues,
    setFilter: (id, value) => {
      setFilterValues((f) => ({ ...f, [id]: value }))
      setPageNumber(1)
    },
    clear: () => {
      setSearchText('')
      setFilterValues({})
      setPageNumber(1)
    },
    active: search.trim() !== '' || Object.values(filterValues).some((v) => v !== ''),
    matches,
    rows,
    page: current,
    setPage: setPageNumber,
  }
}
