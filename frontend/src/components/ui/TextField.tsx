import { forwardRef, useId, type InputHTMLAttributes } from 'react'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string | null
}

/** A labelled input. The label is always visible; errors are announced and linked to the input. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, className = '', id, ...rest },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`h-9 rounded-md border bg-field px-3 text-sm transition-colors placeholder:text-ink-muted/70 ${
          error ? 'border-error' : 'border-line'
        } ${className}`}
        {...rest}
      />
      {error && (
        <p id={errorId} className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  )
})
