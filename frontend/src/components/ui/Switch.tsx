interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Accessible name, e.g. "Code 6SQ7ZT9Y is active". */
  label: string
  disabled?: boolean
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-brand-600' : 'bg-field'
      }`}
    >
      <span
        aria-hidden
        className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
