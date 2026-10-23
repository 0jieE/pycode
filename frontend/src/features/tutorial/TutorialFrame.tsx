import { useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { BookMarked, DownloadCloud } from 'lucide-react'
import { useLessons, useManageLessons, useSeedLessons } from '@/api/queries/tutorial'
import { errorMessage } from '@/api/errors'
import { useAuth } from '@/auth/AuthContext'
import { RoleStatusBar } from '@/components/RoleStatusBar'
import { Shell } from '@/components/Shell'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PageSpinner } from '@/components/ui/Spinner'
import { toast } from '@/components/ui/toastStore'
import { currentLesson } from '@/lib/tutorial'
import { LessonEditorPage } from './LessonEditorPage'
import { LessonListPanel } from './LessonListPanel'
import { LessonPage } from './LessonPage'
import { ManageLessonPanel } from './ManageLessonPanel'

const useIsStudent = () => useAuth().user?.role === 'student'

/**
 * The Python Tutorial, as every other page: the lessons as a second side bar, the chosen one beside it.
 * Students learn (the lesson page lays out its own scrolling and the "Try it" pane); administrators and
 * instructors edit the lessons.
 */
export function TutorialFrame() {
  const student = useIsStudent()
  return (
    <Shell>
      <div className="flex min-h-0 flex-1">
        {student ? <LessonListPanel /> : <ManageLessonPanel />}
        <main
          id="main"
          className={`relative flex min-w-0 flex-1 flex-col bg-canvas ${
            student ? 'overflow-hidden' : 'overflow-auto p-6'
          }`}
        >
          <Outlet />
        </main>
      </div>
      <RoleStatusBar />
    </Shell>
  )
}

export function TutorialIndex() {
  return useIsStudent() ? <ContinueLesson /> : <ChooseLesson />
}

export function TutorialLesson() {
  return useIsStudent() ? <LessonPage /> : <LessonEditorPage />
}

/** A student opening the tutorial goes straight to where they left off. */
function ContinueLesson() {
  const lessons = useLessons()
  if (lessons.isPending) return <PageSpinner label="Loading the lessons" />
  const current = currentLesson(lessons.data ?? [])
  if (current) return <Navigate to={`/tutorial/${current.slug}`} replace />
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 pt-20 text-center">
      <BookMarked aria-hidden className="size-14 text-ink-muted/60" />
      <h1 className="text-2xl font-semibold">Python Tutorial</h1>
      <p className="text-ink-muted">
        {lessons.isError ? errorMessage(lessons.error) : 'There are no lessons yet.'}
      </p>
    </div>
  )
}

/** Staff, until a lesson is chosen in the list on the left. */
function ChooseLesson() {
  const lessons = useManageLessons()
  const seed = useSeedLessons()
  const isAdmin = useAuth().user?.role === 'admin'
  const [confirmSeed, setConfirmSeed] = useState(false)
  const none = lessons.data?.length === 0
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 pt-20 text-center">
      <BookMarked aria-hidden className="size-14 text-ink-muted/60" />
      <h1 className="text-2xl font-semibold">Python Tutorial</h1>
      <p className="text-ink-muted">
        {lessons.isPending
          ? 'Loading the lessons…'
          : none
            ? 'There are no lessons yet.'
            : 'Select a lesson on the left to edit its text, examples, exercise and tests. Drag lessons to reorder them.'}
      </p>
      {isAdmin && (
        <div className="mt-2 flex flex-col items-center gap-1.5">
          <Button onClick={() => setConfirmSeed(true)}>
            <DownloadCloud aria-hidden className="size-4" />
            Load default lessons
          </Button>
          <p className="max-w-sm text-xs text-ink-muted">
            Adds the lessons that came with the system, and puts every one of them back to its
            default version.
          </p>
          <ConfirmDialog
            open={confirmSeed}
            title="Load the default lessons?"
            confirmLabel="Load default lessons"
            destructive={!none}
            loading={seed.isPending}
            onConfirm={() =>
              seed.mutate(undefined, {
                onSuccess: (r) => {
                  setConfirmSeed(false)
                  toast.success(
                    `Default lessons loaded: ${r.created.length} new, ${r.updated.length} reset`,
                  )
                },
                onError: (err) => {
                  setConfirmSeed(false)
                  toast.error(errorMessage(err))
                },
              })
            }
            onCancel={() => setConfirmSeed(false)}
          >
            Missing default lessons are added.{' '}
            <strong className="text-ink">
              Default lessons that were edited here go back to their original text, examples and
              tests
            </strong>
            : the edits are lost. Lessons you added yourself and students&apos; progress are kept.
          </ConfirmDialog>
        </div>
      )}
    </div>
  )
}
