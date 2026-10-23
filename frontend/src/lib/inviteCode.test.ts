import { describe, expect, it } from 'vitest'
import { inviteCodeStatus } from './inviteCode'

const now = Date.parse('2026-10-08T04:00:00Z')
const base = {
  is_active: true,
  valid_from: '2026-10-08T00:00:00Z',
  valid_until: '2026-10-09T00:00:00Z',
  max_uses: null,
  use_count: 0,
}

describe('inviteCodeStatus', () => {
  it('is Active inside the window', () => {
    expect(inviteCodeStatus(base, now)).toEqual({ label: 'Active', tone: 'ok' })
  })

  it('is Disabled whenever it is switched off, even if otherwise expired', () => {
    expect(
      inviteCodeStatus({ ...base, is_active: false, valid_until: '2026-01-01T00:00:00Z' }, now),
    ).toMatchObject({ label: 'Disabled' })
  })

  it('is Not yet valid before the window and Expired after it', () => {
    expect(inviteCodeStatus({ ...base, valid_from: '2026-10-08T05:00:00Z' }, now).label).toBe(
      'Not yet valid',
    )
    expect(inviteCodeStatus({ ...base, valid_until: '2026-10-08T03:59:59Z' }, now).label).toBe(
      'Expired',
    )
  })

  it('is Used up at max_uses, and unlimited when max_uses is null', () => {
    expect(inviteCodeStatus({ ...base, max_uses: 40, use_count: 40 }, now).label).toBe('Used up')
    expect(inviteCodeStatus({ ...base, max_uses: 40, use_count: 39 }, now).label).toBe('Active')
    expect(inviteCodeStatus({ ...base, max_uses: null, use_count: 9999 }, now).label).toBe('Active')
  })
})
