import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { matchesSearch, normalizeText, useTableView } from './tableView'

describe('matchesSearch', () => {
  it('ignores case and accents', () => {
    expect(matchesSearch('Juan Peña', 'pena')).toBe(true)
    expect(matchesSearch('Juan Peña', 'JUAN')).toBe(true)
    expect(normalizeText('  Dela   Cruz ')).toBe('dela cruz')
  })

  it('needs every word, in any order', () => {
    expect(matchesSearch('Maria Santos 2026-0007', 'santos maria')).toBe(true)
    expect(matchesSearch('Maria Santos 2026-0007', 'santos juan')).toBe(false)
  })

  it('matches everything when nothing is typed', () => {
    expect(matchesSearch('anything', '')).toBe(true)
    expect(matchesSearch('anything', '   ')).toBe(true)
  })
})

interface Row {
  name: string
  kind: 'a' | 'b'
}

const ROWS: Row[] = Array.from({ length: 25 }, (_, i) => ({
  name: `Row ${i + 1}`,
  kind: i % 5 === 0 ? 'b' : 'a',
}))

const options = {
  searchText: (r: Row) => r.name,
  filters: { kind: (r: Row, v: string) => r.kind === v },
  pageSize: 10,
}

describe('useTableView', () => {
  it('pages the whole list when nothing is searched', () => {
    const { result } = renderHook(() => useTableView(ROWS, options))
    expect(result.current.rows).toHaveLength(10)
    expect(result.current.matches).toHaveLength(25)
    expect(result.current.active).toBe(false)
  })

  it('searches, and goes back to page 1', () => {
    const { result } = renderHook(() => useTableView(ROWS, options))
    act(() => result.current.setPage(3))
    expect(result.current.page).toBe(3)
    act(() => result.current.setSearch('row 2'))
    expect(result.current.page).toBe(1)
    // "2" is a word to find anywhere in the text, so Row 12 matches too.
    expect(result.current.matches.map((r) => r.name)).toEqual([
      'Row 2',
      'Row 12',
      'Row 20',
      'Row 21',
      'Row 22',
      'Row 23',
      'Row 24',
      'Row 25',
    ])
    expect(result.current.active).toBe(true)
  })

  it('filters, and combines a filter with a search', () => {
    const { result } = renderHook(() => useTableView(ROWS, options))
    act(() => result.current.setFilter('kind', 'b'))
    expect(result.current.matches.map((r) => r.name)).toEqual([
      'Row 1',
      'Row 6',
      'Row 11',
      'Row 16',
      'Row 21',
    ])
    act(() => result.current.setSearch('1'))
    expect(result.current.matches.map((r) => r.name)).toEqual([
      'Row 1',
      'Row 11',
      'Row 16',
      'Row 21',
    ])
    act(() => result.current.setSearch('21'))
    expect(result.current.matches.map((r) => r.name)).toEqual(['Row 21'])
  })

  it('treats the empty choice as "All"', () => {
    const { result } = renderHook(() => useTableView(ROWS, options))
    act(() => result.current.setFilter('kind', 'b'))
    act(() => result.current.setFilter('kind', ''))
    expect(result.current.matches).toHaveLength(25)
    expect(result.current.active).toBe(false)
  })

  it('clears everything at once', () => {
    const { result } = renderHook(() => useTableView(ROWS, options))
    act(() => {
      result.current.setSearch('row 9')
      result.current.setFilter('kind', 'a')
    })
    act(() => result.current.clear())
    expect(result.current.search).toBe('')
    expect(result.current.matches).toHaveLength(25)
    expect(result.current.active).toBe(false)
  })

  it('falls back to the last page when rows disappear', () => {
    const { result, rerender } = renderHook(({ items }) => useTableView(items, options), {
      initialProps: { items: ROWS },
    })
    act(() => result.current.setPage(3))
    expect(result.current.rows).toHaveLength(5)
    rerender({ items: ROWS.slice(0, 12) })
    expect(result.current.page).toBe(2)
    expect(result.current.rows).toHaveLength(2)
  })
})
