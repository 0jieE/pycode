import { useState } from 'react'
import { BookOpen, CheckCircle2, Send } from 'lucide-react'
import { useMySubmissions, useSubmitActivity } from '@/api/queries/submissions'
import { errorMessage } from '@/api/errors'
import type { Activity, MySubmission, SubmissionOut } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogBody, DialogFooter } from '@/components/ui/Dialog'
import { toast } from '@/components/ui/toastStore'
import { formatDateTime } from '@/lib/time'
import { useNow } from '@/lib/useNow'
import type { Saver } from './saver'
import { RequirementsList } from './RequirementsList'

interface SubmitControlProps {
  activity: Activity
  saver: Saver
  /** Why Submit is off (the latest code has not been tested yet), or null. */
  blockedReason?: string | null
}

/** Submit button for the activity folder the student is working in, plus the submitted time. */
export function SubmitControl({ activity, saver, blockedReason = null }: SubmitControlProps) {
  const submit = useSubmitActivity(activity.class_id)
  const mine = useMySubmissions(activity.class_id)
  const [confirming, setConfirming] = useState(false)
  // Right after submitting, show the reply at once; the server's list (which also survives a reload)
  // takes over when it refreshes.
  const [justSubmitted, setJustSubmitted] = useState<SubmissionOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  // From the due date on, submissions are closed (the instructor moves the date to give more time).
  const now = useNow(15_000)
  const pastDue = activity.due_at !== null && new Date(activity.due_at).getTime() <= now
  const closedReason = pastDue
    ? `'${activity.title}' was due on ${formatDateTime(activity.due_at!)}: submissions are closed.`
    : null
  const offReason = closedReason ?? blockedReason

  async function doSubmit() {
    setError(null)
    // The snapshot is taken from the server's copy, so everything typed must be saved first.
    const saved = await saver.saveAll()
    if (saved !== 'saved') {
      setConfirming(false)
      toast.error(
        saved === 'locked'
          ? 'Your latest changes could not be saved because access was closed, so they would not be in your submission.'
          : 'Fix the problem saving your files first, then submit again.',
      )
      return
    }
    submit.mutate(activity.id, {
      onSuccess: (done) => {
        setConfirming(false)
        setJustSubmitted(done)
        toast.success(`Submitted '${activity.title}'`)
      },
      onError: (err) => setError(errorMessage(err)),
    })
  }

  // After a re-submit the cached list is briefly older than the reply: show whichever is newer.
  const known: Pick<MySubmission, 'status' | 'submitted_at'>[] = [
    mine.data?.find((s) => s.activity_id === activity.id),
    justSubmitted ?? undefined,
  ].filter((s) => s !== undefined)
  const result = known.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0] ?? null

  return (
    <div className="flex items-center gap-3">
      {result && (
        <p className="flex items-center gap-1.5 text-sm" aria-live="polite">
          <CheckCircle2 aria-hidden className="size-4 text-ok" />
          Submitted {formatDateTime(result.submitted_at)}
          {result.status === 'late' && <Badge tone="warn">Late</Badge>}
        </p>
      )}
      {closedReason ? (
        <span className="text-xs text-warn">Past due</span>
      ) : (
        blockedReason && <span className="text-xs text-warn">Run Test first</span>
      )}
      <Button
        variant="primary"
        disabled={offReason !== null}
        title={offReason ?? `Submit the '${activity.title}' folder`}
        onClick={() => {
          setError(null)
          setConfirming(true)
        }}
      >
        <Send aria-hidden className="size-4" />
        {result ? 'Submit again' : 'Submit'}
      </Button>

      <ConfirmDialog
        open={confirming}
        title={`Submit everything in '${activity.title}'?`}
        confirmLabel="Submit"
        loading={submit.isPending}
        onConfirm={() => void doSubmit()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          Your files in the <strong className="text-ink">{activity.title}</strong> folder are handed
          in as they are saved now.{' '}
          {activity.due_at
            ? `You can submit again to replace this one until ${formatDateTime(activity.due_at)}. After that the folder is read-only and submissions are closed.`
            : 'You can submit again later to replace this one.'}
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded-md bg-error-soft px-3 py-2 text-error">
            {error}
          </p>
        )}
      </ConfirmDialog>
    </div>
  )
}

export function InstructionsButton({ activity }: { activity: Activity }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <BookOpen aria-hidden className="size-4" />
        Instructions
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={activity.title} width="max-w-2xl">
        <DialogBody>
          {activity.due_at && (
            <p className="mb-3 text-sm text-ink-muted">Due {formatDateTime(activity.due_at)}</p>
          )}
          {activity.instructions ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{activity.instructions}</p>
          ) : (
            <p className="text-sm text-ink-muted">Your instructor did not write instructions.</p>
          )}
          <div className="mt-4 empty:hidden">
            <RequirementsList requirements={activity.requirements} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  )
}
