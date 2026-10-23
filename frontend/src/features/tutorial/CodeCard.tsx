import { Play } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { HighlightedCode } from './HighlightedCode'

interface CodeCardProps {
  code: string
  language?: string
  title?: string
  /** Shows "Try it", which opens the code in the side editor. */
  onTry?: () => void
}

/** A block of code in a lesson: coloured, with "Try it" when it can be run. */
export function CodeCard({ code, language = 'python', title, onTry }: CodeCardProps) {
  return (
    <figure className="my-3 overflow-hidden rounded-md border border-line bg-surface">
      {(title || onTry) && (
        <figcaption className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-1.5">
          <span className="text-xs font-semibold text-ink-strong">{title}</span>
          {onTry && (
            <Button
              size="sm"
              variant="primary"
              onClick={onTry}
              aria-label={title ? `Try it: ${title}` : 'Try it'}
            >
              <Play aria-hidden className="size-3.5" />
              Try it
            </Button>
          )}
        </figcaption>
      )}
      <pre className="overflow-x-auto bg-canvas px-3 py-2 text-sm leading-relaxed">
        <HighlightedCode code={code} language={language} />
      </pre>
    </figure>
  )
}
