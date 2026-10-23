import type { MatchMode } from '@/api/types'

/** One test case as a form holds it (an activity's case, or a tutorial exercise's test). */
export interface CaseFormState {
  name: string
  stdin: string
  expected: string
  hidden: boolean
  points: string
  mode: MatchMode
  /**
   * The case passes only if the program read all of its input (catches a hardcoded answer). Activity cases only:
   * absent for the tutorial's tests, which have no such option.
   */
  readAll?: boolean
}

export type CaseFormErrors = Partial<Record<keyof CaseFormState, string>>

const MAX_TEXT_BYTES = 20 * 1024
const bytes = (text: string) => new TextEncoder().encode(text).length

/** The same rules the server applies, checked first for quick, friendly messages. */
export function validateCaseForm(form: CaseFormState): CaseFormErrors {
  const found: CaseFormErrors = {}
  if (form.name.trim() === '') found.name = 'Give the test case a name.'
  const points = Number(form.points)
  if (form.points.trim() === '' || !Number.isInteger(points) || points < 0 || points > 1000) {
    found.points = 'Enter a whole number of points, 0 or more.'
  }
  if (bytes(form.stdin) > MAX_TEXT_BYTES) found.stdin = 'The input is too long (20 KB at most).'
  if (bytes(form.expected) > MAX_TEXT_BYTES) {
    found.expected = 'The expected output is too long (20 KB at most).'
  }
  if (form.mode === 'contains' && form.expected.trim() === '') {
    found.expected = 'Contains needs the text that must appear in the output.'
  }
  return found
}
