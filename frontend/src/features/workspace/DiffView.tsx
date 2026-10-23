import type { MatchMode } from '@/api/types'
import { diffLines, hasDifferences, type DiffKind } from '@/lib/lineDiff'

const LINE_STYLE: Record<DiffKind, string> = {
  same: 'text-ink-muted',
  removed: 'bg-error-soft text-error',
  added: 'bg-ok-soft text-ok',
}
const MARK: Record<DiffKind, string> = { same: ' ', removed: '−', added: '+' }
const MARK_LABEL: Record<DiffKind, string> = {
  same: '',
  removed: 'Your output: ',
  added: 'Expected: ',
}

/** The program's output against the expected output, line by line; the lines that differ are coloured. */
export function DiffView({
  actual,
  expected,
  mode,
}: {
  actual: string
  expected: string
  mode: MatchMode
}) {
  if (mode === 'contains') {
    return (
      <p className="text-xs text-ink-muted">
        This test passes when the expected text appears anywhere in your output, so there is no
        line-by-line comparison.
      </p>
    )
  }
  const lines = diffLines(actual, expected, mode)
  if (!hasDifferences(lines)) {
    return <p className="text-xs text-ok">The output matches, line for line.</p>
  }
  return (
    <div>
      <p className="mb-1 text-xs text-ink-muted">
        <span className="font-mono text-error">−</span> your output{' · '}
        <span className="font-mono text-ok">+</span> expected
      </p>
      <pre
        aria-label="Differences between your output and the expected output"
        className="max-h-60 overflow-auto rounded border border-line bg-canvas py-1 font-mono text-xs leading-relaxed"
      >
        {lines.map((l, i) => (
          <div key={i} className={`flex whitespace-pre-wrap ${LINE_STYLE[l.kind]}`}>
            <span aria-hidden className="w-5 shrink-0 text-center select-none">
              {MARK[l.kind]}
            </span>
            <span className="sr-only">{MARK_LABEL[l.kind]}</span>
            <span className="min-w-0 flex-1 break-words">{l.text === '' ? ' ' : l.text}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}
