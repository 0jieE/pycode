import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Archive, ArchiveRestore } from 'lucide-react'
import { useClass, useUpdateClass } from '@/api/queries/classes'
import { useLiveSession } from '@/api/queries/sessions'
import { ApiError, errorMessage } from '@/api/errors'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import { toast } from '@/components/ui/toastStore'
import { useIdParam } from '@/lib/params'
import { ActivitiesTab } from './ActivitiesTab'
import { InviteCodesTab } from './InviteCodesTab'
import { SessionsTab } from './SessionsTab'
import { StudentsTab } from './StudentsTab'
import { TutorialProgressTab } from './TutorialProgressTab'

const TAB_IDS = ['students', 'codes', 'sessions', 'activities', 'tutorial'] as const
type TabId = (typeof TAB_IDS)[number]

function isTabId(value: string | null): value is TabId {
  return TAB_IDS.some((id) => id === value)
}

export function ClassDetailPage() {
  const classId = useIdParam('classId')
  if (classId === null) return <ClassNotFound />
  return <ClassDetail classId={classId} />
}

function ClassNotFound({ message }: { message?: string }) {
  return (
    <EmptyState
      title="Class not found"
      action={
        <Link to="/classes" className="font-medium text-brand-700 underline">
          Back to your classes
        </Link>
      }
    >
      {message ?? 'This class does not exist, or it belongs to another instructor.'}
    </EmptyState>
  )
}

function ClassDetail({ classId }: { classId: number }) {
  const [params, setParams] = useSearchParams()
  const cls = useClass(classId)
  const current = useLiveSession(classId)
  const update = useUpdateClass()
  const [confirmingArchive, setConfirmingArchive] = useState(false)

  const requested = params.get('tab')
  const tab: TabId = isTabId(requested) ? requested : 'students'

  if (cls.isPending) return <PageSpinner label="Loading class" />
  if (cls.isError) {
    const gone = cls.error instanceof ApiError && [403, 404].includes(cls.error.status)
    return gone ? (
      <ClassNotFound />
    ) : (
      <EmptyState
        title="The class could not be loaded"
        action={<Button onClick={() => void cls.refetch()}>Try again</Button>}
      >
        {errorMessage(cls.error)}
      </EmptyState>
    )
  }

  const c = cls.data
  const labOpen = !!current.session

  function setArchived(isArchived: boolean) {
    update.mutate(
      { id: c.id, body: { is_archived: isArchived } },
      {
        onSuccess: () => {
          setConfirmingArchive(false)
          toast.success(isArchived ? `${c.name} was archived` : `${c.name} is active again`)
        },
        onError: (err) => {
          setConfirmingArchive(false)
          toast.error(errorMessage(err))
        },
      },
    )
  }

  return (
    <div className="page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <p className="text-ink-muted">
            {c.year_and_section} · School year {c.school_year}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {c.is_archived && <Badge tone="pending">Archived</Badge>}
          <Badge tone={labOpen ? 'open' : 'pending'}>
            {labOpen ? 'Laboratory OPEN' : 'Laboratory closed'}
          </Badge>
          {c.is_archived ? (
            <Button
              size="sm"
              aria-label={`Restore ${c.name}`}
              loading={update.isPending}
              onClick={() => setArchived(false)}
            >
              <ArchiveRestore aria-hidden className="size-3.5" />
              Restore
            </Button>
          ) : (
            <Button
              size="sm"
              aria-label={`Archive ${c.name}`}
              onClick={() => setConfirmingArchive(true)}
            >
              <Archive aria-hidden className="size-3.5" />
              Archive
            </Button>
          )}
        </div>
      </header>

      <div>
        <Tabs
          label="Class sections"
          active={tab}
          onChange={(id) => setParams({ tab: id }, { replace: true })}
          tabs={[
            { id: 'students', label: 'Students', badge: c.pending_count },
            { id: 'codes', label: 'Invite codes' },
            { id: 'sessions', label: 'Sessions' },
            { id: 'activities', label: 'Activities' },
            { id: 'tutorial', label: 'Tutorial progress' },
          ]}
        />
        <TabPanel id={tab}>
          {tab === 'students' && <StudentsTab classId={classId} />}
          {tab === 'codes' && <InviteCodesTab classId={classId} archived={c.is_archived} />}
          {tab === 'sessions' && <SessionsTab classId={classId} archived={c.is_archived} />}
          {tab === 'activities' && <ActivitiesTab classId={classId} />}
          {tab === 'tutorial' && <TutorialProgressTab classId={classId} className={c.name} />}
        </TabPanel>
      </div>

      <ConfirmDialog
        open={confirmingArchive}
        title="Archive this class?"
        confirmLabel="Archive"
        loading={update.isPending}
        onConfirm={() => setArchived(true)}
        onCancel={() => setConfirmingArchive(false)}
      >
        <strong className="text-ink">{c.name}</strong> is hidden from your class list and no new
        students or lab sessions can be added. Nothing is deleted, and you can restore it later.
      </ConfirmDialog>
    </div>
  )
}
