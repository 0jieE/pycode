import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'

/** "case A", "cases A and B", "cases A, B and C". */
function caseNames(tests: readonly string[]): string {
  if (tests.length === 1) return `hidden case ${tests[0]}`
  return `hidden cases ${tests.slice(0, -1).join(', ')} and ${tests[tests.length - 1]}`
}

/**
 * Grading found a hidden case's expected answer written in the code as text: a hint to look at the code, not a
 * verdict (the score is unchanged). Instructors only: for a student the fields are always null.
 */
export function HardcodeBadge({
  suspected,
  tests,
}: {
  suspected: boolean | null | undefined
  tests: readonly string[] | null | undefined
}) {
  if (!suspected) return null
  return (
    <span title={tests?.length ? `The code contains the answer of ${caseNames(tests)}` : undefined}>
      <Badge tone="warn">Possible hardcoded answer</Badge>
    </span>
  )
}

/** The same, said in full above a submission's code. */
export function HardcodeNotice({
  suspected,
  tests,
}: {
  suspected: boolean | null | undefined
  tests: readonly string[] | null | undefined
}) {
  if (!suspected) return null
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        <strong>Possible hardcoded answer.</strong>{' '}
        {tests?.length
          ? `The code contains the expected output of ${caseNames(tests)} as text.`
          : "The code contains a hidden case's expected output as text."}{' '}
        The score is not changed: read the code to decide.
      </span>
    </p>
  )
}
