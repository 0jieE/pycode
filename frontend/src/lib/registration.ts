/**
 * Helpers for self sign-up and the admin's registration codes. As everywhere in the client, these
 * are friendly pre-checks only: the backend decides.
 */

export const CODE_LENGTH = 10
const GROUP = 5

/**
 * What the code box shows for whatever was typed or pasted: capitals only, letters and digits only,
 * at most 10 of them, with a dash after the fifth ("abcde fghjk" -> "ABCDE-FGHJK"). The server
 * ignores case, spaces and dashes, so pasting a code with any of those works.
 */
export function formatCodeInput(raw: string): string {
  const clean = raw
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, CODE_LENGTH)
  return clean.length > GROUP ? `${clean.slice(0, GROUP)}-${clean.slice(GROUP)}` : clean
}

export const isCompleteCode = (formatted: string): boolean =>
  formatted.replace('-', '').length === CODE_LENGTH

/**
 * An unused code is listed by its last 4 characters only. It sits at the end of the code, so the rest
 * is hidden in the same positions as in XXXXX-XXXXX: `•••••-•AB3K`.
 */
export function maskedCode(hint: string): string {
  return `${'•'.repeat(GROUP)}-${'•'.repeat(CODE_LENGTH - GROUP - hint.length)}${hint}`
}

// ------------------------------------------------------------------ the sign-up form

export interface SignupForm {
  code: string
  studentNo: string
  fullName: string
  username: string
  password: string
  confirm: string
}

export type SignupErrors = Partial<Record<keyof SignupForm, string>>

export const USERNAME_PATTERN = /^[a-z0-9._]{4,32}$/
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

/** What is wrong with the form, field by field (empty object = ready to send). */
export function validateSignup(form: SignupForm): SignupErrors {
  const errors: SignupErrors = {}
  if (!isCompleteCode(form.code)) errors.code = 'Enter the full 10-character registration code.'
  if (!form.studentNo.trim()) errors.studentNo = 'Enter your student number.'
  else if (form.studentNo.trim().length > 32) errors.studentNo = 'Use at most 32 characters.'
  if (!form.fullName.trim()) errors.fullName = 'Enter your full name.'
  else if (form.fullName.trim().length > 150) errors.fullName = 'Use at most 150 characters.'

  if (!USERNAME_PATTERN.test(form.username.trim())) {
    errors.username = 'Use 4–32 characters: lowercase letters, digits, dot (.) and underscore (_).'
  }
  if (form.password.length < PASSWORD_MIN) {
    errors.password = `Use at least ${PASSWORD_MIN} characters.`
  } else if (form.password.length > PASSWORD_MAX) {
    errors.password = `Use at most ${PASSWORD_MAX} characters.`
  }
  // Only once the password itself is acceptable: nagging about the copy of a bad password helps no one.
  if (!errors.password) {
    if (!form.confirm) errors.confirm = 'Type the password again.'
    else if (form.confirm !== form.password) errors.confirm = 'The two passwords do not match.'
  }
  return errors
}

// ------------------------------------------------------------------ the codes just generated

/**
 * One CSV field. Quotes are doubled and the field is quoted when needed. A value that a spreadsheet
 * would run as a formula (starts with = + - @) gets a leading apostrophe, because batch names are typed by
 * people and the file is meant to be opened in Excel.
 */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The download: `code, batch, student_no`, one row per code. Starts with a BOM so Excel reads UTF-8. */
export function registrationCodesCsv(
  codes: readonly string[],
  batch: string,
  studentNo: string | null,
): string {
  const rows = codes.map((c) => [c, batch, studentNo ?? ''].map(csvField).join(','))
  return '﻿' + ['code,batch,student_no', ...rows].join('\r\n') + '\r\n'
}

/** A file name safe on Windows for the download. */
export function csvFileName(batch: string): string {
  const slug = batch
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `registration-codes-${slug || 'batch'}.csv`
}

/** Slips per printed A4 page. */
export const SLIPS_PER_PAGE = 10

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size))
  return pages
}
