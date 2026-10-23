import { useMemo, type ReactNode } from 'react'
import { pythonLanguage } from '@codemirror/lang-python'
import { classHighlighter, highlightCode } from '@lezer/highlight'

/**
 * Python code as coloured text, for the lesson's code cards: the same parser as the editor, but no editor
 * (a lesson can have many cards). The colours are the `tok-*` rules in styles/index.css, which follow the
 * app's light or dark theme.
 */
export function HighlightedCode({ code, language }: { code: string; language: string }) {
  const nodes = useMemo(() => {
    if (language !== 'python' && language !== 'py') return [code]
    const out: ReactNode[] = []
    let line: ReactNode[] = []
    const tree = pythonLanguage.parser.parse(code)
    highlightCode(
      code,
      tree,
      classHighlighter,
      (text, classes) => {
        line.push(
          classes ? (
            <span key={out.length * 1000 + line.length} className={classes}>
              {text}
            </span>
          ) : (
            text
          ),
        )
      },
      () => {
        out.push(...line, '\n')
        line = []
      },
    )
    out.push(...line)
    return out
  }, [code, language])

  return <code className="font-mono">{nodes}</code>
}
