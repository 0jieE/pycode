import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Tailwind max-width class for the panel. */
  width?: string
  /** False for a choice the user must make: no close button, Escape or backdrop click. */
  dismissible?: boolean
}

/**
 * Modal built on the native <dialog>: the browser traps focus inside, makes the rest of the page
 * inert, closes on Escape and gives focus back to the button that opened it.
 * Children are only mounted while open, so forms start fresh every time.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
  dismissible = true,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={dismissible ? undefined : (e) => e.preventDefault()}
      // A click on the dim backdrop lands on the <dialog> element itself, not on the panel.
      onMouseDown={(e) => {
        if (dismissible && e.target === ref.current) onClose()
      }}
      className={`m-auto w-[calc(100%-2rem)] ${width} rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-[2px]`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <h2 id={titleId} className="text-lg font-semibold text-ink-strong">
              {title}
            </h2>
            {dismissible && (
              <button
                type="button"
                aria-label="Close dialog"
                onClick={onClose}
                className="rounded p-1 text-ink-muted hover:bg-hover hover:text-ink"
              >
                <X aria-hidden className="size-5" />
              </button>
            )}
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

export function DialogBody({ children }: { children: ReactNode }) {
  return <div className="flex-1 overflow-auto px-6 py-5">{children}</div>
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end gap-2 rounded-b-xl border-t border-line bg-surface-2/60 px-6 py-3.5">
      {children}
    </div>
  )
}
