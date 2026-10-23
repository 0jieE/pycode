import { describe, expect, it } from 'vitest'
import type { LabBooking } from '@/api/types'
import {
  dayKey,
  dayLabel,
  formatMinutes,
  formatSpan,
  freeAfter,
  minuteOfDay,
  scheduleByDay,
} from './labSchedule'

/** A booking from Manila times ("2026-10-19T08:00" means 8:00 AM school time). */
const booking = (id: number, from: string, to: string): LabBooking => ({
  session_id: id,
  name: `Week ${id}`,
  starts_at: new Date(`${from}:00+08:00`).toISOString(),
  ends_at: new Date(`${to}:00+08:00`).toISOString(),
  is_open: false,
  class: { id: 1, name: 'CC 101', year_and_section: 'BSIT 1A' },
  instructor: { id: 2, full_name: 'Prof. Marquez' },
  mine: false,
})

describe('a lab schedule by day', () => {
  it('reads school time', () => {
    const t = new Date('2026-10-18T23:30:00Z').getTime() // 7:30 AM, Oct 19 in Manila
    expect(dayKey(t)).toBe('2026-10-19')
    expect(minuteOfDay(t)).toBe(7 * 60 + 30)
    expect(formatMinutes(13 * 60 + 5)).toBe('1:05 PM')
    expect(formatMinutes(0)).toBe('12:00 AM')
    expect(formatMinutes(12 * 60)).toBe('12:00 PM')
  })

  it('names the days', () => {
    const now = new Date('2026-10-14T02:00:00Z').getTime() // Oct 14, 10 AM
    expect(dayLabel('2026-10-14', now)).toBe('Today')
    expect(dayLabel('2026-10-15', now)).toBe('Tomorrow')
    expect(dayLabel('2026-10-19', now)).toBe('Monday, Oct 19')
  })

  it('groups by day, in order, with the free time between bookings', () => {
    const days = scheduleByDay([
      booking(2, '2026-10-19T13:00', '2026-10-19T16:00'),
      booking(1, '2026-10-19T08:00', '2026-10-19T11:00'),
      booking(3, '2026-10-15T09:00', '2026-10-15T10:00'),
    ])
    expect(days.map((d) => d.key)).toEqual(['2026-10-15', '2026-10-19'])
    const monday = days[1]!
    expect(monday.slots.map((s) => s.booking.session_id)).toEqual([1, 2])
    expect(monday.free.map((f) => [formatMinutes(f.start), formatMinutes(f.end)])).toEqual([
      ['7:00 AM', '8:00 AM'],
      ['11:00 AM', '1:00 PM'],
      ['4:00 PM', '9:00 PM'],
    ])
  })

  it('back-to-back bookings leave no gap, and short gaps are not listed', () => {
    const [day] = scheduleByDay([
      booking(1, '2026-10-19T07:00', '2026-10-19T10:00'),
      booking(2, '2026-10-19T10:00', '2026-10-19T12:00'),
      booking(3, '2026-10-19T12:10', '2026-10-19T21:00'),
    ])
    expect(day!.free).toEqual([])
  })

  it('shows a session past midnight on both days', () => {
    const days = scheduleByDay([booking(1, '2026-10-19T20:00', '2026-10-20T01:00')])
    expect(days.map((d) => d.key)).toEqual(['2026-10-19', '2026-10-20'])
    expect(days[0]!.slots[0]).toMatchObject({ start: 20 * 60, end: 24 * 60, intoNext: true })
    expect(days[1]!.slots[0]).toMatchObject({ start: 0, end: 60, fromBefore: true })
  })

  it('counts free time today from now on', () => {
    const free = [
      { start: 7 * 60, end: 8 * 60 },
      { start: 11 * 60, end: 13 * 60 },
    ]
    expect(freeAfter(free, 11 * 60 + 52)).toEqual([{ start: 11 * 60 + 55, end: 13 * 60 }])
    expect(freeAfter(free, 12 * 60 + 50)).toEqual([])
    expect(formatSpan(90)).toBe('1 h 30 min')
    expect(formatSpan(45)).toBe('45 min')
  })
})
