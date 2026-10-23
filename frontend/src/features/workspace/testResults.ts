/**
 * The result of a Test (or a Try) as the screens use it. The API types `test_results` as loose objects,
 * so this is the one place that reads them: anything missing or oddly typed gets a safe value.
 */
export interface TestCaseResult {
  caseId: number
  name: string
  hidden: boolean
  passed: boolean
  points: number
  pointsAwarded: number
  /**
   * ok, error (crashed), timeout, memory_exceeded, output_limit, input_not_read (it did not read all the case's
   * input: a hardcoded answer), requirement_failed (the code breaks the activity's requirements; every case).
   */
  status: string
  durationMs: number
  /** What the program printed. null for a hidden case when a student is looking (the server withholds it). */
  actualOutput: string | null
  /** The server's sentence for the student about why it failed, e.g. "...did not read all the input (read 0 of 2 values)." */
  message: string | null
  /** How many input lines the case gave, and how many the program read (null when not measured). */
  linesGiven: number | null
  linesRead: number | null
}

export interface TestTotals {
  passed: number
  total: number
  score: number
  maxScore: number
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

export function parseTestResults(
  raw: readonly Record<string, unknown>[] | null | undefined,
): TestCaseResult[] {
  return (raw ?? []).map((r): TestCaseResult => ({
    caseId: num(r.case_id, -1),
    name: typeof r.name === 'string' ? r.name : '',
    hidden: r.is_hidden !== false,
    passed: r.passed === true,
    points: num(r.points),
    pointsAwarded: num(r.points_awarded),
    status: typeof r.status === 'string' ? r.status : 'error',
    durationMs: num(r.duration_ms),
    actualOutput: typeof r.actual_output === 'string' ? r.actual_output : null,
    message: typeof r.message === 'string' && r.message.trim() ? r.message : null,
    linesGiven: typeof r.lines_given === 'number' ? r.lines_given : null,
    linesRead: typeof r.lines_read === 'number' ? r.lines_read : null,
  }))
}

export function totalsOf(results: readonly TestCaseResult[]): TestTotals {
  return {
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    score: results.reduce((sum, r) => sum + r.pointsAwarded, 0),
    maxScore: results.reduce((sum, r) => sum + r.points, 0),
  }
}

export const formatScore = (score: number, max: number): string => `${score}/${max}`

/** "Passed 2 of 3 tests · 2/3 pts" */
export function describeTotals(t: TestTotals): string {
  const noun = t.total === 1 ? 'test' : 'tests'
  return `Passed ${t.passed} of ${t.total} ${noun} · ${formatScore(t.score, t.maxScore)} pts`
}

export type BadgeTone = 'warn' | 'error'

/** The extra badge next to Pass/Fail when a case did not simply finish: why it was stopped. */
export function statusBadge(status: string): { label: string; tone: BadgeTone } | null {
  switch (status) {
    case 'timeout':
      return { label: 'Timeout', tone: 'warn' }
    case 'memory_exceeded':
      return { label: 'Memory', tone: 'warn' }
    case 'output_limit':
      return { label: 'Output limit', tone: 'warn' }
    case 'error':
      return { label: 'Error', tone: 'error' }
    case 'input_not_read':
      return { label: 'Input not read', tone: 'warn' }
    case 'requirement_failed':
      return { label: 'Requirements', tone: 'error' }
    default:
      return null
  }
}

/**
 * The one sentence for the whole result when the code breaks the activity's requirements: every case fails with
 * the same message, so it is said once, above the cases.
 */
export function requirementMessage(results: readonly TestCaseResult[]): string | null {
  return results.find((r) => r.status === 'requirement_failed')?.message ?? null
}

export interface MatchModeInfo {
  value: 'trim' | 'exact' | 'ignore_case' | 'contains'
  label: string
  /** One plain-English line, shown next to the choice. */
  help: string
}

export const MATCH_MODES: MatchModeInfo[] = [
  {
    value: 'trim',
    label: 'Trim',
    help: 'Ignores spaces at the end of each line and blank lines at the end. Everything else must match.',
  },
  {
    value: 'exact',
    label: 'Exact',
    help: 'Must match character for character: spaces, capitals and blank lines count. Only one line break at the very end is ignored.',
  },
  {
    value: 'ignore_case',
    label: 'Ignore case',
    help: 'Like Trim, and “Hello” equals “hello”.',
  },
  {
    value: 'contains',
    label: 'Contains',
    help: 'Passes if the expected text appears anywhere in the output.',
  },
]

export const matchModeLabel = (mode: string): string =>
  MATCH_MODES.find((m) => m.value === mode)?.label ?? mode
