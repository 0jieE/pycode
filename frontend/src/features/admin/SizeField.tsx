import { useId } from 'react'
import type { SizeInput, SizeUnit } from '@/lib/storageLimits'

/** A size typed as a number with its unit (KB or MB). The label, hint and error are linked to the number. */
export function SizeField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
}: {
  label: string
  value: SizeInput
  onChange: (value: SizeInput) => void
  error?: string
  hint?: string
  placeholder?: string
}) {
  const id = useId()
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ')
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={value.value}
          placeholder={placeholder}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={`h-9 w-full min-w-0 rounded-l-md border bg-field px-3 text-sm tabular-nums placeholder:text-ink-muted/70 ${
            error ? 'border-error' : 'border-line'
          }`}
        />
        <select
          aria-label={`${label}: unit`}
          value={value.unit}
          onChange={(e) => onChange({ ...value, unit: e.target.value as SizeUnit })}
          className="h-9 rounded-r-md border border-l-0 border-line bg-surface-2 px-2 text-sm"
        >
          <option value="KB">KB</option>
          <option value="MB">MB</option>
        </select>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  )
}
