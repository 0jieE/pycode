import { useRef, useState, type ChangeEvent } from 'react'
import { Download, Upload } from 'lucide-react'
import { useImportUsers } from '@/api/queries/users'
import { errorMessage } from '@/api/errors'
import type { ImportResult } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { Table, Td, Th } from '@/components/ui/Table'
import { CSV_TEMPLATE, IMPORT_MAX_BYTES, previewStudentCsv, type ImportPreview } from '@/lib/csv'

// Rendering thousands of preview rows would freeze a lab PC; every row is still checked and sent.
const PREVIEW_LIMIT = 200

export function ImportUsersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Import students from CSV" width="max-w-3xl">
      <ImportFlow onClose={onClose} />
    </Dialog>
  )
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'students-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function ImportFlow({ onClose }: { onClose: () => void }) {
  const importUsers = useImportUsers()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  function reset() {
    setFile(null)
    setPreview(null)
    setFileError(null)
    setResult(null)
    setUploadError(null)
    importUsers.reset()
    if (inputRef.current) inputRef.current.value = ''
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    setPreview(null)
    setFile(null)
    setFileError(null)
    setUploadError(null)
    if (!picked) return
    if (picked.size > IMPORT_MAX_BYTES) {
      setFileError(`That file is too large. The limit is ${IMPORT_MAX_BYTES / 1024} KB.`)
      return
    }
    try {
      const parsed = previewStudentCsv(await picked.text())
      if (!parsed.ok) {
        setFileError(parsed.error)
        return
      }
      setFile(picked)
      setPreview(parsed)
    } catch {
      setFileError('That file could not be read. Choose a UTF-8 CSV file.')
    }
  }

  function upload() {
    if (!file) return
    setUploadError(null)
    importUsers.mutate(file, {
      onSuccess: setResult,
      onError: (err) => setUploadError(errorMessage(err)),
    })
  }

  if (result) return <ImportSummary result={result} onAnother={reset} onClose={onClose} />

  const rows =
    preview?.ok === true
      ? (onlyProblems ? preview.rows.filter((r) => r.problem) : preview.rows).slice(
          0,
          PREVIEW_LIMIT,
        )
      : []

  return (
    <>
      <DialogBody>
        <div className="flex flex-col gap-4">
          <div className="rounded-md bg-surface-2 px-4 py-3 text-sm">
            <p>
              The file needs these columns in its first row:{' '}
              <code className="font-mono">student_no, full_name, username, temp_password</code>.
              Every row creates a student account.
            </p>
            <Button size="sm" className="mt-2" onClick={downloadTemplate}>
              <Download aria-hidden className="size-4" />
              Download a template
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="csv-file" className="text-sm font-medium">
              CSV file
            </label>
            <input
              ref={inputRef}
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onPick(e)}
              className="text-sm file:mr-3 file:h-9 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:font-medium"
            />
            {fileError && (
              <p role="alert" className="text-sm text-error">
                {fileError}
              </p>
            )}
          </div>

          {preview?.ok && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge tone="ok">{preview.validCount} ready to import</Badge>
                {preview.problemCount > 0 && (
                  <Badge tone="error">{preview.problemCount} with problems</Badge>
                )}
                {preview.problemCount > 0 && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={onlyProblems}
                      onChange={(e) => setOnlyProblems(e.target.checked)}
                    />
                    Show only rows with problems
                  </label>
                )}
              </div>
              {preview.problemCount > 0 && (
                <p className="text-sm text-ink-muted">
                  Rows with problems are skipped. The others are still imported. Accounts that
                  already exist in the system are reported after the upload.
                </p>
              )}

              <div className="max-h-72 overflow-auto rounded-lg">
                <Table caption="Preview of the CSV rows">
                  <thead className="sticky top-0">
                    <tr>
                      <Th>Row</Th>
                      <Th>Student no.</Th>
                      <Th>Full name</Th>
                      <Th>Username</Th>
                      <Th>Password</Th>
                      <Th>Check</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row} className={r.problem ? 'bg-error-soft/50' : undefined}>
                        <Td>{r.row}</Td>
                        <Td>{r.student_no}</Td>
                        <Td>{r.full_name}</Td>
                        <Td className="font-mono">{r.username}</Td>
                        <Td className="text-ink-muted">{r.temp_password ? '••••••••' : ''}</Td>
                        <Td>
                          {r.problem ? (
                            <span className="text-error">{r.problem}</span>
                          ) : (
                            <span className="text-ok">OK</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {preview.rows.length > PREVIEW_LIMIT && !onlyProblems && (
                <p className="text-sm text-ink-muted">
                  Showing the first {PREVIEW_LIMIT} of {preview.rows.length} rows. All rows were
                  checked.
                </p>
              )}
            </div>
          )}

          {uploadError && (
            <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
              {uploadError}
            </p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          loading={importUsers.isPending}
          disabled={!preview?.ok || preview.validCount === 0}
          onClick={upload}
        >
          <Upload aria-hidden className="size-4" />
          {preview?.ok ? `Import ${preview.validCount} students` : 'Import'}
        </Button>
      </DialogFooter>
    </>
  )
}

function ImportSummary({
  result,
  onAnother,
  onClose,
}: {
  result: ImportResult
  onAnother: () => void
  onClose: () => void
}) {
  return (
    <>
      <DialogBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3" role="status">
            <Badge tone="ok">
              {result.created} {result.created === 1 ? 'account' : 'accounts'} created
            </Badge>
            <Badge tone={result.skipped ? 'warn' : 'pending'}>{result.skipped} skipped</Badge>
          </div>
          {result.errors.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-lg">
              <Table caption="Rows that were skipped">
                <thead className="sticky top-0">
                  <tr>
                    <Th>Row</Th>
                    <Th>Username</Th>
                    <Th>Why it was skipped</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e) => (
                    <tr key={e.row}>
                      <Td>{e.row}</Td>
                      <Td className="font-mono">{e.username ?? ''}</Td>
                      <Td>{e.detail}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onAnother}>Import another file</Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </>
  )
}
