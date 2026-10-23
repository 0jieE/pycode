import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'

/** Scrolls sideways on narrow screens instead of breaking the page layout. */
export function Table({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm [&_tbody_tr:hover]:bg-hover">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  )
}

export function Th({ className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`border-b border-line bg-surface-2 px-4 py-2.5 text-xs font-semibold tracking-wide text-ink-muted uppercase ${className}`}
      {...rest}
    />
  )
}

export function Td({ className = '', ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`border-b border-line px-4 py-3 align-middle ${className}`} {...rest} />
}
