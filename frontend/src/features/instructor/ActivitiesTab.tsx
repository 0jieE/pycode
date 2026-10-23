import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, Plus } from 'lucide-react'
import { useAllActivities } from '@/api/queries/activities'
import { errorMessage } from '@/api/errors'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { Skeleton } from '@/components/ui/Spinner'
import { Table, Td, Th } from '@/components/ui/Table'
import { NoMatches, TableToolbar } from '@/components/ui/TableToolbar'
import { useTableView } from '@/lib/tableView'
import { formatDateTime } from '@/lib/time'
import { useNow } from '@/lib/useNow'
import { ActivityLifecycleButtons } from './ActivityLifecycleButtons'
import { buttonClass } from '@/components/ui/buttonStyles'

const PAGE_SIZE = 10

const linkButton = buttonClass('secondary', 'sm')

export function ActivitiesTab({ classId }: { classId: number }) {
  const [showArchived, setShowArchived] = useState(false)
  const activities = useAllActivities(classId, showArchived)
  const items = activities.data ?? []
  const now = useNow()
  const view = useTableView(items, {
    pageSize: PAGE_SIZE,
    searchText: (a) => a.title,
    filters: {
      status: (a, v) =>
        v === 'archived' ? a.is_archived : !a.is_archived && a.is_published === (v === 'published'),
      due: (a, v) =>
        v === 'none'
          ? a.due_at === null
          : a.due_at !== null &&
            (v === 'past'
              ? new Date(a.due_at).getTime() < now
              : new Date(a.due_at).getTime() >= now),
    },
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-muted">
          An activity becomes a folder in every student&apos;s workspace when you publish it.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={showArchived}
            aria-label="Show archived activities"
            onClick={() => setShowArchived((v) => !v)}
            title={showArchived ? 'Hide archived activities' : 'Show archived activities'}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${
              showArchived
                ? 'bg-hover text-ink-strong'
                : 'text-ink-muted hover:bg-hover hover:text-ink-strong'
            }`}
          >
            <Archive aria-hidden className="size-4" />
            Show archived
          </button>
          <Link to={`/classes/${classId}/activities/new`} className={buttonClass('primary', 'md')}>
            <Plus aria-hidden className="size-4" />
            New activity
          </Link>
        </div>
      </div>

      {items.length > 0 && (
        <TableToolbar
          what="activities"
          placeholder="Title"
          search={view.search}
          onSearch={view.setSearch}
          onFilter={view.setFilter}
          active={view.active}
          onClear={view.clear}
          shown={view.matches.length}
          total={items.length}
          filters={[
            {
              id: 'status',
              label: 'Status',
              value: view.filterValues.status ?? '',
              allLabel: showArchived ? 'Any status' : 'Draft or published',
              options: [
                { value: 'published', label: 'Published' },
                { value: 'draft', label: 'Draft' },
                ...(showArchived ? [{ value: 'archived', label: 'Archived' }] : []),
              ],
            },
            {
              id: 'due',
              label: 'Due date',
              value: view.filterValues.due ?? '',
              allLabel: 'Any due date',
              options: [
                { value: 'upcoming', label: 'Not due yet' },
                { value: 'past', label: 'Past due' },
                { value: 'none', label: 'No due date' },
              ],
            },
          ]}
        />
      )}

      {activities.isPending ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading activities">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : activities.isError && !activities.data ? (
        <EmptyState
          title="Activities could not be loaded"
          action={<Button onClick={() => void activities.refetch()}>Try again</Button>}
        >
          {errorMessage(activities.error)}
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState title={showArchived ? 'No activities' : 'No activities yet'}>
          Write the instructions, add starter files if you like, then publish to your students.
        </EmptyState>
      ) : view.matches.length === 0 ? (
        <NoMatches what="activities" onClear={view.clear} />
      ) : (
        <div>
          <Table caption="Activities">
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link
                      to={`/classes/${classId}/activities/${a.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {a.title}
                    </Link>
                    <p className="text-xs text-ink-muted">
                      {a.starter_files.length}{' '}
                      {a.starter_files.length === 1 ? 'starter file' : 'starter files'}
                    </p>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-muted">
                    {a.due_at ? formatDateTime(a.due_at) : 'No due date'}
                  </Td>
                  <Td>
                    {a.is_archived ? (
                      <Badge tone="warn">Archived</Badge>
                    ) : (
                      <Badge tone={a.is_published ? 'ok' : 'pending'}>
                        {a.is_published ? 'Published' : 'Draft'}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1.5">
                      <Link
                        to={`/classes/${classId}/activities/${a.id}`}
                        className={linkButton}
                        aria-label={`${a.is_published ? 'View' : 'Edit'} ${a.title}`}
                      >
                        {a.is_published ? 'View' : 'Edit'}
                      </Link>
                      {a.is_published && (
                        <Link
                          to={`/classes/${classId}/activities/${a.id}/submissions`}
                          className={linkButton}
                          aria-label={`Submissions for ${a.title}`}
                        >
                          Submissions
                        </Link>
                      )}
                      <ActivityLifecycleButtons classId={classId} activity={a} size="sm" />
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
    </div>
  )
}
