import { isValidElement, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeCard } from './CodeCard'

interface MarkdownProps {
  text: string
  /** Python code blocks get a "Try it" button that opens them in the side editor. */
  onTry?: (code: string, title: string) => void
}

/** The text of a <code> element react-markdown made, and its language ("language-python" -> "python"). */
function codeOf(children: ReactNode): { code: string; language: string } {
  const el = (Array.isArray(children) ? children[0] : children) as ReactElement<{
    className?: string
    children?: ReactNode
  }>
  if (!isValidElement(el)) return { code: String(children ?? ''), language: '' }
  const language = /language-([\w-]+)/.exec(el.props.className ?? '')?.[1] ?? ''
  const raw = el.props.children
  const code = Array.isArray(raw) ? raw.join('') : String(raw ?? '')
  return { code: code.replace(/\n$/, ''), language }
}

/**
 * A lesson's Markdown (tables included), drawn with the app's own styles. No raw HTML is rendered: lesson
 * text is written by staff, but it is still shown to every student.
 */
export function Markdown({ text, onTry }: MarkdownProps) {
  const components: Components = {
    h1: ({ children }) => (
      <h2 className="mt-6 mb-2 text-xl font-semibold text-ink-strong">{children}</h2>
    ),
    h2: ({ children }) => (
      <h2 className="mt-6 mb-2 text-lg font-semibold text-ink-strong">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-5 mb-2 text-base font-semibold text-ink-strong">{children}</h3>
    ),
    h4: ({ children }) => <h4 className="mt-4 mb-1 font-semibold text-ink-strong">{children}</h4>,
    p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    a: ({ children, href }) => (
      <a href={href} target="_blank" rel="noreferrer" className="text-brand-700 underline">
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-4 border-focus bg-open-soft/50 px-4 py-1 text-ink">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-5 border-line" />,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="min-w-[60%] border-collapse text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-line bg-surface-2 px-3 py-1.5 text-left font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => <td className="border border-line px-3 py-1.5">{children}</td>,
    // Inline code only: blocks are drawn by `pre` below.
    code: ({ children }) => (
      <code className="rounded bg-surface-2 px-1 py-px font-mono text-[0.92em] text-ink-strong">
        {children}
      </code>
    ),
    pre: ({ children }) => {
      const { code, language } = codeOf(children)
      const python = language === 'python' || language === 'py'
      return (
        <CodeCard
          code={code}
          language={language}
          onTry={python && onTry ? () => onTry(code, 'Code from the lesson') : undefined}
        />
      )
    },
  }

  return (
    <div className="text-[14px] text-ink">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
