import { Link } from 'react-router-dom'
import { DoorClosed, DoorOpen } from 'lucide-react'
import { useActivities } from '@/api/queries/activities'
import { useAuth } from '@/auth/AuthContext'
import { useMyClasses } from '@/api/queries/myClasses'
import { useLabCloseReason, useLiveSession } from '@/api/queries/sessions'
import { SessionClock } from '@/components/SessionClock'
import { useMySubmissions } from '@/api/queries/submissions'
import { errorMessage } from '@/api/errors'
import type { Activity, MySubmission } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Skeleton } from '@/components/ui/Spinner'
import { formatScore } from '@/features/workspace/testResults'
import { useLastTest } from '@/lib/lastTests'
import { useIdParam } from '@/lib/params'
import { formatDateTime } from '@/lib/time'
import { useNow } from '@/lib/useNow'
import { closeReasonText } from '@/lib/labSession'
import { buttonClass } from '@/components/ui/buttonStyles'
import { RequirementsList } from '@/features/workspace/RequirementsList'
import { hasRequirements } from '@/lib/requirements'

const linkButton = (primary: boolean) => buttonClass(primary ? 'primary' : 'secondary', 'md')

export function ClassHome() {
  const classId = useIdParam('classId')
  if (classId === null) return <NotAvailable message="This class does not exist." />
  return <Home classId={classId} />
}

function NotAvailable({ message }: { message: string }) {
  return (
    <EmptyState
      title="Class not available"
      action={
        <Link to="/my/classes" className="font-medium text-brand-700 underline">
          Back to my classes
        </Link>
      }
    >
      {message}
    </EmptyState>
  )
}

function Home({ classId }: { classId: number }) {
  const myClasses = useMyClasses()
  const cls = myClasses.data?.find((c) => c.class_id === classId)
  const approved = cls?.status === 'approved'

  // Both only work for approved students: skip them (and their 403s) until we know.
  const session = useLiveSession(classId, { enabled: approved })
  const closeReason = useLabCloseReason((s) => s.byClass[classId])
  const activities = useActivities(classId, { page: 1, size: 100 }, { enabled: approved })
  const submissions = useMySubmissions(classId, { enabled: approved })
  // activity id -> what I handed in. A failed load just means no badges: the page still works.
  const submissionByActivity = new Map((submissions.data ?? []).map((s) => [s.activity_id, s]))

  if (myClasses.isPending) return <PageSpinner label="Loading class" />
  if (myClasses.isError) {
    return (
      <EmptyState
        title="The class could not be loaded"
        action={<Button onClick={() => void myClasses.refetch()}>Try again</Button>}
      >
        {errorMessage(myClasses.error)}
      </EmptyState>
    )
  }
  if (!cls) return <NotAvailable message="You have not joined this class." />
  if (!approved) {
    return (
      <NotAvailable
        message={
          cls.status === 'pending'
            ? `You are waiting for ${cls.instructor_name} to approve you.`
            : 'Your instructor did not approve your request to join this class.'
        }
      />
    )
  }

  const labOpen = !!session.session
  const items = activities.data?.items ?? []

  return (
    <div className="page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{cls.class_name}</h1>
          <p className="text-ink-muted">
            {cls.year_and_section} · School year {cls.school_year} · {cls.instructor_name}
          </p>
        </div>
      </header>

      {session.isPending ? (
        <Skeleton className="h-14 w-full" />
      ) : (
        <div
          role="status"
          className={`flex items-center gap-3 rounded-xl border-2 px-5 py-3 ${
            labOpen ? 'border-open bg-open-soft text-open' : 'border-line bg-surface text-ink-muted'
          }`}
        >
          {labOpen ? (
            <DoorOpen aria-hidden className="size-6" />
          ) : (
            <DoorClosed aria-hidden className="size-6" />
          )}
          <p className="text-lg font-semibold">
            {labOpen ? 'Laboratory is OPEN' : 'Laboratory access is closed — read-only'}
          </p>
          {labOpen && session.session ? (
            <SessionClock session={session.session} className="ml-auto text-sm" />
          ) : (
            closeReason && <p className="ml-auto text-sm">{closeReasonText(closeReason)}</p>
          )}
        </div>
      )}

      <section aria-labelledby="activities-heading" className="flex flex-col gap-3">
        <h2 id="activities-heading" className="text-lg font-semibold">
          Activities
        </h2>
        {activities.isPending ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Loading activities">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : activities.isError ? (
          <EmptyState
            title="Activities could not be loaded"
            action={<Button onClick={() => void activities.refetch()}>Try again</Button>}
          >
            {errorMessage(activities.error)}
          </EmptyState>
        ) : items.length === 0 ? (
          <EmptyState title="No activities yet">
            When your instructor publishes an activity, its folder appears in your workspace.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((a) => (
              <ActivityCard
                key={a.id}
                classId={classId}
                activity={a}
                submission={submissionByActivity.get(a.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ActivityCard({
  classId,
  activity: a,
  submission,
}: {
  classId: number
  activity: Activity
  submission: MySubmission | undefined
}) {
  const now = useNow()
  const { user } = useAuth()
  // What the Test button last reported for this activity (see lib/lastTests.ts).
  const lastTest = useLastTest(user?.id ?? null, a.id)
  const pastDue = a.due_at !== null && new Date(a.due_at).getTime() < now
  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{a.title}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {a.due_at ? `Due ${formatDateTime(a.due_at)}` : 'No due date'}
            {/* Past the deadline the activity is closed: read, run and test only. */}
            {pastDue && (
              <Badge tone={submission ? 'pending' : 'warn'}>
                {submission ? 'Closed' : 'Past due: closed'}
              </Badge>
            )}
          </p>
          {lastTest && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={lastTest.passed === lastTest.total ? 'ok' : 'warn'}>
                Last test: {lastTest.passed}/{lastTest.total} passed
              </Badge>
              <span className="text-ink-muted">
                {formatScore(lastTest.score, lastTest.maxScore)} pts · {formatDateTime(lastTest.at)}
              </span>
            </p>
          )}
          {submission && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={submission.status === 'late' ? 'warn' : 'ok'}>
                {submission.status === 'late' ? 'Late' : 'Submitted'}
              </Badge>
              <span className="text-ink-muted">
                {submission.status === 'late' ? 'Handed in late on ' : 'Handed in on '}
                {formatDateTime(submission.submitted_at)}
              </span>
            </p>
          )}
        </div>
        <Link
          to={`/my/classes/${classId}/workspace?activity=${a.id}`}
          className={linkButton(true)}
          aria-label={`Open ${a.title} in workspace`}
        >
          Open in workspace
        </Link>
      </div>
      {(a.instructions || hasRequirements(a.requirements)) && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-brand-700">Instructions</summary>
          {a.instructions && (
            <p className="mt-2 leading-relaxed whitespace-pre-wrap">{a.instructions}</p>
          )}
          <div className="mt-2 empty:hidden">
            <RequirementsList requirements={a.requirements} />
          </div>
        </details>
      )}
    </li>
  )
}
