import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import {
  useRegistrationBatches,
  useAllRegistrationCodes,
  useRevokeBatch,
  useRevokeCode,
} from '@/api/queries/registration'
import { errorMessage } from '@/api/errors'
import type { RegistrationCodeOut } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { Skeleton } from '@/components/ui/Spinner'
import { Table, Td, Th } from '@/components/ui/Table'
import { NoMatches, TableToolbar } from '@/components/ui/TableToolbar'
import { toast } from '@/components/ui/toastStore'
import { codesOfBatch } from '@/lib/adminRoutes'
import { maskedCode } from '@/lib/registration'
import { useTableView } from '@/lib/tableView'
import { formatDateTime } from '@/lib/time'
import { CodesResultDialog } from './CodesResultDialog'
import { GenerateCodesDialog } from './GenerateCodesDialog'
import { useGenerateCodes } from './generateCodes'

const PAGE_SIZE = 20

/** Every unused code, or one batch's (chosen in the side bar, CodesPanel). */
export function RegistrationCodesPage() {
  const { batch = '' } = useParams()
  const batches = useRegistrationBatches()
  // A batch that no longer has unused codes (all used or revoked): back to all batches.
  const gone = batch !== '' && !!batches.data && !batches.data.some((b) => b.batch_name === batch)
  return (
    <>
      {gone ? (
        <Navigate to="/admin/registration-codes" replace />
      ) : (
        // A fresh search and page for each batch.
        <CodesList key={batch} batch={batch} />
      )}
      <GenerateFlow batch={batch} />
    </>
  )
}

/**
 * Generating codes, and the one-time list of the new codes. Kept out of the list above, which is replaced when
 * the batch on screen runs out of codes (it can happen while the dialog is open); the codes themselves are held
 * in memory (useGenerateCodes) until the admin presses Done.
 */
function GenerateFlow({ batch }: { batch: string }) {
  const navigate = useNavigate()
  const { opened, close, result, setResult } = useGenerateCodes()
  return (
    <>
      <GenerateCodesDialog open={opened} onClose={close} onGenerated={setResult} />
      <CodesResultDialog
        result={result}
        onClose={() => {
          // Done: the codes are forgotten, and on to the new batch's codes.
          const made = result?.created.batch_name
          setResult(null)
          if (made && made !== batch) navigate(codesOfBatch(made))
        }}
      />
    </>
  )
}

function CodesList({ batch }: { batch: string }) {
  const batches = useRegistrationBatches()
  const codes = useAllRegistrationCodes()
  const all = codes.data ?? []
  const items = batch ? all.filter((c) => c.batch_name === batch) : all

  // Search and filters work on the whole list, which is in the browser.
  const view = useTableView(items, {
    pageSize: PAGE_SIZE,
    searchText: (c) => `${c.hint} ${c.batch_name} ${c.student_no ?? ''}`,
    filters: {
      kind: (c, v) => (v === 'bound' ? c.student_no !== null : c.student_no === null),
    },
  })
  const narrowed = view.search.trim() !== '' || (view.filterValues.kind ?? '') !== ''
  const revokeCode = useRevokeCode()
  const revokeBatch = useRevokeBatch()

  const openGenerate = useGenerateCodes((s) => s.open)
  const [codeToRevoke, setCodeToRevoke] = useState<RegistrationCodeOut | null>(null)
  const [batchToRevoke, setBatchToRevoke] = useState(false)

  const batchCount = batches.data?.find((b) => b.batch_name === batch)?.count ?? 0

  function doRevokeCode(target: RegistrationCodeOut) {
    // A promise, as below: the batch's last code takes the batch (and this page) with it.
    revokeCode.mutateAsync(target.id).then(
      () => {
        setCodeToRevoke(null)
        toast.success('Code revoked')
      },
      (err: unknown) => {
        setCodeToRevoke(null)
        toast.error(errorMessage(err))
      },
    )
  }

  function doRevokeBatch() {
    // A promise, not mutate's callbacks: the batch is gone afterwards, so this page is replaced by all batches
    // before those callbacks would run, and the toast must still appear.
    revokeBatch.mutateAsync(batch).then(
      (res) => {
        setBatchToRevoke(false)
        toast.success(`Revoked ${res.revoked} ${res.revoked === 1 ? 'code' : 'codes'}`)
      },
      (err: unknown) => {
        setBatchToRevoke(false)
        toast.error(errorMessage(err))
      },
    )
  }

  return (
    <div className="page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{batch || 'Registration codes'}</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            A student needs a one-time code to create an account at <strong>/signup</strong>. Codes
            are shown only once, when you generate them: this list shows the ones not used yet, and
            a code leaves it as soon as it is used.
          </p>
        </div>
        <Button variant="primary" onClick={openGenerate}>
          <Plus aria-hidden className="size-4" />
          Generate codes
        </Button>
      </header>

      {items.length > 0 && (
        <TableToolbar
          what="registration codes"
          placeholder="Last 4 characters, batch or student no."
          search={view.search}
          onSearch={view.setSearch}
          onFilter={view.setFilter}
          active={narrowed}
          onClear={view.clear}
          shown={view.matches.length}
          total={items.length}
          filters={[
            {
              id: 'kind',
              label: 'Meant for',
              value: view.filterValues.kind ?? '',
              allLabel: 'Anyone or a student',
              options: [
                { value: 'bound', label: 'A specific student' },
                { value: 'open', label: 'Anyone' },
              ],
            },
          ]}
        />
      )}
      {batch && (
        <div>
          <Button variant="danger" onClick={() => setBatchToRevoke(true)}>
            <Trash2 aria-hidden className="size-4" />
            Revoke whole batch
          </Button>
        </div>
      )}

      {codes.isError && !codes.data ? (
        <EmptyState
          title="The codes could not be loaded"
          action={<Button onClick={() => void codes.refetch()}>Try again</Button>}
        >
          {errorMessage(codes.error)}
        </EmptyState>
      ) : codes.isPending ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading codes">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No unused codes"
          action={
            <Button variant="primary" onClick={openGenerate}>
              Generate codes
            </Button>
          }
        >
          Generate codes, then give them to your students (print them as slips, or download the
          list).
        </EmptyState>
      ) : view.matches.length === 0 ? (
        <NoMatches what="registration codes" onClear={view.clear} />
      ) : (
        <div>
          <Table caption="Unused registration codes">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Batch</Th>
                <Th>For student no.</Th>
                <Th>Expires</Th>
                <Th>Created</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <span
                      className="font-mono text-base tracking-widest"
                      aria-label={`Code ending in ${c.hint}`}
                    >
                      {maskedCode(c.hint)}
                    </span>
                  </Td>
                  <Td>{c.batch_name}</Td>
                  <Td>{c.student_no ?? <span className="text-ink-muted">Anyone</span>}</Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {c.expires_at ? formatDateTime(c.expires_at) : 'Never'}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {formatDateTime(c.created_at)}
                  </Td>
                  <Td>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        aria-label={`Revoke the code ending in ${c.hint} (batch ${c.batch_name})`}
                        onClick={() => setCodeToRevoke(c)}
                      >
                        <KeyRound aria-hidden className="size-3.5" />
                        Revoke
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {view.matches.length > 0 && (
        <Pagination
          page={view.page}
          size={PAGE_SIZE}
          total={view.matches.length}
          onPageChange={view.setPage}
        />
      )}

      <ConfirmDialog
        open={codeToRevoke !== null}
        title="Revoke this code?"
        confirmLabel="Revoke code"
        destructive
        loading={revokeCode.isPending}
        onConfirm={() => codeToRevoke && doRevokeCode(codeToRevoke)}
        onCancel={() => setCodeToRevoke(null)}
      >
        The code ending in <strong className="font-mono text-ink">{codeToRevoke?.hint}</strong>{' '}
        (batch <strong className="text-ink">{codeToRevoke?.batch_name}</strong>) will stop working.
        A student holding it will not be able to sign up with it.
      </ConfirmDialog>

      <ConfirmDialog
        open={batchToRevoke}
        title="Revoke the whole batch?"
        confirmLabel={`Revoke ${batchCount} ${batchCount === 1 ? 'code' : 'codes'}`}
        destructive
        loading={revokeBatch.isPending}
        onConfirm={doRevokeBatch}
        onCancel={() => setBatchToRevoke(false)}
      >
        All <strong className="text-ink">{batchCount}</strong> unused{' '}
        {batchCount === 1 ? 'code' : 'codes'} of the batch{' '}
        <strong className="text-ink">{batch}</strong> will stop working. Accounts already created
        with this batch are not affected.
      </ConfirmDialog>
    </div>
  )
}
