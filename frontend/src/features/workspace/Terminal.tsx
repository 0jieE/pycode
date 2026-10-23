import { useEffect, useRef, type ReactNode } from 'react'
import { Eraser } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { segmentOutput, type EchoRange } from './interactive'
import { capTerminalText } from './terminalText'

interface TerminalProps {
  text: string
  onClear: () => void
  placeholder?: string
  /** The panel's tab strip. Without one, a plain "Terminal" title is shown. */
  tabs?: ReactNode
  /** The stretches of `text` that the student typed: shown in another colour. */
  echoes?: readonly EchoRange[]
  /** Floats over the bottom of the terminal (the box that asks for input). */
  overlay?: ReactNode
  /** Leave room under the output for the overlay, so the last lines can be scrolled above it. */
  reserveBottom?: boolean
}

export function Terminal({
  text,
  onClear,
  placeholder = 'Output appears here.',
  tabs,
  echoes = [],
  overlay,
  reserveBottom = false,
}: TerminalProps) {
  const ref = useRef<HTMLPreElement>(null)
  const shown = capTerminalText(text)
  // Colouring only lines up while nothing was cut from the front for display.
  const segments = shown === text && echoes.length > 0 ? segmentOutput(text, echoes) : null

  // Follow new output, unless the student scrolled up to read something.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [shown])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col border-t border-line bg-canvas text-ink">
      <div className="flex items-center justify-between px-3">
        {tabs ?? (
          <h3 className="border-b border-focus py-1.5 text-xs font-medium tracking-wide text-ink-strong uppercase">
            Terminal
          </h3>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-ink-muted hover:text-ink-strong"
          disabled={text === ''}
          onClick={onClear}
        >
          <Eraser aria-hidden className="size-3.5" />
          Clear
        </Button>
      </div>
      {/* tabIndex so keyboard users can scroll long output. */}
      <pre
        ref={ref}
        role="log"
        aria-label="Program output"
        tabIndex={0}
        className={`min-h-0 flex-1 overflow-auto px-3 pt-2 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap ${
          reserveBottom ? 'pb-44' : 'pb-3'
        }`}
      >
        {shown === '' ? (
          <span className="text-ink-muted">{placeholder}</span>
        ) : segments ? (
          segments.map((seg, i) =>
            seg.typed ? (
              <span key={i} className="font-medium text-open">
                {seg.text}
              </span>
            ) : (
              seg.text
            ),
          )
        ) : (
          shown
        )}
      </pre>
      {overlay}
    </div>
  )
}
