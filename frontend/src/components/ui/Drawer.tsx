import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Tailwind width class for the panel. */
  width?: string
}

/** A panel that slides in from the right. Same native <dialog> behaviour as Dialog (focus trap, Escape). */
export function Drawer({
  open,
  onClose,
  title,
  children,
  width = 'w-[min(56rem,92vw)]',
}: DrawerProps) {
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
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={`m-0 mr-0 ml-auto h-dvh max-h-none ${width} max-w-none border-l border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50`}
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close panel"
              onClick={onClose}
              className="rounded p-1 text-ink-muted hover:bg-hover hover:text-ink"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}
