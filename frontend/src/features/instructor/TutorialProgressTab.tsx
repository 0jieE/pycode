import { useState } from 'react'
import { Download } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useUpdateClass } from '@/api/queries/classes'
import { tutorialKey, useTutorialProgress } from '@/api/queries/tutorial'
import { errorMessage } from '@/api/errors'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SelectField } from '@/components/ui/SelectField'
import { Skeleton } from '@/components/ui/Spinner'
import { Switch } from '@/components/ui/Switch'
import { NoMatches, TableToolbar } from '@/components/ui/TableToolbar'
import { toast } from '@/components/ui/toastStore'
import { matchesSearch } from '@/lib/tableView'
import { formatDateTime } from '@/lib/time'
import {
  cellText,
  completion,
  matrixCsv,
  progressState,
  sortRows,
  type MatrixSort,
  type ProgressFilter,
} from '@/lib/tutorial'

const SORTS: { value: MatrixSort; label: string }[] = [
  { value: 'completion-desc', label: 'Completion, highest first' },
  { value: 'completion-asc', label: 'Completion, lowest first' },
  { value: 'name', label: 'Name' },
]

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** How far each student is in the Python Tutorial: one row per student, one column per lesson. */
export function TutorialProgressTab({
  classId,
  className,
}: {
  classId: number
  className: string
}) {
  const matrix = useTutorialProgress(classId)
  const updateClass = useUpdateClass()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ProgressFilter>('')
  const [sort, setSort] = useState<MatrixSort>('completion-desc')

  if (matrix.isPending) return <Skeleton className="h-64 w-full" />
  if (matrix.isError) {
    return (
      <EmptyState
        title="The tutorial progress could not be loaded"
        action={<Button onClick={() => void matrix.refetch()}>Try again</Button>}
      >
        {errorMessage(matrix.error)}
      </EmptyState>
    )
  }

  const m = matrix.data
  const n = m.lessons.length
  const rows = sortRows(
    m.students.filter(
      (r) =>
        matchesSearch(
          `${r.student.full_name} ${r.student.username} ${r.student.student_no ?? ''}`,
          search,
        ) &&
        (status === '' || progressState(r, n) === status),
    ),
    sort,
  )
  const average =
    m.students.length === 0
      ? 0
      : Math.round(m.students.reduce((sum, r) => sum + completion(r, n), 0) / m.students.length)

  const setInOrder = (on: boolean) =>
    updateClass.mutate(
      { id: classId, body: { tutorial_unlock_in_order: on } },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: tutorialKey })
          toast.success(on ? 'Lessons now open one after another' : 'Every lesson is open')
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4 card px-4 py-3">
        <div className="max-w-2xl">
          <p className="text-sm font-medium">Unlock lessons in order</p>
          <p className="mt-0.5 text-sm text-ink-muted">
            {m.unlock_in_order
              ? 'On: a student opens a lesson only after passing the one before it.'
              : 'Off: students may open any lesson.'}{' '}
            It applies to the students of this class (if any of a student&apos;s classes has it on,
            it is on for them).
          </p>
        </div>
        <Switch
          checked={m.unlock_in_order}
          label="Unlock lessons in order"
          disabled={updateClass.isPending}
          onChange={setInOrder}
        />
      </div>

      {m.students.length === 0 ? (
        <EmptyState title="No students yet">
          Approved students appear here with their progress in the Python Tutorial.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-sm text-ink-muted">
              {m.students.length} students · {n} lessons · class average {average}% · as of{' '}
              {formatDateTime(m.generated_at)}
            </p>
            <div className="flex items-end gap-2">
              <div className="w-56">
                <SelectField
                  label="Sort by"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as MatrixSort)}
                  options={SORTS}
                />
              </div>
              <Button
                onClick={() =>
                  download(
                    `tutorial-progress-${className.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'class'}.csv`,
                    matrixCsv(m, rows),
                  )
                }
              >
                <Download aria-hidden className="size-4" />
                Export CSV
              </Button>
            </div>
          </div>

          <TableToolbar
            what="students"
            placeholder="Name, username or student no."
            search={search}
            onSearch={setSearch}
            onFilter={(_, value) => setStatus(value as ProgressFilter)}
            active={search.trim() !== '' || status !== ''}
            onClear={() => {
              setSearch('')
              setStatus('')
            }}
            shown={rows.length}
            total={m.students.length}
            filters={[
              {
                id: 'status',
                label: 'Progress',
                value: status,
                allLabel: 'Any progress',
                options: [
                  { value: 'done', label: 'Finished every lesson' },
                  { value: 'in-progress', label: 'In progress' },
                  { value: 'not-started', label: 'Not started' },
                ],
              },
            ]}
          />

          {rows.length === 0 ? (
            <NoMatches
              what="students"
              onClear={() => {
                setSearch('')
                setStatus('')
              }}
            />
          ) : (
            <div className="overflow-auto rounded-xl border border-line">
              <table className="border-collapse text-sm">
                <caption className="sr-only">
                  Tutorial progress: a tick is a passed lesson, a number is how many times the
                  student checked it without passing yet.
                </caption>
                <thead className="bg-surface-2">
                  <tr>
                    <th
                      scope="col"
                      className="sticky left-0 z-10 min-w-52 bg-surface-2 px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
                    >
                      Student
                    </th>
                    <th
                      scope="col"
                      className="min-w-28 px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
                    >
                      Completed
                    </th>
                    {m.lessons.map((l, i) => (
                      <th
                        key={l.slug}
                        scope="col"
                        title={`${i + 1}. ${l.title}`}
                        className="w-9 min-w-9 px-1 py-2 text-center text-xs font-semibold text-ink-muted tabular-nums"
                      >
                        <span aria-hidden>{i + 1}</span>
                        <span className="sr-only">{l.title}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const pct = completion(r, n)
                    return (
                      <tr key={r.student.id} className="border-t border-line hover:bg-hover/50">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 bg-canvas px-3 py-1.5 text-left font-normal"
                        >
                          <span className="block font-medium text-ink-strong">
                            {r.student.full_name}
                          </span>
                          <span className="block font-mono text-xs text-ink-muted">
                            {r.student.student_no ?? r.student.username}
                          </span>
                        </th>
                        <td className="px-3 py-1.5">
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2">
                              <span
                                className="block h-full rounded-full bg-ok"
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                            <span className="text-xs tabular-nums">
                              {r.passed_count}/{n} · {pct}%
                            </span>
                          </span>
                        </td>
                        {m.lessons.map((l, i) => {
                          const cell = r.lessons[l.slug]
                          const text = cellText(cell)
                          return (
                            <td
                              key={l.slug}
                              title={
                                cell
                                  ? `${i + 1}. ${l.title}: ${
                                      cell.passed_at
                                        ? `passed ${formatDateTime(cell.passed_at)}`
                                        : `${cell.attempts} ${cell.attempts === 1 ? 'check' : 'checks'}, not passed yet`
                                    }`
                                  : `${i + 1}. ${l.title}: not opened`
                              }
                              className={`border-l border-line text-center text-xs tabular-nums ${
                                cell?.passed_at
                                  ? 'bg-ok-soft'
                                  : text
                                    ? 'bg-warn-soft text-warn'
                                    : ''
                              }`}
                            >
                              {text}
                              {cell?.passed_at && <span className="sr-only">passed</span>}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-muted">
            ✅ passed · a number = checks so far, not passed yet · empty = not tried. Hover a cell
            for the lesson and the date.
          </p>
        </>
      )}
    </div>
  )
}
