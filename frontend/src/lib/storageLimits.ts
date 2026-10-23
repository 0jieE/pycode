import type { StorageBounds, StorageLimits } from '@/api/types'
import { formatBytes } from './format'

/**
 * Workspace storage limits as the admin types them: sizes in KB or MB (the API takes bytes), the file count as is.
 * The limits apply to each workspace of a user (every class workspace and Practice).
 */

/** What every workspace gets until an admin changes it (the backend's defaults). */
export const DEFAULT_LIMITS: StorageLimits = {
  max_file_bytes: 100 * 1024,
  max_workspace_bytes: 2 * 1024 * 1024,
  max_files: 100,
}

export type SizeUnit = 'KB' | 'MB'
const UNIT_BYTES: Record<SizeUnit, number> = { KB: 1024, MB: 1024 * 1024 }

/** A size being typed: the number as text (may be empty) and its unit. */
export interface SizeInput {
  value: string
  unit: SizeUnit
}

/** 2097152 -> 2 MB, 102400 -> 100 KB, 1572864 -> 1.5 MB. */
export function sizeInput(bytes: number): SizeInput {
  const unit: SizeUnit = bytes >= UNIT_BYTES.MB ? 'MB' : 'KB'
  const value = bytes / UNIT_BYTES[unit]
  return { value: String(Number(value.toFixed(2))), unit }
}

/** The typed size in bytes; null when empty or not a number. */
export function inputBytes(input: SizeInput): number | null {
  if (input.value.trim() === '') return null
  const n = Number(input.value)
  return Number.isFinite(n) ? Math.round(n * UNIT_BYTES[input.unit]) : null
}

/** The typed file count; null when empty or not a whole number. */
export function inputCount(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

export type LimitField = keyof StorageLimits
export type LimitErrors = Partial<Record<LimitField, string>>

const between = (field: LimitField, bounds: StorageBounds): string => {
  const { min, max } = bounds[field]
  return field === 'max_files'
    ? `Enter a whole number from ${min} to ${max}.`
    : `Enter a size from ${formatBytes(min)} to ${formatBytes(max)}.`
}

/**
 * What is wrong with some limits, field by field. A null value is "not set": an error when `required`, else the
 * user follows the role there (`fallback` holds the role's values, for the file-vs-workspace check).
 */
export function limitErrors(
  values: Record<LimitField, number | null>,
  bounds: StorageBounds,
  { required, fallback }: { required: boolean; fallback?: StorageLimits },
): LimitErrors {
  const errors: LimitErrors = {}
  for (const field of ['max_file_bytes', 'max_workspace_bytes', 'max_files'] as const) {
    const v = values[field]
    if (v === null) {
      if (required) errors[field] = between(field, bounds)
    } else if (v < bounds[field].min || v > bounds[field].max) {
      errors[field] = between(field, bounds)
    }
  }
  const file = values.max_file_bytes ?? fallback?.max_file_bytes
  const workspace = values.max_workspace_bytes ?? fallback?.max_workspace_bytes
  if (!errors.max_file_bytes && file !== undefined && workspace !== undefined && file > workspace) {
    errors.max_file_bytes = `One file can't be larger than the whole workspace (${formatBytes(workspace)}).`
  }
  return errors
}
