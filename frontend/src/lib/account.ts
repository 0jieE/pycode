import type { ProfileUpdate, User } from '@/api/types'
import { USERNAME_PATTERN } from './registration'

export const FULL_NAME_MAX = 150
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

export interface ProfileForm {
  fullName: string
  username: string
}

export type ProfileErrors = Partial<Record<keyof ProfileForm, string>>

/** The user's own details as the form starts out. */
export const profileFormOf = (user: Pick<User, 'full_name' | 'username'>): ProfileForm => ({
  fullName: user.full_name,
  username: user.username,
})

/** What the server's own rules say, checked first so a mistake never costs a request. */
export function validateProfile(form: ProfileForm): ProfileErrors {
  const errors: ProfileErrors = {}
  const name = form.fullName.trim()
  if (name === '') errors.fullName = 'Enter your full name.'
  else if (name.length > FULL_NAME_MAX) {
    errors.fullName = `Your name can be at most ${FULL_NAME_MAX} characters.`
  }
  if (!USERNAME_PATTERN.test(form.username.trim())) {
    errors.username = 'Use 4–32 characters: lowercase letters, digits, dot (.) and underscore (_).'
  }
  return errors
}

/**
 * Only the fields that changed: the server refuses a request that carries anything it does not allow, and
 * sending today's values back would be pointless. Empty when nothing changed.
 */
export function changedProfileFields(
  user: Pick<User, 'full_name' | 'username'>,
  form: ProfileForm,
): ProfileUpdate {
  const body: ProfileUpdate = {}
  if (form.fullName.trim() !== user.full_name) body.full_name = form.fullName.trim()
  if (form.username.trim() !== user.username) body.username = form.username.trim()
  return body
}

export interface PasswordForm {
  current: string
  next: string
  confirm: string
}

export type PasswordErrors = Partial<Record<keyof PasswordForm, string>>

export function validatePasswordChange(form: PasswordForm): PasswordErrors {
  const errors: PasswordErrors = {}
  if (form.current === '') errors.current = 'Enter your current password.'
  if (form.next.length < PASSWORD_MIN) {
    errors.next = `The new password needs at least ${PASSWORD_MIN} characters.`
  } else if (form.next.length > PASSWORD_MAX) {
    errors.next = `The new password can be at most ${PASSWORD_MAX} characters.`
  } else if (form.current !== '' && form.next === form.current) {
    errors.next = 'The new password must be different from the current one.'
  }
  // Only compare once there is something to compare, so an empty box is not called a mismatch.
  if (!errors.next) {
    if (form.confirm === '') errors.confirm = 'Type the new password again.'
    else if (form.confirm !== form.next) errors.confirm = 'The two passwords do not match.'
  }
  return errors
}
