import { useState, type ReactNode } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Loader2,
  XCircle,
} from 'lucide-react'
import type { StudentCase, StudentCaseSample } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { DiffView } from './DiffView'
import { isBusy } from './runStore'
import {
  describeTotals,
  formatScore,
  matchModeLabel,
  requirementMessage,
  statusBadge,
  type TestCaseResult,
} from './testResults'
import type { TestState } from './testStore'

interface TestResultsPanelProps {
  state: TestState
  /** The cases the student may see for this activity (a hidden one is only a name and points). */
  cases: readonly StudentCase[]
  /** The panel's tab strip, drawn in the header. */
  tabs: ReactNode
  /** What it says before the first test (default: the activity's wording, "Press Test..."). */
  idleText?: string
}

// A visible case carries its input and expected output; a hidden one is only a name and points.
// (Not read from is_hidden: the generated type spells it as a string, the server sends a boolean.)
const isSample = (c: StudentCase): c is StudentCaseSample => 'stdin' in c

/** The Test button's result, as a card: a header with the totals, then one row per test case. */
export function TestResultsPanel({ state, cases, tabs, idleText }: TestResultsPanelProps) {
  const busy = isBusy(state.phase)
  const results = state.phase === 'finished' ? state.results : null
  const totals = state.totals
  const allPassed = totals !== null && totals.passed === totals.total

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line bg-canvas text-ink">
      <div className="px-3">{tabs}</div>
      <div
        role="tabpanel"
        aria-labelledby="panel-tab-tests"
        className="min-h-0 flex-1 overflow-auto px-3 pt-2 pb-3"
      >
        {results && totals ? (
          <section
            aria-label="Test results"
            className="overflow-hidden rounded-md border border-line"
          >
            <h3
              role="status"
              className={`flex items-center justify-between gap-2 px-3 py-2 text-sm font-semibold ${
                allPassed ? 'bg-ok-soft text-ok' : 'bg-error-soft text-error'
              }`}
            >
              {describeTotals(totals)}
            </h3>
            {requirementMessage(results) && (
              <p
                role="alert"
                className="border-b border-line bg-error-soft/40 px-3 py-2 text-sm text-error"
              >
                {requirementMessage(results)}
              </p>
            )}
            <ul className="divide-y divide-line bg-surface">
              {results.map((r, i) => (
                <ResultRow
                  key={`${r.caseId}-${i}`}
                  index={i + 1}
                  result={r}
                  sample={
                    cases.find((c) => c.id === r.caseId && isSample(c)) as
                      StudentCaseSample | undefined
                  }
                />
              ))}
            </ul>
          </section>
        ) : busy ? (
          <PendingList state={state} cases={cases} />
        ) : (
          <p className="text-sm text-ink-muted">
            {state.notice
              ? state.notice.text
              : idleText
                ? idleText
                : cases.length === 0
                  ? 'This activity has no tests.'
                  : `Press Test to check your work. This activity has ${cases.length} ${cases.length === 1 ? 'test' : 'tests'}${
                      cases.some((c) => !isSample(c))
                        ? `, ${cases.filter((c) => !isSample(c)).length} of them hidden`
                        : ''
                    }.`}
          </p>
        )}
      </div>
    </div>
  )
}

function PendingList({ state, cases }: { state: TestState; cases: readonly StudentCase[] }) {
  const label =
    state.phase === 'saving'
      ? 'Saving your files…'
      : state.phase === 'queued'
        ? `Queued — #${state.queuePosition ?? '?'}`
        : 'Running the tests…'
  return (
    <section
      aria-label="Test results"
      aria-busy="true"
      className="overflow-hidden rounded-md border border-line"
    >
      <h3
        role="status"
        className="flex items-center gap-2 bg-open-soft px-3 py-2 text-sm font-semibold text-open"
      >
        <Loader2 aria-hidden className="size-4 animate-spin" />
        {label}
      </h3>
      <ul className="divide-y divide-line bg-surface">
        {cases.map((c, i) => {
          const live = state.live[c.id]
          return (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>{isSample(c) ? `Test Case #${i + 1}` : 'Hidden test'}</span>
              {live ? (
                <Verdict passed={live.passed} />
              ) : (
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <CircleDashed aria-hidden className="size-4" />
                  Waiting
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Verdict({ passed }: { passed: boolean }) {
  return passed ? (
    <span className="flex items-center gap-1.5 font-medium text-ok">
      <CheckCircle2 aria-hidden className="size-4" />
      Pass
    </span>
  ) : (
    <span className="flex items-center gap-1.5 font-medium text-error">
      <XCircle aria-hidden className="size-4" />
      Fail
    </span>
  )
}

function ResultRow({
  index,
  result: r,
  sample,
}: {
  index: number
  result: TestCaseResult
  sample: StudentCaseSample | undefined
}) {
  const [open, setOpen] = useState(false)
  const badge = statusBadge(r.status)
  const points = `${formatScore(r.pointsAwarded, r.points)} pts`
  // The server's own sentence, under the failed case (a requirement message is said once, above the list).
  const message =
    !r.passed && r.message && r.status !== 'requirement_failed' ? (
      <p className="px-3 pb-2 pl-8 text-xs text-warn">{r.message}</p>
    ) : null

  // A hidden test reveals nothing but its verdict (and the server's message, which gives nothing away).
  if (r.hidden) {
    return (
      <li>
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
          <span className="flex items-center gap-2">
            <span className="font-medium">Hidden test — {r.passed ? 'Pass' : 'Fail'}</span>
            {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
          </span>
          <span className="flex items-center gap-3">
            <span className="text-xs text-ink-muted">{points}</span>
            <Verdict passed={r.passed} />
          </span>
        </div>
        {message}
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-hover"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {open ? (
            <ChevronDown aria-hidden className="size-3.5 shrink-0" />
          ) : (
            <ChevronRight aria-hidden className="size-3.5 shrink-0" />
          )}
          <span className="font-medium">Test Case #{index}</span>
          {r.name && <span className="truncate text-ink-muted">{r.name}</span>}
          {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-ink-muted">{points}</span>
          <Verdict passed={r.passed} />
        </span>
      </button>
      {message}
      {open && (
        <div className="flex flex-col gap-3 border-t border-line bg-canvas px-3 py-3">
          {sample && <Block label="Input" text={sample.stdin} empty="(no input)" />}
          <Block label="Your output" text={r.actualOutput ?? ''} empty="(nothing was printed)" />
          {sample && (
            <>
              <Block label="Expected output" text={sample.expected_output} empty="(nothing)" />
              <p className="text-xs text-ink-muted">
                Compared with:{' '}
                <strong className="text-ink">{matchModeLabel(sample.match_mode)}</strong>
              </p>
              {!r.passed && (
                <DiffView
                  actual={r.actualOutput ?? ''}
                  expected={sample.expected_output}
                  mode={sample.match_mode}
                />
              )}
            </>
          )}
          {!r.passed && r.status !== 'ok' && !r.message && (
            <p className="text-xs text-warn">{statusExplanation(r.status)}</p>
          )}
        </div>
      )}
    </li>
  )
}

function statusExplanation(status: string): string {
  switch (status) {
    case 'timeout':
      return 'The program ran for more than 5 seconds on this test. Look for a loop that never ends.'
    case 'memory_exceeded':
      return 'The program used more memory than a test is allowed.'
    case 'output_limit':
      return 'The program printed too much on this test (over 16 KB).'
    case 'input_not_read':
      return 'The program did not read all the input of this test: it has to work with the input it is given.'
    case 'requirement_failed':
      return "The code does not meet the activity's requirements."
    default:
      return 'The program stopped with an error on this test, so it counts as a fail.'
  }
}

function Block({ label, text, empty }: { label: string; text: string; empty: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">{label}</p>
      <pre className="max-h-40 overflow-auto rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
        {text === '' ? <span className="text-ink-muted">{empty}</span> : text}
      </pre>
    </div>
  )
}
