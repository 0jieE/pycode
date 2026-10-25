/** The administrator's side-bar pages: the address of each role's users, and of each batch of codes. */

/** The accounts the administrator manages (the administrator is the only admin and is not listed). */
export type ManagedRole = 'instructor' | 'student'

export const USER_ROLE_PAGES: { slug: string; role: ManagedRole; label: string }[] = [
  { slug: 'instructors', role: 'instructor', label: 'Instructors' },
  { slug: 'students', role: 'student', label: 'Students' },
]

/** "students" -> the student role; anything else -> null (the page then goes to the students). */
export const roleOfSlug = (slug: string | undefined): ManagedRole | null =>
  USER_ROLE_PAGES.find((p) => p.slug === slug)?.role ?? null

export const codesOfBatch = (batch: string): string =>
  `/admin/registration-codes/${encodeURIComponent(batch)}`

export type LimitRole = 'student' | 'instructor'

export const STORAGE_ROLE_PAGES: { slug: string; role: LimitRole; label: string }[] = [
  { slug: 'students', role: 'student', label: 'Students' },
  { slug: 'instructors', role: 'instructor', label: 'Instructors' },
]
