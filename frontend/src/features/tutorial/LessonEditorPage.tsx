import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import {
  useDeleteLesson,
  useManageLessons,
  useResetLesson,
  useUpdateLesson,
} from '@/api/queries/tutorial'
import { errorMessage } from '@/api/errors'
import type { LessonExample, LessonFull, TutorialTestSpec } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Switch } from '@/components/ui/Switch'
import { Tabs } from '@/components/ui/Tabs'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import { TestCaseFields } from '@/features/instructor/TestCaseFields'
import { validateCaseForm, type CaseFormErrors, type CaseFormState } from '@/lib/testCaseForm'
import CodeEditor from '@/features/workspace/CodeEditor'
import { matchModeLabel } from '@/features/workspace/testResults'
import { moveItem } from '@/lib/tutorial'
import { Markdown } from './Markdown'

const MAX_EXAMPLES = 10
const MAX_TESTS = 20

export function LessonEditorPage() {
  const { slug = '' } = useParams()
  const lessons = useManageLessons()
  const lesson = lessons.data?.find((l) => l.slug === slug)

  if (lessons.isPending) return <PageSpinner label="Loading the lesson" />
  if (!lesson) {
    return (
      <EmptyState
        title={lessons.isError ? 'The lessons could not be loaded' : 'Lesson not found'}
        action={
          <Link to="/tutorial" className="font-medium text-brand-700 underline">
            All lessons
          </Link>
        }
      >
        {lessons.isError ? errorMessage(lessons.error) : 'This lesson does not exist any more.'}
      </EmptyState>
    )
  }
  return <Editor key={lesson.slug} lesson={lesson} />
}

interface Draft {
  title: string
  summary: string
  body: string
  examples: LessonExample[]
  prompt: string
  starter: string
  solution: string
  entry: string
  ignorePrompts: boolean
  tests: CaseFormState[]
}

const toCase = (t: TutorialTestSpec): CaseFormState => ({
  name: t.name,
  stdin: t.stdin ?? '',
  expected: t.expected_output ?? '',
  hidden: t.is_hidden ?? false,
  points: String(t.points ?? 1),
  mode: t.match_mode ?? 'trim',
})

const draftOf = (l: LessonFull): Draft => ({
  title: l.title,
  summary: l.summary,
  body: l.body_md,
  examples: l.examples.map((e) => ({ title: e.title, code: e.code })),
  prompt: l.exercise.prompt,
  starter: l.exercise.starter_code ?? '',
  solution: l.exercise.reference_solution,
  entry: l.exercise.entry ?? 'main.py',
  ignorePrompts: l.exercise.ignore_input_prompts ?? true,
  tests: l.exercise.tests.map(toCase),
})

type Tab = 'text' | 'examples' | 'exercise' | 'tests'

function Editor({ lesson }: { lesson: LessonFull }) {
  const update = useUpdateLesson(lesson.slug)
  const reset = useResetLesson(lesson.slug)
  const remove = useDeleteLesson()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const baseline = useMemo(() => draftOf(lesson), [lesson])
  const [draft, setDraft] = useState<Draft>(baseline)
  const [tab, setTab] = useState<Tab>('text')
  const [error, setError] = useState<string | null>(null)
  const [caseErrors, setCaseErrors] = useState<Record<number, CaseFormErrors>>({})
  const [selectedTest, setSelectedTest] = useState(0)
  const [confirmReset, setConfirmReset] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  function save() {
    setError(null)
    const problems: string[] = []
    if (!draft.title.trim()) problems.push('the title is empty')
    if (!draft.body.trim()) problems.push('the lesson text is empty')
    if (draft.examples.some((e) => !e.title.trim())) problems.push('an example has no title')
    if (!draft.prompt.trim()) problems.push("the exercise's task is empty")
    if (!draft.solution.trim()) problems.push('the reference solution is empty')
    if (!/^[\w.-]+\.py$/.test(draft.entry.trim()))
      problems.push('the file to run must be a .py name')
    const found: Record<number, CaseFormErrors> = {}
    draft.tests.forEach((t, i) => {
      const e = validateCaseForm(t)
      if (Object.keys(e).length) found[i] = e
    })
    setCaseErrors(found)
    if (Object.keys(found).length) {
      problems.push('a test has a problem')
      setSelectedTest(Number(Object.keys(found)[0]))
    }
    if (problems.length) return setError(`Not saved: ${problems.join(', ')}.`)

    update.mutate(
      {
        title: draft.title.trim(),
        summary: draft.summary.trim(),
        body_md: draft.body,
        examples: draft.examples.map((e) => ({ title: e.title.trim(), code: e.code })),
        exercise: {
          prompt: draft.prompt,
          starter_code: draft.starter,
          starter_files: lesson.exercise.starter_files ?? [],
          entry: draft.entry.trim(),
          ignore_input_prompts: draft.ignorePrompts,
          reference_solution: draft.solution,
          tests: draft.tests.map((t) => ({
            name: t.name.trim(),
            stdin: t.stdin,
            expected_output: t.expected,
            is_hidden: t.hidden,
            match_mode: t.mode,
            points: Number(t.points),
          })),
        },
      },
      {
        onSuccess: () => toast.success('Lesson saved'),
        onError: (err) => setError(errorMessage(err)),
      },
    )
  }

  const toggleHidden = () =>
    update.mutate(
      { is_hidden: !lesson.is_hidden },
      {
        onSuccess: (l) =>
          toast.success(l.is_hidden ? 'Hidden from students' : 'Students can see this lesson'),
        onError: (err) => toast.error(errorMessage(err)),
      },
    )

  return (
    <div className="page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{lesson.title}</h1>
            {lesson.is_hidden ? (
              <Badge tone="pending">Hidden</Badge>
            ) : (
              <Badge tone="ok">Visible</Badge>
            )}
            {dirty && <Badge tone="warn">Unsaved changes</Badge>}
          </div>
          <p className="font-mono text-xs text-ink-muted">/tutorial/{lesson.slug}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={toggleHidden} disabled={update.isPending}>
            {lesson.is_hidden ? (
              <Eye aria-hidden className="size-4" />
            ) : (
              <EyeOff aria-hidden className="size-4" />
            )}
            {lesson.is_hidden ? 'Show to students' : 'Hide from students'}
          </Button>
          {/* A lesson that came with the system can be hidden or reset, never deleted. */}
          {lesson.has_default ? (
            <Button onClick={() => setConfirmReset(true)}>
              <RotateCcw aria-hidden className="size-4" />
              Reset to default
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden className="size-4" />
              Delete lesson
            </Button>
          )}
          <Button variant="primary" loading={update.isPending} disabled={!dirty} onClick={save}>
            <Save aria-hidden className="size-4" />
            Save
          </Button>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      <Tabs
        label="Lesson parts"
        active={tab}
        onChange={(id) => setTab(id as Tab)}
        tabs={[
          { id: 'text', label: 'Text' },
          { id: 'examples', label: `Examples (${draft.examples.length})` },
          { id: 'exercise', label: 'Exercise' },
          { id: 'tests', label: `Tests (${draft.tests.length})` },
        ]}
      />

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-1">
        {tab === 'text' && (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
              <TextField
                label="Title"
                value={draft.title}
                maxLength={150}
                onChange={(e) => set('title', e.target.value)}
              />
              <TextField
                label="Summary (shown under the title)"
                value={draft.summary}
                maxLength={300}
                onChange={(e) => set('summary', e.target.value)}
              />
            </div>
            <MarkdownEditor
              label="Lesson text (Markdown)"
              path={`${lesson.slug}/body.md`}
              value={draft.body}
              onChange={(v) => set('body', v)}
              height="h-[calc(100dvh-20rem)] min-h-72"
            />
          </div>
        )}

        {tab === 'examples' && (
          <ExamplesEditor
            slug={lesson.slug}
            examples={draft.examples}
            onChange={(examples) => set('examples', examples)}
          />
        )}

        {tab === 'exercise' && (
          <div className="flex flex-col gap-4">
            <MarkdownEditor
              label="The task (Markdown)"
              path={`${lesson.slug}/prompt.md`}
              value={draft.prompt}
              onChange={(v) => set('prompt', v)}
              height="h-48"
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <CodeField
                label="Starter code (what the student's editor starts with)"
                path={`${lesson.slug}/starter.py`}
                value={draft.starter}
                onChange={(v) => set('starter', v)}
              />
              <CodeField
                label="Reference solution (never shown to students)"
                path={`${lesson.slug}/solution.py`}
                value={draft.solution}
                onChange={(v) => set('solution', v)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
              <TextField
                label="File to run"
                value={draft.entry}
                onChange={(e) => set('entry', e.target.value)}
                spellCheck={false}
                className="font-mono"
              />
              <div className="flex items-start justify-between gap-4 rounded-md border border-line bg-surface px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Ignore input prompts</p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {draft.ignorePrompts
                      ? 'The text inside input("...") is left out when outputs are compared.'
                      : 'Input prompts count as output: they must match too.'}
                  </p>
                </div>
                <Switch
                  checked={draft.ignorePrompts}
                  label="Ignore input prompts"
                  onChange={(on) => set('ignorePrompts', on)}
                />
              </div>
            </div>
          </div>
        )}

        {tab === 'tests' && (
          <TestsEditor
            tests={draft.tests}
            errors={caseErrors}
            selected={Math.min(selectedTest, draft.tests.length - 1)}
            onSelect={setSelectedTest}
            onChange={(tests) => set('tests', tests)}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset this lesson to its default?"
        confirmLabel="Reset to default"
        destructive
        loading={reset.isPending}
        onConfirm={() =>
          reset.mutate(undefined, {
            onSuccess: (l) => {
              setDraft(draftOf(l))
              setCaseErrors({})
              setConfirmReset(false)
              toast.success('The lesson is back to its default')
            },
            onError: (err) => {
              setConfirmReset(false)
              toast.error(errorMessage(err))
            },
          })
        }
        onCancel={() => setConfirmReset(false)}
      >
        The text, examples, exercise and tests go back to the version that came with the system.
        Your changes to this lesson are lost. Students&apos; progress is kept.
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this lesson?"
        confirmLabel="Delete lesson"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(lesson.slug, {
            onSuccess: () => {
              toast.success(`"${lesson.title}" was deleted`)
              navigate('/tutorial', { replace: true })
            },
            onError: (err) => {
              setConfirmDelete(false)
              toast.error(errorMessage(err))
            },
          })
        }
        onCancel={() => setConfirmDelete(false)}
      >
        <strong className="text-ink">{lesson.title}</strong> is removed from the tutorial, with
        every student&apos;s progress on it. This cannot be undone. If lessons open in order, the
        lesson after it now follows the one before it.{' '}
        {!lesson.is_hidden && 'To keep it but take it away from students, use Hide instead.'}
      </ConfirmDialog>
    </div>
  )
}

function MarkdownEditor({
  label,
  path,
  value,
  onChange,
  height,
}: {
  label: string
  path: string
  value: string
  onChange: (value: string) => void
  height: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className={`grid grid-cols-2 gap-3 ${height}`}>
        <div className="min-h-0 overflow-hidden rounded-md border border-line">
          <CodeEditor path={path} value={value} onChange={onChange} label={label} />
        </div>
        <section
          aria-label="Preview"
          className="min-h-0 overflow-auto rounded-md border border-line bg-surface px-4 py-2"
        >
          <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Preview</p>
          <Markdown text={value} />
        </section>
      </div>
    </div>
  )
}

function CodeField({
  label,
  path,
  value,
  onChange,
  height = 'h-44',
}: {
  label: string
  path: string
  value: string
  onChange: (value: string) => void
  height?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className={`${height} overflow-hidden rounded-md border border-line`}>
        <CodeEditor path={path} value={value} onChange={onChange} label={label} />
      </div>
    </div>
  )
}

function ExamplesEditor({
  slug,
  examples,
  onChange,
}: {
  slug: string
  examples: LessonExample[]
  onChange: (examples: LessonExample[]) => void
}) {
  const edit = (i: number, patch: Partial<LessonExample>) =>
    onChange(examples.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        Each example is a code card under the lesson text, with a Try it button that opens it in an
        editor students can run. Up to {MAX_EXAMPLES}.
      </p>
      {examples.map((ex, i) => (
        <section key={i} aria-label={`Example ${i + 1}`} className="flex flex-col gap-2 card p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label={`Example ${i + 1}: title`}
                value={ex.title}
                maxLength={150}
                onChange={(e) => edit(i, { title: e.target.value })}
              />
            </div>
            <Button
              variant="ghost"
              aria-label={`Move example ${i + 1} up`}
              disabled={i === 0}
              onClick={() => onChange(moveItem(examples, i, i - 1))}
            >
              <ArrowUp aria-hidden className="size-4" />
            </Button>
            <Button
              variant="ghost"
              aria-label={`Move example ${i + 1} down`}
              disabled={i === examples.length - 1}
              onClick={() => onChange(moveItem(examples, i, i + 1))}
            >
              <ArrowDown aria-hidden className="size-4" />
            </Button>
            <Button
              variant="ghost"
              aria-label={`Remove example ${i + 1}`}
              onClick={() => onChange(examples.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </div>
          <div className="h-36 overflow-hidden rounded-md border border-line">
            <CodeEditor
              path={`${slug}/example-${i}.py`}
              value={ex.code}
              onChange={(code) => edit(i, { code })}
              label={`Example ${i + 1}: code`}
            />
          </div>
        </section>
      ))}
      <div>
        <Button
          disabled={examples.length >= MAX_EXAMPLES}
          onClick={() =>
            onChange([...examples, { title: `Example ${examples.length + 1}`, code: '' }])
          }
        >
          <Plus aria-hidden className="size-4" />
          Add example
        </Button>
      </div>
    </div>
  )
}

function TestsEditor({
  tests,
  errors,
  selected,
  onSelect,
  onChange,
}: {
  tests: CaseFormState[]
  errors: Record<number, CaseFormErrors>
  selected: number
  onSelect: (i: number) => void
  onChange: (tests: CaseFormState[]) => void
}) {
  const current = tests[selected]
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="flex flex-col gap-2">
        <ul aria-label="Tests, in the order they run" className="flex flex-col gap-1.5">
          {tests.map((t, i) => (
            <li
              key={i}
              className={`group flex items-stretch rounded-md border ${
                i === selected ? 'border-focus bg-brand-100' : 'border-line bg-surface'
              } ${errors[i] ? 'border-error' : ''}`}
            >
              <button
                type="button"
                aria-current={i === selected ? 'true' : undefined}
                onClick={() => onSelect(i)}
                className="min-w-0 flex-1 px-3 py-2 text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{t.name || `Test ${i + 1}`}</span>
                  <Badge tone={t.hidden ? 'pending' : 'open'}>
                    {t.hidden ? 'Hidden' : 'Sample'}
                  </Badge>
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {t.points} {t.points === '1' ? 'pt' : 'pts'} · {matchModeLabel(t.mode)}
                </span>
              </button>
              <span className="flex flex-col justify-center pr-1">
                <button
                  type="button"
                  aria-label={`Move ${t.name} up`}
                  disabled={i === 0}
                  onClick={() => {
                    onChange(moveItem(tests, i, i - 1))
                    onSelect(i - 1)
                  }}
                  className="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp aria-hidden className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${t.name} down`}
                  disabled={i === tests.length - 1}
                  onClick={() => {
                    onChange(moveItem(tests, i, i + 1))
                    onSelect(i + 1)
                  }}
                  className="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown aria-hidden className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div>
          <Button
            disabled={tests.length >= MAX_TESTS}
            onClick={() => {
              onChange([
                ...tests,
                {
                  name: `Test ${tests.length + 1}`,
                  stdin: '',
                  expected: '',
                  hidden: false,
                  points: '1',
                  mode: 'trim',
                },
              ])
              onSelect(tests.length)
            }}
          >
            <Plus aria-hidden className="size-4" />
            Add test
          </Button>
        </div>
        <p className="text-xs text-ink-muted">
          A lesson is passed when every test passes. Sample tests show students their input and
          expected output; hidden ones only Pass or Fail.
        </p>
      </div>

      {current && (
        <section aria-label={`Test: ${current.name}`} className="flex flex-col gap-4 card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold">Edit test</h3>
            <Button
              variant="ghost"
              disabled={tests.length <= 1}
              title={tests.length <= 1 ? 'An exercise needs at least one test' : undefined}
              onClick={() => {
                onChange(tests.filter((_, j) => j !== selected))
                onSelect(Math.max(0, selected - 1))
              }}
            >
              <Trash2 aria-hidden className="size-4" />
              Delete
            </Button>
          </div>
          <TestCaseFields
            form={current}
            errors={errors[selected] ?? {}}
            onChange={(key, value) =>
              onChange(tests.map((t, j) => (j === selected ? { ...t, [key]: value } : t)))
            }
          />
        </section>
      )}
    </div>
  )
}
