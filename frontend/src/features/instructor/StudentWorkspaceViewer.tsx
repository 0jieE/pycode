import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useAllEnrollments } from '@/api/queries/enrollments'
import {
  STUDENT_VIEW_REFRESH_MS,
  useStudentFile,
  useStudentTree,
} from '@/api/queries/studentWorkspace'
import { ApiError, errorMessage } from '@/api/errors'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import CodeEditor from '@/features/workspace/CodeEditor'
import { FileTree } from '@/features/workspace/FileTree'
import { QuotaBar } from '@/features/workspace/QuotaBar'
import { useIdParam } from '@/lib/params'
import { timeAgo } from '@/lib/time'
import { useNow } from '@/lib/useNow'

/** An instructor looking at a student's files: nothing here can be changed. */
export default function StudentWorkspaceViewer() {
  const classId = useIdParam('classId')
  const studentId = useIdParam('studentId')
  if (classId === null || studentId === null) {
    return (
      <EmptyState
        title="Workspace not found"
        action={
          <Link to="/classes" className="font-medium text-brand-700 underline">
            Back to classes
          </Link>
        }
      />
    )
  }
  return <Viewer classId={classId} studentId={studentId} />
}

function Viewer({ classId, studentId }: { classId: number; studentId: number }) {
  const tree = useStudentTree(classId, studentId)
  const students = useAllEnrollments(classId, 'approved')
  const now = useNow(1000)

  const student = students.data?.find((e) => e.student.id === studentId)?.student
  const entries = useMemo(() => tree.data?.entries ?? [], [tree.data])

  // The path (not the id) is remembered, so the view keeps its place when the student renames things.
  const [chosen, setChosen] = useState<string | null>(null)
  const firstPython = entries.find((e) => !e.is_folder && e.path.endsWith('.py'))
  const selectedPath =
    chosen && entries.some((e) => e.path === chosen && !e.is_folder)
      ? chosen
      : (firstPython ?? entries.find((e) => !e.is_folder))?.path
  const selected = entries.find((e) => e.path === selectedPath && !e.is_folder)
  const file = useStudentFile(classId, studentId, selected?.id ?? null)

  if (tree.isPending) return <PageSpinner label="Opening the workspace" />
  if (tree.isError) {
    const none = tree.error instanceof ApiError && tree.error.code === 'WORKSPACE_NOT_FOUND'
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <EmptyState
          title={none ? 'No workspace yet' : 'The workspace could not be loaded'}
          action={none ? undefined : <Button onClick={() => void tree.refetch()}>Try again</Button>}
        >
          {none
            ? 'This student has no workspace in the class yet. It is created when they are approved.'
            : errorMessage(tree.error)}
        </EmptyState>
      </div>
    )
  }

  const updatedAgo = tree.dataUpdatedAt
    ? timeAgo(new Date(tree.dataUpdatedAt).toISOString(), now)
    : ''

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{student?.full_name ?? 'Student workspace'}</h1>
          <p className="text-sm text-ink-muted">
            {student && <span className="font-mono">{student.username}</span>}
            {student && ' · '}
            Updates every {STUDENT_VIEW_REFRESH_MS / 1000} seconds
            {updatedAgo && ` · checked ${updatedAgo}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="pending">Read-only</Badge>
          <Button
            size="sm"
            loading={tree.isFetching}
            onClick={() => {
              void tree.refetch()
              void file.refetch()
            }}
          >
            {!tree.isFetching && <RefreshCw aria-hidden className="size-3.5" />}
            Refresh now
          </Button>
        </div>
      </header>

      <div className="grid min-h-96 flex-1 grid-cols-[16rem_1fr] overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex min-h-0 flex-col border-r border-line">
          <div className="min-h-0 flex-1 overflow-auto p-1.5">
            <FileTree
              label="Student files"
              entries={entries}
              selectedPath={selectedPath ?? null}
              onSelect={(path, isFolder) => {
                if (!isFolder) setChosen(path)
              }}
              emptyText="This student has no files yet."
            />
          </div>
          {tree.data && <QuotaBar usage={tree.data.usage} />}
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          {selected ? (
            <>
              <p className="border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-xs">
                {selected.path}
              </p>
              <div className="min-h-0 flex-1">
                {file.data ? (
                  <CodeEditor
                    path={selected.path}
                    value={file.data.content ?? ''}
                    readOnly
                    label={`Contents of ${selected.path} (read-only)`}
                  />
                ) : file.isError ? (
                  <p role="alert" className="p-4 text-sm text-error">
                    {errorMessage(file.error)}
                  </p>
                ) : (
                  <PageSpinner label="Opening file" />
                )}
              </div>
            </>
          ) : (
            <p className="p-4 text-sm text-ink-muted">Pick a file to read it.</p>
          )}
        </div>
      </div>
    </div>
  )
}
