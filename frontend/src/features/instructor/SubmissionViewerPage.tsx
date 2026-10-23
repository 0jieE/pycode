import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSubmission } from '@/api/queries/submissions'
import { ApiError, errorMessage } from '@/api/errors'
import type { SubmissionDetail } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import CodeEditor from '@/features/workspace/CodeEditor'
import { FileTree } from '@/features/workspace/FileTree'
import { useIdParam } from '@/lib/params'
import { formatScore } from '@/features/workspace/testResults'
import { formatDateTime } from '@/lib/time'
import { HardcodeNotice } from './HardcodeFlag'

/** The frozen snapshot of one student's submission: read-only tree and editor. */
export function SubmissionViewerPage() {
  const classId = useIdParam('classId')
  const activityId = useIdParam('activityId')
  const submissionId = useIdParam('submissionId')
  const back =
    classId !== null && activityId !== null
      ? `/classes/${classId}/activities/${activityId}/submissions`
      : '/classes'

  if (submissionId === null) return <NotFound back={back} />
  return <Viewer submissionId={submissionId} back={back} />
}

function NotFound({ back }: { back: string }) {
  return (
    <EmptyState
      title="Submission not found"
      action={
        <Link to={back} className="font-medium text-brand-700 underline">
          Back to submissions
        </Link>
      }
    >
      This submission does not exist, or it belongs to another instructor.
    </EmptyState>
  )
}

function Viewer({ submissionId, back }: { submissionId: number; back: string }) {
  const submission = useSubmission(submissionId)

  if (submission.isPending) return <PageSpinner label="Loading submission" />
  if (submission.isError) {
    const gone =
      submission.error instanceof ApiError && [403, 404].includes(submission.error.status)
    return gone ? (
      <NotFound back={back} />
    ) : (
      <EmptyState
        title="The submission could not be loaded"
        action={<Button onClick={() => void submission.refetch()}>Try again</Button>}
      >
        {errorMessage(submission.error)}
      </EmptyState>
    )
  }
  return <SnapshotView submission={submission.data} />
}

function SnapshotView({ submission: s }: { submission: SubmissionDetail }) {
  const entries = useMemo(() => s.files.map((f) => ({ path: f.path, is_folder: false })), [s.files])
  // Open on the first Python file, or the first file of any kind.
  const [selected, setSelected] = useState<string | null>(
    () => (s.files.find((f) => f.path.endsWith('.py')) ?? s.files[0])?.path ?? null,
  )
  const file = s.files.find((f) => f.path === selected) ?? null

  return (
    <div className="page h-full">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{s.student.full_name}</h1>
          <p className="text-ink-muted">
            <span className="font-mono">{s.student.username}</span> · submitted{' '}
            {formatDateTime(s.submitted_at)} · {s.file_count}{' '}
            {s.file_count === 1 ? 'file' : 'files'}
            {s.tests_passed != null && s.tests_total != null && (
              <>
                {' · '}
                {s.tests_passed} of {s.tests_total} {s.tests_total === 1 ? 'test' : 'tests'} passed
              </>
            )}
          </p>
          {s.graded_at && (
            <p className="text-sm text-ink-muted">Graded {formatDateTime(s.graded_at)}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {s.score != null && s.max_score != null ? (
            <Badge tone={s.score === s.max_score ? 'ok' : s.score === 0 ? 'error' : 'warn'}>
              Score {formatScore(s.score, s.max_score)}
            </Badge>
          ) : (
            <Badge tone="pending">Not graded yet</Badge>
          )}
          {s.status === 'late' && <Badge tone="warn">Late</Badge>}
          <Badge tone="pending">Read-only snapshot</Badge>
        </div>
      </header>

      <HardcodeNotice suspected={s.hardcode_suspected} tests={s.hardcode_tests} />

      <div className="grid h-[32rem] min-h-80 grid-cols-[16rem_1fr] overflow-hidden rounded-lg border border-line bg-surface">
        <div className="min-h-0 overflow-auto border-r border-line p-1.5">
          <FileTree
            label="Submitted files"
            entries={entries}
            selectedPath={selected}
            onSelect={setSelected}
            emptyText="This submission has no files."
          />
        </div>
        <div className="flex min-h-0 min-w-0 flex-col">
          {file ? (
            <>
              <p className="border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-xs">
                {file.path}
              </p>
              <div className="min-h-0 flex-1">
                <CodeEditor
                  path={file.path}
                  value={file.content}
                  readOnly
                  label={`Submitted contents of ${file.path}`}
                />
              </div>
            </>
          ) : (
            <p className="p-4 text-sm text-ink-muted">Select a file to see what was submitted.</p>
          )}
        </div>
      </div>
    </div>
  )
}
