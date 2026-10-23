import { describe, expect, it } from 'vitest'
import {
  expectEcho,
  formatCountdown,
  noEchoes,
  promptOf,
  segmentOutput,
  shiftEchoes,
  trackEcho,
} from './interactive'

describe('promptOf', () => {
  it('is the last unfinished line', () => {
    expect(promptOf('Enter first number: ')).toBe('Enter first number: ')
    expect(promptOf('Hello\nEnter second number: ')).toBe('Enter second number: ')
  })

  it('is empty when the program asked without a prompt', () => {
    expect(promptOf('')).toBe('')
    expect(promptOf('done\n')).toBe('')
  })
})

describe('formatCountdown', () => {
  it('shows minutes and seconds', () => {
    expect(formatCountdown(120_000)).toBe('2:00')
    expect(formatCountdown(105_000)).toBe('1:45')
    expect(formatCountdown(9_001)).toBe('0:10')
    expect(formatCountdown(59_000)).toBe('0:59')
  })

  it('never goes below zero', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-5_000)).toBe('0:00')
  })
})

describe('echo tracking', () => {
  it('finds the typed line in the output that follows the prompt', () => {
    let t = expectEcho(noEchoes, '5')
    const before = 'Enter first number: '.length
    t = trackEcho(t, before, '5\nEnter second number: ')
    expect(t.ranges).toEqual([{ start: before, end: before + 2 }])
    expect(t.pending).toBe('')
  })

  it('copes with the echo arriving in pieces', () => {
    let t = expectEcho(noEchoes, 'hello')
    t = trackEcho(t, 10, 'he')
    t = trackEcho(t, 12, 'llo')
    t = trackEcho(t, 15, '\nnext')
    expect(t.ranges).toEqual([{ start: 10, end: 16 }])
    expect(t.pending).toBe('')
  })

  it('does not colour output that is not the echo', () => {
    let t = expectEcho(noEchoes, '5')
    t = trackEcho(t, 4, 'something else\n')
    expect(t.ranges).toEqual([])
    expect(t.pending).toBe('')
    // And later output stays plain.
    t = trackEcho(t, 20, '5\n')
    expect(t.ranges).toEqual([])
  })

  it('colours each of several answers on its own', () => {
    let t = expectEcho(noEchoes, '3')
    t = trackEcho(t, 3, '3\nAgain? ')
    t = expectEcho(t, '4')
    t = trackEcho(t, 3 + 9, '4\n')
    expect(t.ranges).toEqual([
      { start: 3, end: 5 },
      { start: 12, end: 14 },
    ])
  })

  it('handles an empty answer (just Enter)', () => {
    let t = expectEcho(noEchoes, '')
    t = trackEcho(t, 7, '\nnext')
    expect(t.ranges).toEqual([{ start: 7, end: 8 }])
  })

  it('moves the ranges when the oldest output is dropped', () => {
    expect(
      shiftEchoes(
        [
          { start: 10, end: 12 },
          { start: 30, end: 32 },
        ],
        20,
      ),
    ).toEqual([{ start: 10, end: 12 }])
    expect(shiftEchoes([{ start: 18, end: 25 }], 20)).toEqual([{ start: 0, end: 5 }])
  })
})

describe('segmentOutput', () => {
  it('cuts the text into plain and typed pieces', () => {
    const text = 'Enter first number: 5\nEnter second number: 7\nSum: 12\n'
    expect(
      segmentOutput(text, [
        { start: 20, end: 22 },
        { start: 43, end: 45 },
      ]),
    ).toEqual([
      { text: 'Enter first number: ', typed: false },
      { text: '5\n', typed: true },
      { text: 'Enter second number: ', typed: false },
      { text: '7\n', typed: true },
      { text: 'Sum: 12\n', typed: false },
    ])
  })

  it('is all plain with no ranges, and tolerates ranges past the end', () => {
    expect(segmentOutput('abc', [])).toEqual([{ text: 'abc', typed: false }])
    expect(segmentOutput('abc', [{ start: 2, end: 99 }])).toEqual([
      { text: 'ab', typed: false },
      { text: 'c', typed: true },
    ])
  })
})
