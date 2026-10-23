import type { Role } from '@/api/types'

/** The administrator's side-bar pages: the address of each role's users, and of each batch of codes. */

export const USER_ROLE_PAGES: { slug: string; role: Role; label: string }[] = [
  { slug: 'students', role: 'student', label: 'Students' },
  { slug: 'instructors', role: 'instructor', label: 'Instructors' },
  { slug: 'admins', role: 'admin', label: 'Administrators' },
]

/** "students" -> the student role; undefined (All users) or unknown -> null. */
export const roleOfSlug = (slug: string | undefined): Role | null =>
  USER_ROLE_PAGES.find((p) => p.slug === slug)?.role ?? null

export const codesOfBatch = (batch: string): string =>
  `/admin/registration-codes/${encodeURIComponent(batch)}`

export type LimitRole = 'student' | 'instructor'

export const STORAGE_ROLE_PAGES: { slug: string; role: LimitRole; label: string }[] = [
  { slug: 'students', role: 'student', label: 'Students' },
  { slug: 'instructors', role: 'instructor', label: 'Instructors' },
]
