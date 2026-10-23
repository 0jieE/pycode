import { useId, type TextareaHTMLAttributes } from 'react'

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: string
  error?: string | null
}

export function TextAreaField({
  label,
  hint,
  error,
  className = '',
  id,
  ...rest
}: TextAreaFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const describedBy = [hint ? `${fieldId}-hint` : null, error ? `${fieldId}-error` : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`rounded-md border bg-field px-3 py-2 text-sm ${
          error ? 'border-error' : 'border-line'
        } ${className}`}
        {...rest}
      />
      {hint && (
        <p id={`${fieldId}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  )
}
