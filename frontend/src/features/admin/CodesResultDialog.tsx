import { useState } from 'react'
import { AlertTriangle, Check, Copy, Download, Printer } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { toast } from '@/components/ui/toastStore'
import { copyText } from '@/lib/clipboard'
import { csvFileName, registrationCodesCsv } from '@/lib/registration'
import { formatDateTime } from '@/lib/time'
import type { GeneratedCodes } from './GenerateCodesDialog'
import { PrintSlips } from './PrintSlips'

interface Props {
  result: GeneratedCodes | null
  /** Called when the admin presses Done: the page then forgets the codes. */
  onClose: () => void
}

/**
 * The codes, shown ONCE. The server keeps only hashes, so nothing here can be looked up later; the
 * dialog therefore cannot be dismissed by Escape or a stray click, only with Done.
 */
export function CodesResultDialog({ result, onClose }: Props) {
  return (
    <Dialog
      open={result !== null}
      onClose={onClose}
      dismissible={false}
      title="Your registration codes"
      width="max-w-2xl"
    >
      {result && <ResultBody result={result} onClose={onClose} />}
    </Dialog>
  )
}

function ResultBody({ result, onClose }: { result: GeneratedCodes; onClose: () => void }) {
  const { created, studentNo } = result
  const { codes, batch_name: batch, expires_at: expiresAt } = created
  const [copied, setCopied] = useState(false)

  async function copyAll() {
    if (await copyText(codes.join('\n'))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } else {
      toast.error("Copying didn't work here. Use Download CSV or Print instead.")
    }
  }

  function downloadCsv() {
    const blob = new Blob([registrationCodesCsv(codes, batch, studentNo)], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = csvFileName(batch)
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <DialogBody>
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2.5 text-sm font-medium text-warn"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          These codes won&apos;t be shown again. Copy, download or print them now. Each code works
          only once.
        </p>

        <p className="mt-3 text-sm text-ink-muted">
          <strong className="text-ink">{codes.length}</strong>{' '}
          {codes.length === 1 ? 'code' : 'codes'} in batch{' '}
          <strong className="text-ink">{batch}</strong>
          {studentNo && (
            <>
              {' '}
              for student no. <strong className="text-ink">{studentNo}</strong>
            </>
          )}
          {' · '}
          {expiresAt ? `valid until ${formatDateTime(expiresAt)}` : 'no expiry date'}
        </p>

        <ul
          aria-label="Registration codes"
          className="mt-3 grid max-h-72 grid-cols-2 gap-x-6 gap-y-1 overflow-auto rounded-lg border border-line bg-surface-2 p-4 font-mono text-base tracking-widest"
        >
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </DialogBody>
      <DialogFooter>
        <Button onClick={() => void copyAll()}>
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
          {copied ? 'Copied' : 'Copy all'}
        </Button>
        <Button onClick={downloadCsv}>
          <Download aria-hidden className="size-4" />
          Download CSV
        </Button>
        <Button onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          Print
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
      <PrintSlips codes={codes} batch={batch} expiresAt={expiresAt} studentNo={studentNo} />
    </>
  )
}
