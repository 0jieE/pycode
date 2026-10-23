import type { MatchMode } from '@/api/types'

/** removed: only in the program's output. added: only in the expected output. */
export type DiffKind = 'same' | 'removed' | 'added'

export interface DiffLine {
  kind: DiffKind
  text: string
}

/** Beyond this many lines a full comparison is not worth it: compare line by line at the same position. */
const MAX_LINES_FOR_LCS = 400

function toLines(text: string, mode: MatchMode): string[] {
  const normal = text.replace(/\r\n/g, '\n')
  // Exact: like the server, one line break at the very end does not count.
  if (mode === 'exact') return (normal.endsWith('\n') ? normal.slice(0, -1) : normal).split('\n')
  const lines = normal.split('\n')
  // The same forgiving rules the server grades with: no trailing spaces, no trailing blank lines.
  const trimmed = lines.map((l) => l.replace(/ +$/, ''))
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop()
  return trimmed
}

const keyOf = (line: string, mode: MatchMode): string =>
  mode === 'ignore_case' ? line.toLowerCase() : line

/**
 * A line-by-line comparison of what the program printed with what was expected. Lines the match mode
 * treats as equal are `same` (so "Hello " against "Hello" is not flagged in the default mode).
 */
export function diffLines(actual: string, expected: string, mode: MatchMode = 'trim'): DiffLine[] {
  const a = toLines(actual, mode)
  const b = toLines(expected, mode)
  const same = (i: number, j: number) => keyOf(a[i]!, mode) === keyOf(b[j]!, mode)

  if (a.length > MAX_LINES_FOR_LCS || b.length > MAX_LINES_FOR_LCS) {
    const out: DiffLine[] = []
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i < a.length && i < b.length && same(i, i)) {
        out.push({ kind: 'same', text: a[i]! })
      } else {
        if (i < a.length) out.push({ kind: 'removed', text: a[i]! })
        if (i < b.length) out.push({ kind: 'added', text: b[i]! })
      }
    }
    return out
  }

  // Longest common subsequence of lines, then walk it to produce the diff.
  const width = b.length + 1
  const table = new Uint16Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = same(i, j)
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (same(i, j)) {
      out.push({ kind: 'same', text: a[i]! })
      i++
      j++
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      out.push({ kind: 'removed', text: a[i]! })
      i++
    } else {
      out.push({ kind: 'added', text: b[j]! })
      j++
    }
  }
  for (; i < a.length; i++) out.push({ kind: 'removed', text: a[i]! })
  for (; j < b.length; j++) out.push({ kind: 'added', text: b[j]! })
  return out
}

export const hasDifferences = (lines: readonly DiffLine[]): boolean =>
  lines.some((l) => l.kind !== 'same')
