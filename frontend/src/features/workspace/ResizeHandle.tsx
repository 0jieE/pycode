import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

interface ResizeHandleProps {
  /** Current width (px) of the pane this handle resizes. */
  value: number
  min: number
  max: number
  /** Which side of the handle the pane is on: dragging right grows a left pane, shrinks a right one. */
  pane: 'left' | 'right'
  onChange: (width: number) => void
  label: string
}

const STEP = 16

/** A draggable divider between two panes. Also works with the arrow keys. */
export function ResizeHandle({ value, min, max, pane, onChange, label }: ResizeHandleProps) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)))

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, width: value }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return
    const delta = e.clientX - start.current.x
    onChange(clamp(start.current.width + (pane === 'left' ? delta : -delta)))
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const grow = (e.key === 'ArrowRight') === (pane === 'left')
    onChange(clamp(value + (grow ? STEP : -STEP)))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onKeyDown={onKeyDown}
      className="group relative z-10 w-1 shrink-0 cursor-col-resize bg-line hover:bg-brand-500 focus-visible:bg-brand-500"
    >
      {/* A wider invisible target makes the 4px line easy to grab. */}
      <span aria-hidden className="absolute inset-y-0 -inset-x-1.5" />
    </div>
  )
}
