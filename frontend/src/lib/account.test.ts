import { describe, expect, it } from 'vitest'
import {
  changedProfileFields,
  profileFormOf,
  validatePasswordChange,
  validateProfile,
} from './account'

const user = { full_name: 'Maria Santos', username: 'maria.s' }

describe('profile', () => {
  it('starts from the user', () => {
    expect(profileFormOf(user)).toEqual({ fullName: 'Maria Santos', username: 'maria.s' })
  })

  it('accepts what the server accepts', () => {
    expect(validateProfile({ fullName: ' Maria  Santos ', username: 'maria.s_1' })).toEqual({})
  })

  it('refuses an empty name, a long name and a bad username', () => {
    expect(validateProfile({ fullName: '   ', username: 'maria.s' }).fullName).toBeTruthy()
    expect(
      validateProfile({ fullName: 'x'.repeat(151), username: 'maria.s' }).fullName,
    ).toBeTruthy()
    expect(validateProfile({ fullName: 'M', username: 'abc' }).username).toBeTruthy()
    expect(validateProfile({ fullName: 'M', username: 'Maria.S' }).username).toBeTruthy()
    expect(validateProfile({ fullName: 'M', username: 'has space' }).username).toBeTruthy()
    expect(validateProfile({ fullName: 'M', username: 'a'.repeat(33) }).username).toBeTruthy()
  })

  it('sends only what changed', () => {
    expect(changedProfileFields(user, { fullName: 'Maria Santos', username: 'maria.s' })).toEqual(
      {},
    )
    expect(changedProfileFields(user, { fullName: 'Maria S. Cruz', username: 'maria.s' })).toEqual({
      full_name: 'Maria S. Cruz',
    })
    expect(changedProfileFields(user, { fullName: 'Maria Santos', username: 'maria2' })).toEqual({
      username: 'maria2',
    })
    expect(
      changedProfileFields(user, { fullName: ' Maria Santos ', username: ' maria.s ' }),
    ).toEqual({})
  })
})

describe('password change', () => {
  const ok = { current: 'old-password', next: 'new-password-1', confirm: 'new-password-1' }

  it('accepts a good change', () => {
    expect(validatePasswordChange(ok)).toEqual({})
  })

  it('needs the current password', () => {
    expect(validatePasswordChange({ ...ok, current: '' }).current).toBeTruthy()
  })

  it('keeps the new password between 8 and 128 characters', () => {
    expect(validatePasswordChange({ ...ok, next: 'short', confirm: 'short' }).next).toBeTruthy()
    const long = 'x'.repeat(129)
    expect(validatePasswordChange({ ...ok, next: long, confirm: long }).next).toBeTruthy()
    const max = 'x'.repeat(128)
    expect(validatePasswordChange({ ...ok, next: max, confirm: max })).toEqual({})
  })

  it('refuses the same password without asking the server', () => {
    const same = { current: 'same-password', next: 'same-password', confirm: 'same-password' }
    expect(validatePasswordChange(same).next).toMatch(/different/)
  })

  it('makes the new password be typed twice', () => {
    expect(validatePasswordChange({ ...ok, confirm: '' }).confirm).toBe(
      'Type the new password again.',
    )
    expect(validatePasswordChange({ ...ok, confirm: 'other-password' }).confirm).toMatch(
      /do not match/,
    )
  })

  it('does not call an empty confirmation a mismatch while the new password is wrong', () => {
    const errors = validatePasswordChange({ ...ok, next: 'short', confirm: '' })
    expect(errors.next).toBeTruthy()
    expect(errors.confirm).toBeUndefined()
  })
})
