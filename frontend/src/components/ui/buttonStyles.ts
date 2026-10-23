export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm shadow-brand-600/30 hover:bg-brand-500 disabled:hover:bg-brand-600',
  secondary: 'bg-btn-2 text-ink-strong hover:bg-btn-2-hover disabled:hover:bg-btn-2',
  danger:
    'bg-danger text-white shadow-sm shadow-danger/25 hover:bg-danger-hover disabled:hover:bg-danger',
  ghost: 'text-ink hover:bg-hover disabled:hover:bg-transparent',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-sm gap-1.5',
  md: 'h-8 px-3.5 text-sm gap-1.5',
  lg: 'h-10 px-5 text-base gap-2',
}

/**
 * The look of a button, for <Button> and for links that act as buttons ("Open", "View submissions"...), so
 * both are the same size and colour everywhere.
 */
export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  extra = '',
): string {
  return `inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-[background-color,box-shadow,transform] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`.trim()
}
