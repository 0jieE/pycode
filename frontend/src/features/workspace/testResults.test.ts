import { describe, expect, it } from 'vitest'
import {
  describeTotals,
  formatScore,
  matchModeLabel,
  parseTestResults,
  requirementMessage,
  statusBadge,
  totalsOf,
} from './testResults'

describe('parseTestResults', () => {
  it('reads what the server sends', () => {
    const [r] = parseTestResults([
      {
        case_id: 5,
        name: 'adds',
        is_hidden: false,
        passed: true,
        points: 3,
        points_awarded: 3,
        status: 'ok',
        duration_ms: 12,
        actual_output: '4\n',
      },
    ])
    expect(r).toEqual({
      caseId: 5,
      name: 'adds',
      hidden: false,
      passed: true,
      points: 3,
      pointsAwarded: 3,
      status: 'ok',
      durationMs: 12,
      actualOutput: '4\n',
      message: null,
      linesGiven: null,
      linesRead: null,
    })
  })

  it('reads why a case failed: input not read, or the requirements', () => {
    const results = parseTestResults([
      {
        case_id: 1,
        passed: false,
        status: 'input_not_read',
        message: 'Your program did not read all the input (read 0 of 2 values).',
        lines_given: 2,
        lines_read: 0,
      },
      { case_id: 2, passed: false, status: 'requirement_failed', message: 'Define average().' },
    ])
    expect(results[0]).toMatchObject({ linesGiven: 2, linesRead: 0, status: 'input_not_read' })
    expect(results[0]!.message).toMatch(/read 0 of 2/)
    expect(requirementMessage(results)).toBe('Define average().')
    expect(requirementMessage(results.slice(0, 1))).toBeNull()
  })

  it('treats a case as hidden unless it says otherwise, and withheld output as null', () => {
    const [r] = parseTestResults([{ case_id: 1, passed: false, actual_output: null }])
    expect(r?.hidden).toBe(true)
    expect(r?.actualOutput).toBeNull()
    expect(r?.status).toBe('error')
  })

  it('copes with nothing', () => {
    expect(parseTestResults(null)).toEqual([])
    expect(parseTestResults(undefined)).toEqual([])
  })
})

describe('totals and labels', () => {
  const results = parseTestResults([
    { case_id: 1, passed: true, points: 2, points_awarded: 2 },
    { case_id: 2, passed: false, points: 1, points_awarded: 0 },
    { case_id: 3, passed: true, points: 2, points_awarded: 2 },
  ])

  it('adds up passes and points', () => {
    expect(totalsOf(results)).toEqual({ passed: 2, total: 3, score: 4, maxScore: 5 })
  })

  it('words the header the way the results card shows it', () => {
    expect(describeTotals(totalsOf(results))).toBe('Passed 2 of 3 tests · 4/5 pts')
    expect(describeTotals({ passed: 1, total: 1, score: 1, maxScore: 1 })).toBe(
      'Passed 1 of 1 test · 1/1 pts',
    )
  })

  it('formats a score', () => {
    expect(formatScore(7, 10)).toBe('7/10')
  })

  it('gives a badge to the ways a case can be stopped', () => {
    expect(statusBadge('timeout')?.label).toBe('Timeout')
    expect(statusBadge('memory_exceeded')?.label).toBe('Memory')
    expect(statusBadge('output_limit')?.label).toBe('Output limit')
    expect(statusBadge('error')?.label).toBe('Error')
    expect(statusBadge('input_not_read')?.label).toBe('Input not read')
    expect(statusBadge('requirement_failed')?.label).toBe('Requirements')
    expect(statusBadge('ok')).toBeNull()
  })

  it('names the match modes', () => {
    expect(matchModeLabel('ignore_case')).toBe('Ignore case')
    expect(matchModeLabel('trim')).toBe('Trim')
  })
})
