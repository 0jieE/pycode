import { describe, expect, it } from 'vitest'
import { extendedEnd, hasEnded, isRunning, msLeft, tickFor, tooEarly } from './labSession'
import { formatCountdown, formatTimeOfDay, isToday } from './time'

const at = (iso: string) => new Date(iso).getTime()
const session = { is_open: true, ends_at: '2026-10-12T03:00:00Z' } // 11:00 AM in Manila

describe('a lab session and its end time', () => {
  it('runs until its end, even while is_open still says true after it', () => {
    expect(isRunning(session, at('2026-10-12T02:59:59Z'))).toBe(true)
    expect(hasEnded(session, at('2026-10-12T03:00:00Z'))).toBe(true)
    expect(isRunning(session, at('2026-10-12T03:00:05Z'))).toBe(false)
    expect(isRunning({ ...session, is_open: false }, at('2026-10-12T02:00:00Z'))).toBe(false)
  })

  it('extends by 30 minutes from the end, or from now once the end has passed', () => {
    expect(extendedEnd(session, at('2026-10-12T02:50:00Z'))).toBe('2026-10-12T03:30:00.000Z')
    expect(extendedEnd(session, at('2026-10-12T03:10:00Z'))).toBe('2026-10-12T03:40:00.000Z')
  })

  it('ticks every second only near the end', () => {
    expect(tickFor(session, at('2026-10-12T02:00:00Z'))).toBe(15_000)
    expect(tickFor(session, at('2026-10-12T02:52:00Z'))).toBe(1000)
    expect(tickFor(null, 0)).toBe(15_000)
    expect(msLeft(session, at('2026-10-12T02:59:00Z'))).toBe(60_000)
  })

  it('cannot be opened until 15 minutes before its start', () => {
    const later = { starts_at: '2026-10-19T00:00:00Z' } // Oct 19, 8:00 AM in Manila
    expect(tooEarly(later, at('2026-10-14T00:00:00Z'))).toBe(true)
    expect(tooEarly(later, at('2026-10-18T23:44:00Z'))).toBe(true)
    expect(tooEarly(later, at('2026-10-18T23:45:00Z'))).toBe(false)
    expect(tooEarly(later, at('2026-10-19T01:00:00Z'))).toBe(false)
  })

  it('knows "today" in Manila time', () => {
    // 11 PM in Manila on Oct 12 is 3 PM UTC: still Oct 12 there.
    expect(isToday('2026-10-12T15:00:00Z', at('2026-10-12T01:00:00Z'))).toBe(true)
    expect(isToday('2026-10-12T16:30:00Z', at('2026-10-12T01:00:00Z'))).toBe(false)
  })

  it('words the time', () => {
    expect(formatTimeOfDay('2026-10-12T03:00:00Z')).toBe('11:00 AM')
    expect(formatCountdown(545_000)).toBe('9:05')
    expect(formatCountdown(3_725_000)).toBe('1:02:05')
    expect(formatCountdown(-5)).toBe('0:00')
    expect(formatCountdown(400)).toBe('0:01')
  })
})
