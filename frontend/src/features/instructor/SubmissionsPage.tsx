import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw } from 'lucide-react'
import { useActivity } from '@/api/queries/activities'
import { useAllEnrollments } from '@/api/queries/enrollments'
import { useAllSubmissions } from '@/api/queries/submissions'
import { useRegrade } from '@/api/queries/testCases'
import { ApiError, errorMessage } from '@/api/errors'
import { Badge } from '@/components/ui/Badge'
import type { SubmissionListItem } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Skeleton } from '@/components/ui/Spinner'
import { Table, Td, Th } from '@/components/ui/Table'
import { NoMatches, TableToolbar } from '@/components/ui/TableToolbar'
import { toast } from '@/components/ui/toastStore'
import { formatScore } from '@/features/workspace/testResults'
import { useIdParam } from '@/lib/params'
import { matchesSearch, useTableView } from '@/lib/tableView'
import { formatDateTime } from '@/lib/time'
import { buttonClass } from '@/components/ui/buttonStyles'
import { HardcodeBadge } from './HardcodeFlag'

export function SubmissionsPage() {
  const classId = useIdParam('classId')
  const activityId = useIdParam('activityId')
  if (classId === null || activityId === null) return <NotFound classId={classId} />
  return <Submissions classId={classId} activityId={activityId} />
}

function NotFound({ classId }: { classId: number | null }) {
  return (
    <EmptyState
      title="Activity not found"
      action={
        <Link
          to={classId === null ? '/classes' : `/classes/${classId}?tab=activities`}
          className="font-medium text-brand-700 underline"
        >
          Back to activities
        </Link>
      }
    >
      This activity does not exist, or it belongs to another instructor.
    </EmptyState>
  )
}

function Submissions({ classId, activityId }: { classId: number; activityId: number }) {
  const activity = useActivity(classId, activityId)
  const submissions = useAllSubmissions(activityId)
  const students = useAllEnrollments(classId, 'approved')

  // Approved students with no submission yet.
  const missing = useMemo(() => {
    if (!students.data || !submissions.data) return []
    const done = new Set(submissions.data.map((s) => s.student.id))
    return students.data.filter((e) => !done.has(e.student.id))
  }, [students.data, submissions.data])

  const qc = useQueryClient()
  const regrade = useRegrade(activityId)
  const [confirmRegrade, setConfirmRegrade] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null)
  const sorted = useMemo(
    () => sortSubmissions(submissions.data ?? [], sort),
    [submissions.data, sort],
  )
  const view = useTableView(sorted, {
    pageSize: Number.MAX_SAFE_INTEGER, // one list: the sort and the score matter more than pages
    searchText: (s) => `${s.student.full_name} ${s.student.username} ${s.student.student_no ?? ''}`,
    filters: {
      score: (s, v) =>
        v === 'ungraded'
          ? s.score == null || s.max_score == null
          : s.score != null &&
            s.max_score != null &&
            (v === 'full' ? s.score === s.max_score : s.score < s.max_score),
    },
  })
  // The students who have not submitted answer to the same search box.
  const shownMissing = missing.filter((e) =>
    matchesSearch(
      `${e.student.full_name} ${e.student.username} ${e.student.student_no ?? ''}`,
      view.search,
    ),
  )

  // After "Re-grade all" the new scores arrive over the next seconds: look a few times.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  function doRegrade() {
    regrade.mutate(undefined, {
      onSuccess: (res) => {
        setConfirmRegrade(false)
        toast.success(
          res.queued === 0
            ? 'Nothing to re-grade: every submission is already waiting to be graded.'
            : `Re-grading ${res.queued} ${res.queued === 1 ? 'submission' : 'submissions'}${
                res.skipped > 0 ? ` (${res.skipped} already waiting)` : ''
              }. Scores update in a few seconds.`,
        )
        for (const ms of [3000, 8000, 15000, 30000]) {
          timers.current.push(
            setTimeout(
              () => void qc.invalidateQueries({ queryKey: ['submissions', activityId] }),
              ms,
            ),
          )
        }
      },
      onError: (err) => {
        setConfirmRegrade(false)
        toast.error(errorMessage(err))
      },
    })
  }

  if (activity.isPending) return <PageSpinner label="Loading" />
  if (activity.isError) {
    const gone = activity.error instanceof ApiError && [403, 404].includes(activity.error.status)
    return gone ? (
      <NotFound classId={classId} />
    ) : (
      <EmptyState
        title="The activity could not be loaded"
        action={<Button onClick={() => void activity.refetch()}>Try again</Button>}
      >
        {errorMessage(activity.error)}
      </EmptyState>
    )
  }

  const a = activity.data
  const done = submissions.data ?? []
  const late = done.filter((s) => s.status === 'late').length
  const total = students.data?.length
  const loading = submissions.isPending || students.isPending

  return (
    <div className="page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Submissions: {a.title}</h1>
          <p className="mt-1 text-ink-muted">
            {a.due_at ? `Due ${formatDateTime(a.due_at)}` : 'No due date'}
            {!loading && total !== undefined && (
              <>
                {' · '}
                <strong className="text-ink">
                  {done.length} of {total}
                </strong>{' '}
                submitted
                {late > 0 && `, ${late} late`}
              </>
            )}
          </p>
          {!a.is_published && (
            <p className="mt-2 text-sm text-warn">
              This activity is still a draft, so no one can submit.
            </p>
          )}
        </div>
        <Button
          disabled={done.length === 0}
          title="Grade every submission again with the current test cases"
          onClick={() => setConfirmRegrade(true)}
        >
          <RefreshCw aria-hidden className="size-4" />
          Re-grade all
        </Button>
      </header>

      <section aria-labelledby="submitted-heading" className="flex flex-col gap-3">
        <h2 id="submitted-heading" className="text-lg font-semibold">
          Submitted
        </h2>
        {done.length > 0 && (
          <TableToolbar
            what="submissions"
            placeholder="Student name, username or no."
            search={view.search}
            onSearch={view.setSearch}
            onFilter={view.setFilter}
            active={view.active}
            onClear={view.clear}
            shown={view.matches.length}
            total={done.length}
            filters={[
              {
                id: 'score',
                label: 'Score',
                value: view.filterValues.score ?? '',
                allLabel: 'Any score',
                options: [
                  { value: 'full', label: 'Full marks' },
                  { value: 'partial', label: 'Below full marks' },
                  { value: 'ungraded', label: 'Not graded yet' },
                ],
              },
            ]}
          />
        )}

        {submissions.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : submissions.isError ? (
          <EmptyState
            title="Submissions could not be loaded"
            action={<Button onClick={() => void submissions.refetch()}>Try again</Button>}
          >
            {errorMessage(submissions.error)}
          </EmptyState>
        ) : done.length === 0 ? (
          <EmptyState title="No submissions yet">
            Submissions appear here as soon as students submit.
          </EmptyState>
        ) : view.matches.length === 0 ? (
          <NoMatches what="submissions" onClear={view.clear} />
        ) : (
          <Table caption="Submitted work">
            <thead>
              <tr>
                <SortTh label="Student" sortKey="student" sort={sort} onSort={setSort} />
                <SortTh label="Submitted" sortKey="submitted" sort={sort} onSort={setSort} />
                <Th>Files</Th>
                <SortTh label="Score" sortKey="score" sort={sort} onSort={setSort} />
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {view.matches.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <p className="font-medium">{s.student.full_name}</p>
                    <p className="font-mono text-xs text-ink-muted">{s.student.username}</p>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {formatDateTime(s.submitted_at)}
                    {/* Before submissions closed at the due date, late ones were accepted and marked. */}
                    {s.status === 'late' && (
                      <span className="ml-2">
                        <Badge tone="warn">Late</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>{s.file_count}</Td>
                  <Td className="whitespace-nowrap">
                    <ScoreCell s={s} />
                    {s.hardcode_suspected && (
                      <div className="mt-1">
                        <HardcodeBadge suspected={s.hardcode_suspected} tests={s.hardcode_tests} />
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div className="flex justify-end">
                      <Link
                        to={`/classes/${classId}/activities/${activityId}/submissions/${s.id}`}
                        aria-label={`View work of ${s.student.full_name}`}
                        className={buttonClass('secondary', 'sm')}
                      >
                        View work
                      </Link>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="missing-heading" className="flex flex-col gap-3">
        <h2 id="missing-heading" className="text-lg font-semibold">
          Not yet submitted{!loading ? ` (${missing.length})` : ''}
        </h2>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : students.isError ? (
          <p className="text-sm text-error">{errorMessage(students.error)}</p>
        ) : missing.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-5 text-center text-sm text-ink-muted">
            {total === 0 ? 'The class has no approved students yet.' : 'Everyone has submitted.'}
          </p>
        ) : shownMissing.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-5 text-center text-sm text-ink-muted">
            No one who has not submitted matches the search.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shownMissing.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2"
              >
                <span className="truncate">
                  <span className="font-medium">{e.student.full_name}</span>{' '}
                  <span className="font-mono text-xs text-ink-muted">{e.student.username}</span>
                </span>
                <Badge tone="pending">Not submitted</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ConfirmDialog
        open={confirmRegrade}
        title="Re-grade every submission?"
        confirmLabel="Re-grade all"
        loading={regrade.isPending}
        onConfirm={doRegrade}
        onCancel={() => setConfirmRegrade(false)}
      >
        Every submission is graded again with the test cases as they are now. Use this after fixing
        an expected output. Each score is replaced when its new grading finishes.
      </ConfirmDialog>
    </div>
  )
}

type SortKey = 'student' | 'submitted' | 'score'
type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null

/** The share of the points earned, or null while the submission has no score. */
function scoreFraction(s: SubmissionListItem): number | null {
  if (s.score == null || s.max_score == null) return null
  return s.max_score === 0 ? 1 : s.score / s.max_score
}

function sortSubmissions(items: SubmissionListItem[], sort: Sort): SubmissionListItem[] {
  if (!sort) return items
  const sign = sort.dir === 'asc' ? 1 : -1
  return items.slice().sort((x, y) => {
    if (sort.key === 'score') {
      const a = scoreFraction(x)
      const b = scoreFraction(y)
      // Not graded yet always goes last, whichever way the list is sorted.
      if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
      return (a - b || (x.score ?? 0) - (y.score ?? 0)) * sign
    }
    if (sort.key === 'submitted') return x.submitted_at.localeCompare(y.submitted_at) * sign
    return x.student.full_name.localeCompare(y.student.full_name) * sign
  })
}

function SortTh({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string
  sortKey: SortKey
  sort: Sort
  onSort: (next: Sort) => void
}) {
  const active = sort?.key === sortKey
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <Th aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() =>
          onSort(
            active && sort.dir === 'desc'
              ? { key: sortKey, dir: 'asc' }
              : { key: sortKey, dir: active ? 'desc' : sortKey === 'score' ? 'desc' : 'asc' },
          )
        }
        className="inline-flex items-center gap-1 tracking-wide uppercase hover:text-ink"
      >
        {label}
        <Icon aria-hidden className={`size-3 ${active ? 'text-ink' : 'opacity-60'}`} />
      </button>
    </Th>
  )
}

function ScoreCell({ s }: { s: SubmissionListItem }) {
  if (s.score == null || s.max_score == null) {
    return <span className="text-ink-muted">Not graded yet</span>
  }
  if (s.max_score === 0) return <span className="text-ink-muted">No points</span>
  const full = s.score === s.max_score
  return (
    <div>
      <p className={`font-semibold ${full ? 'text-ok' : s.score === 0 ? 'text-error' : ''}`}>
        {formatScore(s.score, s.max_score)}
      </p>
      {s.tests_passed != null && s.tests_total != null && (
        <p className="text-xs text-ink-muted">
          {s.tests_passed} of {s.tests_total} {s.tests_total === 1 ? 'test' : 'tests'}
        </p>
      )}
    </div>
  )
}
