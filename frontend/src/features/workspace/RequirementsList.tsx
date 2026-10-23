import { ShieldCheck } from 'lucide-react'
import type { Requirements } from '@/api/types'
import { describeRequirements } from '@/lib/requirements'

/** The activity's code requirements, for the student, next to the instructions. Nothing when there are none. */
export function RequirementsList({
  requirements,
}: {
  requirements: Requirements | null | undefined
}) {
  const lines = describeRequirements(requirements)
  if (lines.length === 0) return null
  return (
    <section
      aria-label="Code requirements"
      className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm"
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <ShieldCheck aria-hidden className="size-4 text-ink-muted" />
        Requirements
      </p>
      <ul className="mt-1 list-disc pl-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-ink-muted">
        Checked when you press Test and when you submit: code that breaks one fails every test.
      </p>
    </section>
  )
}
