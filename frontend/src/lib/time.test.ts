import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatDateTime,
  isoToManilaInput,
  manilaInputFromNow,
  manilaInputToIso,
  timeAgo,
} from './time'

describe('formatDateTime', () => {
  it('shows UTC timestamps in Manila time (UTC+8)', () => {
    expect(formatDateTime('2026-10-08T00:30:00Z')).toBe('Oct 8, 2026, 8:30 AM')
  })

  it('rolls over to the next day in Manila', () => {
    expect(formatDateTime('2026-10-08T17:00:00.123456Z')).toBe('Oct 9, 2026, 1:00 AM')
    expect(formatDate('2026-10-08T17:00:00Z')).toBe('Oct 9, 2026')
  })

  it('returns an empty string for garbage instead of "Invalid Date"', () => {
    expect(formatDateTime('not a date')).toBe('')
  })
})

describe('timeAgo', () => {
  const now = Date.parse('2026-10-08T12:00:00Z')

  it.each([
    ['2026-10-08T11:59:30Z', 'just now'],
    ['2026-10-08T11:55:00Z', '5 min ago'],
    ['2026-10-08T09:00:00Z', '3 h ago'],
    ['2026-10-06T12:00:00Z', '2 d ago'],
  ])('%s -> %s', (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected)
  })

  it('never goes negative when the clocks differ slightly', () => {
    expect(timeAgo('2026-10-08T12:00:05Z', now)).toBe('just now')
  })
})

describe('datetime-local helpers (always Manila time)', () => {
  it('reads an input value as Manila time and returns UTC', () => {
    expect(manilaInputToIso('2026-10-08T08:30')).toBe('2026-10-08T00:30:00.000Z')
    expect(manilaInputToIso('2026-10-08T00:15')).toBe('2026-10-07T16:15:00.000Z')
  })

  it('rejects empty or malformed values', () => {
    expect(manilaInputToIso('')).toBeNull()
    expect(manilaInputToIso('2026-10-08')).toBeNull()
    expect(manilaInputToIso('2026-13-45T99:99')).toBeNull()
  })

  it('round-trips through the picker format', () => {
    const iso = '2026-10-08T17:00:00.000Z'
    expect(isoToManilaInput(iso)).toBe('2026-10-09T01:00')
    expect(manilaInputToIso(isoToManilaInput(iso))).toBe(iso)
  })

  it('builds "now + minutes" in Manila time', () => {
    const now = Date.parse('2026-10-08T00:00:00Z')
    expect(manilaInputFromNow(0, now)).toBe('2026-10-08T08:00')
    expect(manilaInputFromNow(40, now)).toBe('2026-10-08T08:40')
  })
})
