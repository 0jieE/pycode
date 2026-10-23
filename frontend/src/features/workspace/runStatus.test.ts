import { describe, expect, it } from 'vitest'
import { describeResult, isFinal } from './runStatus'

describe('describeResult', () => {
  it('ok is green with the time and exit code', () => {
    expect(describeResult({ status: 'ok', exitCode: 0, durationMs: 1234 })).toEqual({
      tone: 'ok',
      text: 'Finished in 1234 ms (exit 0)',
    })
  })

  it('error is red and names the exit code', () => {
    expect(describeResult({ status: 'error', exitCode: 1, durationMs: 80 })).toEqual({
      tone: 'error',
      text: 'Exited with code 1',
    })
    expect(describeResult({ status: 'error', exitCode: null, durationMs: null }).text).toMatch(
      /stopped with an error/,
    )
  })

  it.each([
    ['timeout', /more than 10 seconds/],
    ['memory_exceeded', /more memory/],
    ['output_limit', /printed too much/],
  ] as const)('%s is amber with a plain-English reason', (status, reason) => {
    const d = describeResult({ status, exitCode: null, durationMs: 10_000 })
    expect(d.tone).toBe('warn')
    expect(d.text).toMatch(reason)
  })

  it('system_error says it is the server, not the student', () => {
    expect(describeResult({ status: 'system_error', exitCode: null, durationMs: null })).toEqual({
      tone: 'error',
      text: 'Server problem, try again',
    })
  })
})

describe('isFinal', () => {
  it('is false only while queued or running', () => {
    expect(isFinal('queued')).toBe(false)
    expect(isFinal('running')).toBe(false)
    for (const s of ['ok', 'error', 'timeout', 'memory_exceeded', 'output_limit', 'system_error']) {
      expect(isFinal(s)).toBe(true)
    }
  })
})
