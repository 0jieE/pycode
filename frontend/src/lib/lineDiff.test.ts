import { describe, expect, it } from 'vitest'
import { diffLines, hasDifferences } from './lineDiff'

const kinds = (a: string, e: string, mode?: Parameters<typeof diffLines>[2]) =>
  diffLines(a, e, mode).map((l) => `${l.kind[0]}:${l.text}`)

describe('diffLines', () => {
  it('marks identical text as all the same', () => {
    expect(diffLines('a\nb', 'a\nb').every((l) => l.kind === 'same')).toBe(true)
    expect(hasDifferences(diffLines('a\nb', 'a\nb'))).toBe(false)
  })

  it('shows a changed line as removed (yours) then added (expected)', () => {
    expect(kinds('1\n2\n3', '1\nX\n3')).toEqual(['s:1', 'r:2', 'a:X', 's:3'])
  })

  it('finds a missing line and an extra line', () => {
    expect(kinds('1\n3', '1\n2\n3')).toEqual(['s:1', 'a:2', 's:3'])
    expect(kinds('1\n2\n3', '1\n3')).toEqual(['s:1', 'r:2', 's:3'])
  })

  it('treats the default mode like the server: trailing spaces and blank lines do not count', () => {
    expect(hasDifferences(diffLines('hi  \nthere\n\n\n', 'hi\nthere'))).toBe(false)
  })

  it('exact mode notices them', () => {
    expect(hasDifferences(diffLines('hi \n', 'hi\n', 'exact'))).toBe(true)
    expect(hasDifferences(diffLines('hi\n\n', 'hi', 'exact'))).toBe(true)
  })

  it('exact mode, like the server, forgives one line break at the end (print() adds one)', () => {
    expect(hasDifferences(diffLines('Hello World\n', 'Hello World', 'exact'))).toBe(false)
  })

  it('ignore_case does not flag a difference in capitals only', () => {
    expect(hasDifferences(diffLines('HELLO', 'hello', 'ignore_case'))).toBe(false)
    expect(hasDifferences(diffLines('HELLO', 'hello', 'trim'))).toBe(true)
  })

  it('handles empty output', () => {
    expect(kinds('', 'a')).toEqual(['a:a'])
    expect(kinds('a', '')).toEqual(['r:a'])
  })

  it('still works for very long outputs (line by line)', () => {
    const big = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n')
    expect(hasDifferences(diffLines(big, big))).toBe(false)
    expect(hasDifferences(diffLines(big, big.replace('line 250', 'oops')))).toBe(true)
  })
})
