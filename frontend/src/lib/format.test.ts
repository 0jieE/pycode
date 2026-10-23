import { describe, expect, it } from 'vitest'
import { formatBytes } from './format'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [100 * 1024, '100 KB'],
    [2 * 1024 * 1024, '2 MB'],
    [1.25 * 1024 * 1024, '1.3 MB'],
  ])('%d -> %s', (n, expected) => {
    expect(formatBytes(n)).toBe(expected)
  })
})
