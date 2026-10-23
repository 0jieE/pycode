import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CheckCheck, Eye, UserMinus, X } from 'lucide-react'
import { useAllEnrollments, useEnrollments, useReviewEnrollment } from '@/api/queries/enrollments'
import { errorMessage } from '@/api/errors'
import type { Enrollment } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { Skeleton } from '@/components/ui/Spinner'
import { Table, Td, Th } from '@/components/ui/Table'
import { NoMatches, TableToolbar } from '@/components/ui/TableToolbar'
import { toast } from '@/components/ui/toastStore'
import { useTableView } from '@/lib/tableView'
import { formatDateTime, timeAgo } from '@/lib/time'
import { buttonClass } from '@/components/ui/buttonStyles'

const APPROVED_PAGE_SIZE = 20

export function StudentsTab({ classId }: { classId: number }) {
  return (
    <div className="flex flex-col gap-8">
      <PendingSection classId={classId} />
      <ApprovedSection classId={classId} />
    </div>
  )
}

/** What the search looks at for a student: name, username, student number. */
const studentText = (e: Enrollment) =>
  `${e.student.full_name} ${e.student.username} ${e.student.student_no ?? ''}`

function StudentCell({ e }: { e: Enrollment }) {
  return (
    <>
      <p className="font-medium">{e.student.full_name}</p>
      <p className="font-mono text-xs text-ink-muted">{e.student.username}</p>
    </>
  )
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading students">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

// ----------------------------------------------------------------- pending

function PendingSection({ classId }: { classId: number }) {
  // 100 is the API's page size limit; anything beyond appears after these are handled.
  const pending = useEnrollments(classId, { status: 'pending', page: 1, size: 100 })
  const review = useReviewEnrollment(classId)
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)

  const items = pending.data?.items ?? []
  const view = useTableView(items, { pageSize: 100, searchText: studentText })
  const busyId = review.isPending ? review.variables?.id : undefined

  function act(e: Enrollment, action: 'approve' | 'reject') {
    review.mutate(
      { id: e.id, action },
      {
        onSuccess: () =>
          toast.success(
            action === 'approve'
              ? `${e.student.full_name} was approved`
              : `${e.student.full_name} was rejected`,
          ),
      },
    )
  }

  async function approveAll() {
    // "Approve all" means everyone the list shows: with a search typed, only those.
    const batch = [...view.matches]
    let failed = 0
    setBulk({ done: 0, total: batch.length })
    for (const [i, e] of batch.entries()) {
      try {
        await review.mutateAsync({ id: e.id, action: 'approve' })
      } catch {
        failed++ // each failure was already toasted with the server's reason
      }
      setBulk({ done: i + 1, total: batch.length })
    }
    setBulk(null)
    const ok = batch.length - failed
    if (ok > 0) toast.success(`Approved ${ok} ${ok === 1 ? 'student' : 'students'}`)
  }

  return (
    <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="pending-heading" className="text-lg font-semibold">
          Waiting for approval
          {pending.data ? ` (${pending.data.total})` : ''}
        </h2>
        {view.matches.length > 1 && (
          <Button variant="primary" loading={bulk !== null} onClick={() => void approveAll()}>
            <CheckCheck aria-hidden className="size-4" />
            {bulk
              ? `Approving ${bulk.done} of ${bulk.total}`
              : `Approve all ${view.matches.length}`}
          </Button>
        )}
      </div>

      {items.length > 0 && (
        <TableToolbar
          what="requests"
          placeholder="Name, username or student no."
          search={view.search}
          onSearch={view.setSearch}
          active={view.active}
          onClear={view.clear}
          shown={view.matches.length}
          total={items.length}
        />
      )}

      {pending.isPending ? (
        <ListSkeleton rows={2} />
      ) : pending.isError ? (
        <EmptyState
          title="Requests could not be loaded"
          action={<Button onClick={() => void pending.refetch()}>Try again</Button>}
        >
          {errorMessage(pending.error)}
        </EmptyState>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-ink-muted">
          No one is waiting. Students who join with an invite code appear here.
        </p>
      ) : view.matches.length === 0 ? (
        <NoMatches what="requests" onClear={view.clear} />
      ) : (
        <Table caption="Students waiting for approval">
          <thead>
            <tr>
              <Th>Student</Th>
              <Th>Student no.</Th>
              <Th>Requested</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {view.matches.map((e) => (
              <tr key={e.id}>
                <Td>
                  <StudentCell e={e} />
                </Td>
                <Td>{e.student.student_no ?? <span className="text-ink-muted">—</span>}</Td>
                <Td
                  className="whitespace-nowrap text-ink-muted"
                  title={formatDateTime(e.requested_at)}
                >
                  {timeAgo(e.requested_at)}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="primary"
                      aria-label={`Approve ${e.student.full_name}`}
                      loading={busyId === e.id && review.variables?.action === 'approve'}
                      disabled={bulk !== null || (busyId !== undefined && busyId !== e.id)}
                      onClick={() => act(e, 'approve')}
                    >
                      <Check aria-hidden className="size-3.5" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      aria-label={`Reject ${e.student.full_name}`}
                      loading={busyId === e.id && review.variables?.action === 'reject'}
                      disabled={bulk !== null || (busyId !== undefined && busyId !== e.id)}
                      onClick={() => act(e, 'reject')}
                    >
                      <X aria-hidden className="size-3.5" />
                      Reject
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- approved

function ApprovedSection({ classId }: { classId: number }) {
  const approved = useAllEnrollments(classId, 'approved')
  const review = useReviewEnrollment(classId)
  const [toRemove, setToRemove] = useState<Enrollment | null>(null)

  const items = approved.data ?? []
  const view = useTableView(items, { pageSize: APPROVED_PAGE_SIZE, searchText: studentText })

  function remove(e: Enrollment) {
    review.mutate(
      { id: e.id, action: 'remove' },
      {
        onSuccess: () => {
          setToRemove(null)
          toast.success(`${e.student.full_name} was removed from the class`)
        },
        onError: (err) => {
          setToRemove(null)
          toast.error(errorMessage(err))
        },
      },
    )
  }

  return (
    <section aria-labelledby="approved-heading" className="flex flex-col gap-3">
      <h2 id="approved-heading" className="text-lg font-semibold">
        Students in this class{approved.data ? ` (${items.length})` : ''}
      </h2>

      {items.length > 0 && (
        <TableToolbar
          what="students"
          placeholder="Name, username or student no."
          search={view.search}
          onSearch={view.setSearch}
          active={view.active}
          onClear={view.clear}
          shown={view.matches.length}
          total={items.length}
        />
      )}

      {approved.isPending ? (
        <ListSkeleton rows={5} />
      ) : approved.isError && !approved.data ? (
        <EmptyState
          title="Students could not be loaded"
          action={<Button onClick={() => void approved.refetch()}>Try again</Button>}
        >
          {errorMessage(approved.error)}
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState title="No students yet">
          Create an invite code, share it with your students, then approve their requests above.
        </EmptyState>
      ) : view.matches.length === 0 ? (
        <NoMatches what="students" onClear={view.clear} />
      ) : (
        <div>
          <Table caption="Approved students">
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Student no.</Th>
                <Th>Approved</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <StudentCell e={e} />
                  </Td>
                  <Td>{e.student.student_no ?? <span className="text-ink-muted">—</span>}</Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {e.reviewed_at ? formatDateTime(e.reviewed_at) : '—'}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1.5">
                      <Link
                        to={`/classes/${classId}/students/${e.student.id}/workspace`}
                        state={{ backTo: `/classes/${classId}?tab=students` }}
                        aria-label={`View the workspace of ${e.student.full_name}`}
                        className={buttonClass('secondary', 'sm')}
                      >
                        <Eye aria-hidden className="size-3.5" />
                        Workspace
                      </Link>
                      <Button
                        size="sm"
                        aria-label={`Remove ${e.student.full_name}`}
                        onClick={() => setToRemove(e)}
                      >
                        <UserMinus aria-hidden className="size-3.5" />
                        Remove
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
          size={APPROVED_PAGE_SIZE}
          total={view.matches.length}
          onPageChange={view.setPage}
        />
      )}

      <ConfirmDialog
        open={toRemove !== null}
        title="Remove this student?"
        confirmLabel="Remove student"
        destructive
        loading={review.isPending}
        onConfirm={() => toRemove && remove(toRemove)}
        onCancel={() => setToRemove(null)}
      >
        <strong className="text-ink">{toRemove?.student.full_name}</strong> will lose access to this
        class right away. Their files are kept.
      </ConfirmDialog>
    </section>
  )
}
