import { describe, expect, it } from 'vitest'
import type { StorageBounds } from '@/api/types'
import { DEFAULT_LIMITS, inputBytes, inputCount, limitErrors, sizeInput } from './storageLimits'

const BOUNDS: StorageBounds = {
  max_file_bytes: { min: 1024, max: 1048576 },
  max_workspace_bytes: { min: 10240, max: 8388608 },
  max_files: { min: 1, max: 500 },
}

describe('storage limits as typed', () => {
  it('shows bytes in KB or MB and reads them back', () => {
    expect(sizeInput(102400)).toEqual({ value: '100', unit: 'KB' })
    expect(sizeInput(2097152)).toEqual({ value: '2', unit: 'MB' })
    expect(sizeInput(1572864)).toEqual({ value: '1.5', unit: 'MB' })
    expect(inputBytes({ value: '50', unit: 'KB' })).toBe(51200)
    expect(inputBytes({ value: '1.5', unit: 'MB' })).toBe(1572864)
    expect(inputBytes({ value: ' ', unit: 'KB' })).toBeNull()
    expect(inputCount('30')).toBe(30)
    expect(inputCount('2.5')).toBeNull()
  })

  it('keeps every value inside the bounds', () => {
    const errors = limitErrors(
      { max_file_bytes: 512, max_workspace_bytes: 9 * 1048576, max_files: 0 },
      BOUNDS,
      { required: true },
    )
    expect(errors.max_file_bytes).toBe('Enter a size from 1 KB to 1 MB.')
    expect(errors.max_workspace_bytes).toBe('Enter a size from 10 KB to 8 MB.')
    expect(errors.max_files).toBe('Enter a whole number from 1 to 500.')
    expect(limitErrors(DEFAULT_LIMITS, BOUNDS, { required: true })).toEqual({})
  })

  it('a file may not be larger than the workspace, also against the role for an unset field', () => {
    expect(
      limitErrors({ max_file_bytes: 1048576, max_workspace_bytes: 524288, max_files: 10 }, BOUNDS, {
        required: true,
      }).max_file_bytes,
    ).toBe("One file can't be larger than the whole workspace (512 KB).")
    // A user's own limits: empty follows the role (2 MB here), so 1 MB per file is fine.
    expect(
      limitErrors({ max_file_bytes: 1048576, max_workspace_bytes: null, max_files: null }, BOUNDS, {
        required: false,
        fallback: DEFAULT_LIMITS,
      }),
    ).toEqual({})
  })
})
