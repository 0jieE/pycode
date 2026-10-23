import { useState, type FormEvent } from 'react'
import { CornerDownLeft, OctagonX, Square } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { MAX_INPUT_CHARS } from './interactive'

interface InputRequestPanelProps {
  /** What the program printed just before it stopped to wait: "Enter first number: ". */
  prompt: string
  /** Why the last line was refused, if it was. */
  error: string | null
  onSend: (value: string) => void
  /** Close the input: input() raises EOFError. */
  onEndInput: () => void
  onStop: () => void
}

/**
 * Asks for one line while a program waits at input(). It floats over the bottom of the terminal and is not a
 * modal in the browser's sense: nothing behind it is disabled, so the output above can still be scrolled and
 * read while answering. Enter sends.
 */
export function InputRequestPanel({
  prompt,
  error,
  onSend,
  onEndInput,
  onStop,
}: InputRequestPanelProps) {
  const [value, setValue] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    onSend(value)
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="input-request-title"
      className="absolute inset-x-2 bottom-2 z-10 rounded-lg border border-focus bg-surface p-3 shadow-2xl"
    >
      <h4 id="input-request-title" className="text-sm font-semibold text-ink-strong">
        Program is waiting for input
      </h4>
      <label
        htmlFor="input-request-field"
        className="mt-1.5 block font-mono text-xs text-ink-muted"
      >
        {prompt === '' ? '(the program printed no prompt)' : prompt}
      </label>
      <form onSubmit={submit} className="mt-1.5 flex flex-col gap-2" noValidate>
        <input
          id="input-request-field"
          type="text"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_INPUT_CHARS}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'input-request-error' : undefined}
          className="h-8 rounded-md border border-line bg-field px-2 font-mono text-sm"
        />
        {error && (
          <p id="input-request-error" role="alert" className="text-xs text-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" size="sm">
            <CornerDownLeft aria-hidden className="size-3.5" />
            Send
          </Button>
          <Button size="sm" onClick={onEndInput} title="Close the input: input() raises EOFError">
            <Square aria-hidden className="size-3.5" />
            End input (EOF)
          </Button>
          <Button size="sm" variant="danger" className="ml-auto" onClick={onStop}>
            <OctagonX aria-hidden className="size-3.5" />
            Stop program
          </Button>
        </div>
      </form>
    </div>
  )
}
