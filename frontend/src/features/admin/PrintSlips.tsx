import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { chunk, SLIPS_PER_PAGE } from '@/lib/registration'
import { formatDateTime } from '@/lib/time'

interface PrintSlipsProps {
  codes: readonly string[]
  batch: string
  expiresAt: string | null
  /** The student number a single code is tied to, if any. */
  studentNo: string | null
}

/**
 * The cut-out slips, ready to print: 10 per A4 page (two columns of five), each with the code in large
 * monospace, the batch, the expiry and where to sign up. They are invisible on screen. While they
 * exist, `body.printing-codes` makes the browser's print output contain nothing but them (see the
 * print rules in styles/index.css), so printing from anywhere else in the app is unaffected.
 *
 * They are drawn straight from the codes held in memory: the server cannot show the codes again, so there
 * is deliberately no separate printable address to open.
 */
export function PrintSlips({ codes, batch, expiresAt, studentNo }: PrintSlipsProps) {
  useEffect(() => {
    document.body.classList.add('printing-codes')
    return () => document.body.classList.remove('printing-codes')
  }, [])

  const signupUrl = `${window.location.origin}/signup`
  const expiry = expiresAt ? `Valid until ${formatDateTime(expiresAt)}` : 'No expiry date'

  return createPortal(
    <div className="print-slips" aria-hidden="true">
      {chunk(codes, SLIPS_PER_PAGE).map((page, pageIndex) => (
        <section className="slip-page" key={pageIndex}>
          {page.map((code) => (
            <article className="slip" key={code}>
              <p className="slip-title">Student registration code</p>
              <p className="slip-code">{code}</p>
              <p>Batch: {batch}</p>
              {studentNo && <p>For student no. {studentNo}</p>}
              <p>{expiry}</p>
              <p className="slip-url">Sign up at {signupUrl}</p>
            </article>
          ))}
        </section>
      ))}
    </div>,
    document.body,
  )
}
