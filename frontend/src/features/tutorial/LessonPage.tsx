import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ListChecks,
  Lock,
  OctagonX,
  PartyPopper,
  Play,
  RotateCcw,
  X,
} from 'lucide-react'
import { saveExerciseCode, useLesson, useLessons, useMarkViewed } from '@/api/queries/tutorial'
import { ApiError, errorMessage } from '@/api/errors'
import type { LessonDetail, StudentCase } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import CodeEditor from '@/features/workspace/CodeEditor'
import { InputRequestPanel } from '@/features/workspace/InputRequestPanel'
import { promptOf } from '@/features/workspace/interactive'
import { PanelTabs, type PanelTab } from '@/features/workspace/PanelTabs'
import { RunStatusLine } from '@/features/workspace/RunStatusLine'
import { initialRunState, isBusy, type RunState } from '@/features/workspace/runStore'
import { Terminal } from '@/features/workspace/Terminal'
import { TestResultsPanel } from '@/features/workspace/TestResultsPanel'
import { TestStatusLine } from '@/features/workspace/TestStatusLine'
import type { TestState } from '@/features/workspace/testStore'
import { checkFiles, currentLesson, exerciseCases, neighbours } from '@/lib/tutorial'
import { CodeCard } from './CodeCard'
import { Markdown } from './Markdown'
import { useExerciseCheck, useTutorialRun, type RunOwner } from './useTutorialTools'
import { buttonClass } from '@/components/ui/buttonStyles'

const AUTOSAVE_MS = 1500

export function LessonPage() {
  const { slug = '' } = useParams()
  const lesson = useLesson(slug)
  const lessons = useLessons()

  if (lesson.isPending) return <PageSpinner label="Loading the lesson" />
  if (lesson.isError) {
    const err = lesson.error
    const locked = err instanceof ApiError && err.code === 'TUTORIAL_LOCKED'
    const current = currentLesson(lessons.data ?? [])
    return (
      <div className="flex-1 overflow-auto p-6">
        <EmptyState
          title={
            locked
              ? 'This lesson is locked'
              : err instanceof ApiError && err.status === 404
                ? 'Lesson not found'
                : 'The lesson could not be loaded'
          }
          action={
            current ? (
              <Link
                to={`/tutorial/${current.slug}`}
                className="font-medium text-brand-700 underline"
              >
                Go to {current.title}
              </Link>
            ) : undefined
          }
        >
          {locked ? (
            <span className="inline-flex items-center gap-1.5">
              <Lock aria-hidden className="size-4" />
              Pass the previous lesson first: lessons open one after another in your class.
            </span>
          ) : (
            errorMessage(err)
          )}
        </EmptyState>
      </div>
    )
  }
  // A fresh page per lesson: its editor, its terminal, its results.
  return <Lesson key={slug} lesson={lesson.data} />
}

function Lesson({ lesson }: { lesson: LessonDetail }) {
  const lessons = useLessons()
  const markViewed = useMarkViewed()
  const { prev, next } = neighbours(lessons.data ?? [], lesson.slug)
  const exercise = lesson.exercise
  const cases = exerciseCases(exercise)

  // ---- marking it seen, once
  const viewed = useRef(false)
  useEffect(() => {
    if (viewed.current || lesson.progress.viewed_at) return
    viewed.current = true
    markViewed.mutate(lesson.slug)
  }, [lesson, markViewed])

  // ---- the exercise code, autosaved
  const starter = exercise.starter_code
  const [code, setCode] = useState(lesson.progress.last_code ?? starter)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved')
  const savedCode = useRef(code)
  const codeRef = useRef(code)
  const saveNow = useCallback(async () => {
    const text = codeRef.current
    if (text === savedCode.current) return
    setSaveState('saving')
    try {
      await saveExerciseCode(lesson.slug, text)
      savedCode.current = text
      setSaveState(text === codeRef.current ? 'saved' : 'unsaved')
    } catch {
      setSaveState('error')
    }
  }, [lesson.slug])
  useEffect(() => {
    codeRef.current = code
    if (code === savedCode.current) return
    const id = window.setTimeout(() => void saveNow(), AUTOSAVE_MS)
    return () => window.clearTimeout(id)
  }, [code, saveNow])

  // ---- running and checking
  const run = useTutorialRun()
  const { state: test, check } = useExerciseCheck(
    lesson.slug,
    () => checkFiles(exercise, codeRef.current),
    saveNow,
  )
  const busy = isBusy(run.state.phase) || isBusy(test.phase)

  // ---- "Try it"
  const [tryOpen, setTryOpen] = useState(false)
  const [tryTitle, setTryTitle] = useState('')
  const [tryOriginal, setTryOriginal] = useState('')
  const [tryCode, setTryCode] = useState('')
  const [tryKey, setTryKey] = useState(0)
  const tryPane = useRef<HTMLDivElement>(null)
  const openTry = (source: string, title: string) => {
    setTryTitle(title)
    setTryOriginal(source)
    setTryCode(source)
    setTryKey((k) => k + 1)
    setTryOpen(true)
  }

  const passedNow =
    test.phase === 'finished' && test.totals !== null && test.totals.passed === test.totals.total
  const passed = Boolean(lesson.progress.passed_at) || passedNow

  // Ctrl+Enter runs (the "Try it" code when the cursor is in it), Ctrl+Shift+Enter checks. CodeMirror binds
  // Ctrl+Enter itself, so listen first (capture phase) and keep the editor from seeing it.
  const keys = useRef({ busy, tryOpen, tryCode, check, runCode: run.runCode })
  useEffect(() => {
    keys.current = { busy, tryOpen, tryCode, check, runCode: run.runCode }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      const k = keys.current
      if (k.busy) return
      if (e.shiftKey) return k.check()
      const inTry = k.tryOpen && tryPane.current?.contains(document.activeElement)
      if (inTry) k.runCode(k.tryCode, 'try')
      else k.runCode(codeRef.current, 'exercise')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <article aria-labelledby="lesson-title" className="relative min-w-0 flex-1 overflow-auto">
        <div className="mx-auto flex max-w-4xl flex-col px-10 py-8">
          <header className="mb-2">
            <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Lesson{' '}
              {(lessons.data?.findIndex((l) => l.slug === lesson.slug) ?? -1) + 1 || lesson.order}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 id="lesson-title" className="text-2xl font-semibold">
                {lesson.title}
              </h1>
              {passed && (
                <Badge tone="ok">
                  <CheckCircle2 aria-hidden className="mr-1 size-3" />
                  Passed
                </Badge>
              )}
            </div>
            {lesson.summary && <p className="mt-1 text-ink-muted">{lesson.summary}</p>}
          </header>

          <Markdown text={lesson.body_md} onTry={openTry} />

          {lesson.examples.length > 0 && (
            <section aria-labelledby="examples-heading" className="mt-6">
              <h2 id="examples-heading" className="mb-1 text-lg font-semibold text-ink-strong">
                Examples
              </h2>
              {lesson.examples.map((ex, i) => (
                <CodeCard
                  key={i}
                  title={ex.title}
                  code={ex.code.replace(/\n$/, '')}
                  onTry={() => openTry(ex.code, ex.title)}
                />
              ))}
            </section>
          )}

          <section aria-labelledby="exercise-heading" className="mt-8 card">
            <div className="border-b border-line px-4 py-3">
              <h2 id="exercise-heading" className="text-lg font-semibold text-ink-strong">
                Exercise
              </h2>
              <Markdown text={exercise.prompt} />
            </div>

            <div className="h-60 border-b border-line">
              <CodeEditor
                path={`${lesson.slug}/${exercise.entry}`}
                value={code}
                onChange={(v) => {
                  setCode(v)
                  setSaveState('unsaved')
                }}
                label="Exercise code"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 px-4 py-2">
              <Button
                variant="primary"
                loading={isBusy(run.state.phase) && run.owner === 'exercise'}
                disabled={busy}
                title="Run your code (Ctrl+Enter)"
                onClick={() => run.runCode(code, 'exercise')}
              >
                <Play aria-hidden className="size-4" />
                Run
              </Button>
              <StopButton run={run.state} owner={run.owner} me="exercise" onStop={run.stop} />
              <Button
                loading={isBusy(test.phase)}
                disabled={busy}
                title="Check your code against the exercise's tests (Ctrl+Shift+Enter)"
                onClick={check}
              >
                <ListChecks aria-hidden className="size-4" />
                Check
              </Button>
              <Button
                variant="ghost"
                disabled={code === starter}
                title="Put the starter code back"
                onClick={() => setCode(starter)}
              >
                <RotateCcw aria-hidden className="size-4" />
                Reset
              </Button>
              <span className="min-w-0 flex-1 text-sm" aria-live="polite">
                {isBusy(test.phase) || (test.notice && run.state.phase === 'idle') ? (
                  <TestStatusLine test={test} />
                ) : run.owner === 'exercise' ? (
                  <RunStatusLine run={run.state} />
                ) : null}
              </span>
              <span className="text-xs text-ink-muted">
                {saveState === 'saving'
                  ? 'Saving…'
                  : saveState === 'error'
                    ? 'Not saved'
                    : saveState === 'unsaved'
                      ? 'Unsaved'
                      : 'Saved'}
              </span>
            </div>

            <ExerciseOutput
              run={run.owner === 'exercise' ? run.state : initialRunState}
              test={test}
              cases={cases}
              onClear={run.clear}
              onSendInput={run.sendInput}
              onEndInput={run.endInput}
              onStop={run.stop}
            />
          </section>

          {passed && (
            <div
              role="status"
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ok/50 bg-ok-soft px-4 py-3"
            >
              <p className="flex items-center gap-2 font-semibold text-ok">
                <PartyPopper aria-hidden className="size-5" />
                {passedNow ? 'Every test passed. Well done!' : 'You passed this lesson.'}
              </p>
              {next && (
                <Link to={`/tutorial/${next.slug}`} className={buttonClass('primary', 'md')}>
                  Next lesson
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              )}
            </div>
          )}

          <nav aria-label="Lessons" className="mt-6 mb-4 flex items-center justify-between gap-3">
            {prev ? (
              <Link to={`/tutorial/${prev.slug}`} className={buttonClass('secondary', 'md')}>
                <ArrowLeft aria-hidden className="size-4" />
                {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next &&
              (next.locked ? (
                <span
                  title="Pass this lesson to open the next one"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm text-ink-muted"
                >
                  <Lock aria-hidden className="size-4" />
                  {next.title}
                </span>
              ) : (
                <Link to={`/tutorial/${next.slug}`} className={buttonClass('secondary', 'md')}>
                  {next.title}
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              ))}
          </nav>
        </div>
      </article>

      {tryOpen && (
        <div
          ref={tryPane}
          role="region"
          aria-label="Try it"
          className="flex w-[46%] min-w-96 shrink-0 flex-col border-l border-line bg-surface"
        >
          <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Try it · {tryTitle}</h2>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Close Try it"
              title="Close"
              onClick={() => setTryOpen(false)}
            >
              <X aria-hidden className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <CodeEditor
              key={tryKey}
              path={`try-${tryKey}.py`}
              value={tryCode}
              onChange={setTryCode}
              label="Try it code"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
            <Button
              variant="primary"
              loading={isBusy(run.state.phase) && run.owner === 'try'}
              disabled={busy}
              title="Run this code (Ctrl+Enter)"
              onClick={() => run.runCode(tryCode, 'try')}
            >
              <Play aria-hidden className="size-4" />
              Run
            </Button>
            <StopButton run={run.state} owner={run.owner} me="try" onStop={run.stop} />
            <Button
              variant="ghost"
              disabled={tryCode === tryOriginal}
              title="Put the example back as it was"
              onClick={() => {
                setTryCode(tryOriginal)
                setTryKey((k) => k + 1)
              }}
            >
              <RotateCcw aria-hidden className="size-4" />
              Reset
            </Button>
            <span className="min-w-0 flex-1 text-sm" aria-live="polite">
              {run.owner === 'try' && <RunStatusLine run={run.state} />}
            </span>
          </div>
          <div className="flex h-[42%] min-h-40 flex-col">
            <RunOutput
              run={run.owner === 'try' ? run.state : initialRunState}
              onClear={run.clear}
              onSendInput={run.sendInput}
              onEndInput={run.endInput}
              onStop={run.stop}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function StopButton({
  run,
  owner,
  me,
  onStop,
}: {
  run: RunState
  owner: RunOwner
  me: RunOwner
  onStop: () => void
}) {
  const canStop =
    owner === me && !run.stopping && (run.phase === 'queued' || run.phase === 'running')
  if (!canStop) return null
  return (
    <Button variant="danger" onClick={onStop} title="End the program now">
      <OctagonX aria-hidden className="size-4" />
      Stop
    </Button>
  )
}

interface RunOutputProps {
  run: RunState
  onClear: () => void
  onSendInput: (value: string) => void
  onEndInput: () => void
  onStop: () => void
  tabs?: ReactNode
}

/** The terminal, with the box that asks for input while the program waits at an input(). */
function RunOutput({ run, onClear, onSendInput, onEndInput, onStop, tabs }: RunOutputProps) {
  const asking = run.phase === 'running' && run.waitingForInput && !run.stopping
  return (
    <Terminal
      text={run.output}
      echoes={run.echoes}
      onClear={onClear}
      tabs={tabs}
      placeholder={
        run.phase === 'finished'
          ? 'The program printed nothing.'
          : 'Press Run: what the program prints appears here.'
      }
      reserveBottom={asking}
      overlay={
        asking ? (
          <InputRequestPanel
            key={run.inputRequestedAt}
            prompt={promptOf(run.output)}
            error={run.inputError}
            onSend={onSendInput}
            onEndInput={onEndInput}
            onStop={onStop}
          />
        ) : undefined
      }
    />
  )
}

/** Under the exercise: the terminal and the test results, as tabs that follow what was pressed last. */
function ExerciseOutput({
  run,
  test,
  cases,
  ...handlers
}: Omit<RunOutputProps, 'tabs'> & { test: TestState; cases: StudentCase[] }) {
  const [tab, setTab] = useState<PanelTab>('terminal')
  const [seen, setSeen] = useState({ run: run.phase, test: test.phase })
  if (seen.run !== run.phase || seen.test !== test.phase) {
    setSeen({ run: run.phase, test: test.phase })
    if (test.phase === 'saving' && seen.test !== 'saving') setTab('tests')
    else if (run.phase === 'saving' && seen.run !== 'saving') setTab('terminal')
  }
  const totals = test.phase === 'finished' ? test.totals : null
  const tabs = (
    <PanelTabs
      active={tab}
      onChange={setTab}
      testsBadge={totals ? `${totals.passed}/${totals.total}` : undefined}
    />
  )
  return (
    <div className="flex h-64 flex-col overflow-hidden rounded-b-xl">
      {tab === 'tests' ? (
        <TestResultsPanel
          state={test}
          cases={cases}
          tabs={tabs}
          idleText={`Press Check to test your code. This exercise has ${cases.length} ${cases.length === 1 ? 'test' : 'tests'}${
            cases.some((c) => !('stdin' in c))
              ? `, ${cases.filter((c) => !('stdin' in c)).length} of them hidden`
              : ''
          }.`}
        />
      ) : (
        <RunOutput run={run} tabs={tabs} {...handlers} />
      )}
    </div>
  )
}
