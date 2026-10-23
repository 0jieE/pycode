import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Lock, Send } from 'lucide-react'
import {
  useActivity,
  useCreateActivity,
  usePublishActivity,
  useUpdateActivity,
} from '@/api/queries/activities'
import { useClass } from '@/api/queries/classes'
import { ApiError, errorMessage } from '@/api/errors'
import type { Activity, StarterFile } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { TextAreaField } from '@/components/ui/TextAreaField'
import { Tabs, TabPanel } from '@/components/ui/Tabs'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import { useIdParam } from '@/lib/params'
import { validateActivityTitle } from '@/lib/paths'
import { starterFilesProblem } from '@/lib/starterFiles'
import { isoToManilaInput, manilaInputToIso } from '@/lib/time'
import { ActivityLifecycleButtons } from './ActivityLifecycleButtons'
import { StarterFilesEditor } from './StarterFilesEditor'
import { TestCasesTab } from './TestCasesTab'
import { buttonClass } from '@/components/ui/buttonStyles'

/** Create (`/activities/new`) or edit (`/activities/:activityId`) one activity. */
export function ActivityEditorPage() {
  const classId = useIdParam('classId')
  const rawActivityId = useParams().activityId
  const activityId = useIdParam('activityId')
  const isNew = rawActivityId === undefined

  if (classId === null || (!isNew && activityId === null)) return <NotFound classId={classId} />
  return <ActivityLoader classId={classId} activityId={isNew ? null : activityId} />
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

function ActivityLoader({ classId, activityId }: { classId: number; activityId: number | null }) {
  const activity = useActivity(classId, activityId)

  if (activityId === null) return <ActivityForm classId={classId} activity={null} />
  if (activity.isPending) return <PageSpinner label="Loading activity" />
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
  // A different activity (or a refetch after saving) must not leak old form state.
  return <ActivityForm classId={classId} activity={activity.data} key={activity.data.id} />
}

interface FormState {
  title: string
  instructions: string
  due: string
  files: StarterFile[]
}

function toFormState(a: Activity | null): FormState {
  return {
    title: a?.title ?? '',
    instructions: a?.instructions ?? '',
    due: a?.due_at ? isoToManilaInput(a.due_at) : '',
    files: a?.starter_files ?? [],
  }
}

function sameForm(a: FormState, b: FormState): boolean {
  return (
    a.title.trim() === b.title.trim() &&
    a.instructions.trim() === b.instructions.trim() &&
    a.due === b.due &&
    JSON.stringify(a.files) === JSON.stringify(b.files)
  )
}

function ActivityForm({ classId, activity }: { classId: number; activity: Activity | null }) {
  const navigate = useNavigate()
  const cls = useClass(classId)
  const create = useCreateActivity(classId)
  const update = useUpdateActivity(classId)
  const publish = usePublishActivity(classId)

  const published = activity?.is_published ?? false
  const baseline = toFormState(activity)
  const [form, setForm] = useState<FormState>(baseline)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [tab, setTab] = useState<'details' | 'tests'>('details')

  const dirty = !sameForm(form, baseline)
  const saving = create.isPending || update.isPending

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  /** Field problems are shown here; the server has the final say. */
  function validate(): { dueIso: string | null } | null {
    setFormError(null)
    let ok = true
    if (!published) {
      const t = validateActivityTitle(form.title)
      setTitleError(t)
      if (t) ok = false
      const files = starterFilesProblem(form.files)
      if (files) {
        setFormError(files)
        ok = false
      }
    }
    const dueIso = form.due ? manilaInputToIso(form.due) : null
    if (form.due && !dueIso) {
      setFormError('The due date is not valid.')
      ok = false
    }
    return ok ? { dueIso } : null
  }

  function showServerError(err: unknown) {
    if (err instanceof ApiError && (err.code === 'TITLE_TAKEN' || err.code === 'INVALID_TITLE')) {
      setTitleError(err.detail)
    } else {
      setFormError(errorMessage(err))
    }
  }

  function save() {
    const checked = validate()
    if (!checked) return
    const instructions = form.instructions.trim() === '' ? null : form.instructions
    const common = { instructions, due_at: checked.dueIso }

    if (!activity) {
      create.mutate(
        {
          title: form.title.trim(),
          starter_files: form.files,
          entry_file: 'main.py',
          ignore_input_prompts: true,
          ...common,
        },
        {
          onSuccess: (created) => {
            toast.success('Draft saved')
            navigate(`/classes/${classId}/activities/${created.id}`, { replace: true })
          },
          onError: showServerError,
        },
      )
      return
    }

    // After publishing, title and starter files are locked, so they are not sent at all.
    const body = published
      ? common
      : { title: form.title.trim(), starter_files: form.files, ...common }
    update.mutate(
      { id: activity.id, body },
      { onSuccess: () => toast.success('Saved'), onError: showServerError },
    )
  }

  function doPublish() {
    if (!activity) return
    publish.mutate(activity.id, {
      onSuccess: () => {
        setConfirmPublish(false)
        toast.success('Published. The folder is now in every approved student’s workspace.')
      },
      onError: (err) => {
        setConfirmPublish(false)
        showServerError(err)
      },
    })
  }

  const students = cls.data?.approved_count

  return (
    <div className="page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {activity ? (published ? activity.title : 'Edit activity') : 'New activity'}
          </h1>
          {activity &&
            (activity.is_archived ? (
              <Badge tone="warn">Archived</Badge>
            ) : (
              <Badge tone={published ? 'ok' : 'pending'}>{published ? 'Published' : 'Draft'}</Badge>
            ))}
        </div>
        <div className="flex items-center gap-2">
          {published && (
            <Link
              to={`/classes/${classId}/activities/${activity?.id}/submissions`}
              className={buttonClass('secondary', 'md')}
            >
              View submissions
            </Link>
          )}
          {activity && (
            <ActivityLifecycleButtons
              classId={classId}
              activity={activity}
              onDeleted={() => navigate(`/classes/${classId}?tab=activities`, { replace: true })}
            />
          )}
        </div>
      </header>

      {activity?.is_archived && (
        <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          This activity is archived: students do not see it, and its folder is read-only in their
          workspaces. Submissions and grades are kept. Unarchive it to bring it back.
        </p>
      )}

      {published && !activity?.is_archived && (
        <p className="flex items-start gap-2 rounded-lg bg-open-soft px-4 py-3 text-sm text-open">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          This activity is published. The title and starter files are locked because students
          already have the folder. You can still change the instructions and due date.
        </p>
      )}

      {formError && (
        <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
          {formError}
        </p>
      )}

      <Tabs
        label="Activity sections"
        active={tab}
        onChange={(id) => setTab(id as 'details' | 'tests')}
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'tests', label: 'Test cases' },
        ]}
      />

      {tab === 'tests' ? (
        <TabPanel id="tests">
          {activity ? (
            <TestCasesTab activity={activity} classId={classId} />
          ) : (
            <EmptyState title="Save the draft first">
              Test cases belong to a saved activity. Save the draft on the Details tab, then come
              back here to add them.
            </EmptyState>
          )}
        </TabPanel>
      ) : (
        <TabPanel id="details">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-5 card p-5">
              <TextField
                label="Title"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                error={titleError}
                disabled={published}
                maxLength={150}
                autoComplete="off"
              />
              <p className="-mt-3 text-sm text-ink-muted">
                The title is also the name of the folder students receive, so it cannot contain “/”.
              </p>

              <TextAreaField
                label="Instructions"
                hint="Shown to students as plain text. Markdown is not rendered, so write it so it reads well as is."
                value={form.instructions}
                onChange={(e) => set('instructions', e.target.value)}
                rows={8}
                maxLength={20000}
                className="font-mono"
              />

              <div className="max-w-xs">
                <TextField
                  label="Due date (optional)"
                  type="datetime-local"
                  value={form.due}
                  onChange={(e) => set('due', e.target.value)}
                />
                <p className="mt-1.5 text-sm text-ink-muted">
                  Philippine time. From then on students can still read, run and test the activity,
                  but not edit or submit it. Move the date to give them more time.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">Starter files</h2>
                <StarterFilesEditor
                  files={form.files}
                  onChange={(files) => set('files', files)}
                  readOnly={published}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-muted" aria-live="polite">
                {dirty ? 'You have unsaved changes.' : activity ? 'All changes saved.' : ''}
              </p>
              <div className="flex gap-2">
                <Button
                  variant={published ? 'primary' : 'secondary'}
                  loading={saving}
                  disabled={!dirty && !!activity}
                  onClick={save}
                >
                  {activity ? 'Save changes' : 'Save draft'}
                </Button>
                {activity && !published && (
                  <Button
                    variant="primary"
                    disabled={dirty}
                    title={dirty ? 'Save your changes first' : undefined}
                    onClick={() => setConfirmPublish(true)}
                  >
                    <Send aria-hidden className="size-4" />
                    Publish…
                  </Button>
                )}
              </div>
            </div>
          </div>
        </TabPanel>
      )}

      <ConfirmDialog
        open={confirmPublish}
        title="Publish this activity?"
        confirmLabel="Publish to students"
        loading={publish.isPending}
        onConfirm={doPublish}
        onCancel={() => setConfirmPublish(false)}
      >
        <p className="rounded-md bg-warn-soft px-3 py-2 font-medium text-warn">
          Title and starter files can&apos;t change after publishing.
        </p>
        <p className="mt-3">
          The folder <strong className="text-ink">{activity?.title}</strong> and its starter files
          will be added to the workspace of{' '}
          {students === undefined
            ? 'every approved student'
            : `${students} approved ${students === 1 ? 'student' : 'students'}`}
          . Files they already have are never overwritten. Students who are approved later get the
          folder too.
        </p>
      </ConfirmDialog>
    </div>
  )
}
