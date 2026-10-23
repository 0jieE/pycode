import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, ListChecks, Play, Plus, Trash2 } from 'lucide-react'
import { useUpdateActivity } from '@/api/queries/activities'
import {
  tryTestCase,
  useCreateTestCase,
  useDeleteTestCase,
  useReorderTestCases,
  useTestCases,
  useUpdateTestCase,
} from '@/api/queries/testCases'
import { ApiError, errorMessage } from '@/api/errors'
import type { Activity, MatchMode, TestCase } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Spinner'
import { Switch } from '@/components/ui/Switch'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import { DiffView } from '@/features/workspace/DiffView'
import { RequirementsSection } from './RequirementsSection'
import { TestCaseFields } from './TestCaseFields'
import { validateCaseForm, type CaseFormErrors, type CaseFormState } from '@/lib/testCaseForm'
import {
  matchModeLabel,
  parseTestResults,
  statusBadge,
  type TestCaseResult,
} from '@/features/workspace/testResults'
import { watchExecution } from '@/features/workspace/watchExecution'

const MAX_CASES = 20

interface TestCasesTabProps {
  activity: Activity
  classId: number
}

/** The activity's automatic tests: how they are run, the cases in order, and an editor for the chosen one. */
export function TestCasesTab({ activity, classId }: TestCasesTabProps) {
  const cases = useTestCases(activity.id)
  const create = useCreateTestCase(activity.id)
  const remove = useDeleteTestCase(activity.id)
  const reorder = useReorderTestCases(activity.id)

  // A number is a saved case; 'new' is the empty form for one not created yet.
  const [picked, setPicked] = useState<number | 'new' | null>(null)
  const list = useMemo(() => cases.data ?? [], [cases.data])
  const selected: number | 'new' | null =
    picked === 'new' || (picked !== null && list.some((c) => c.id === picked))
      ? picked
      : (list[0]?.id ?? null)
  const selectedCase =
    typeof selected === 'number' ? list.find((c) => c.id === selected) : undefined

  const [toDelete, setToDelete] = useState<TestCase | null>(null)

  function move(id: number, to: number) {
    const ids = list.map((c) => c.id)
    const from = ids.indexOf(id)
    if (from < 0 || to < 0 || to >= ids.length || from === to) return
    ids.splice(to, 0, ...ids.splice(from, 1))
    reorder.mutate(ids, { onError: (err) => toast.error(errorMessage(err)) })
  }

  function doDelete(c: TestCase) {
    remove.mutate(c.id, {
      onSuccess: () => {
        setToDelete(null)
        setPicked(null)
        toast.success('Test case deleted')
      },
      onError: (err) => {
        setToDelete(null)
        toast.error(errorMessage(err))
      },
    })
  }

  const totalPoints = list.reduce((sum, c) => sum + c.points, 0)

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-3xl text-sm text-ink-muted">
        Test cases grade submissions automatically. Each one runs the entry file with the input you
        give and compares what it prints with the expected output. A case is all or nothing: it
        earns its points only when the output matches. Changes here are saved as you go and apply at
        once, even after the activity is published.
      </p>

      <RunSettings activity={activity} classId={classId} />
      <RequirementsSection activity={activity} classId={classId} />

      <section aria-labelledby="cases-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="cases-heading" className="text-lg font-semibold">
            Cases
            {cases.data && (
              <span className="ml-2 text-sm font-normal text-ink-muted">
                {list.length} of {MAX_CASES} · {totalPoints}{' '}
                {totalPoints === 1 ? 'point' : 'points'}
              </span>
            )}
          </h2>
          <Button
            variant="primary"
            disabled={list.length >= MAX_CASES}
            title={
              list.length >= MAX_CASES ? `An activity can have up to ${MAX_CASES} cases` : undefined
            }
            onClick={() => setPicked('new')}
          >
            <Plus aria-hidden className="size-4" />
            Add test case
          </Button>
        </div>

        {cases.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : cases.isError && !cases.data ? (
          <EmptyState
            title="The test cases could not be loaded"
            action={<Button onClick={() => void cases.refetch()}>Try again</Button>}
          >
            {errorMessage(cases.error)}
          </EmptyState>
        ) : list.length === 0 && selected !== 'new' ? (
          <EmptyState
            title="No test cases yet"
            action={
              <Button variant="primary" onClick={() => setPicked('new')}>
                Add the first test case
              </Button>
            }
          >
            Without test cases, students can run their code but there is nothing to check it
            against.
          </EmptyState>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
            <CaseList
              cases={list}
              selected={selected}
              onSelect={setPicked}
              onMove={move}
              creating={selected === 'new'}
            />
            {selected === 'new' ? (
              <CaseEditor
                key="new"
                activityId={activity.id}
                existingCount={list.length}
                onCreated={(created) => {
                  setPicked(created.id)
                  toast.success('Test case added')
                }}
                onCancel={() => setPicked(null)}
                create={create}
              />
            ) : selectedCase ? (
              <CaseEditor
                key={selectedCase.id}
                activityId={activity.id}
                testCase={selectedCase}
                onDelete={() => setToDelete(selectedCase)}
                existingCount={list.length}
                create={create}
              />
            ) : null}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this test case?"
        confirmLabel="Delete test case"
        destructive
        loading={remove.isPending}
        onConfirm={() => toDelete && doDelete(toDelete)}
        onCancel={() => setToDelete(null)}
      >
        <strong className="text-ink">{toDelete?.name}</strong> will be removed. Scores already given
        stay as they are until you press Re-grade all on the submissions page.
      </ConfirmDialog>
    </div>
  )
}

// ----------------------------------------------------------------------- settings

function RunSettings({ activity, classId }: { activity: Activity; classId: number }) {
  const update = useUpdateActivity(classId)
  const [entry, setEntry] = useState(activity.entry_file)
  const [entryError, setEntryError] = useState<string | null>(null)

  const pyFiles = activity.starter_files.map((f) => f.path).filter((p) => p.endsWith('.py'))
  const missing =
    activity.starter_files.length > 0 &&
    !activity.starter_files.some((f) => f.path === activity.entry_file)

  function patch(body: { entry_file?: string; ignore_input_prompts?: boolean }, done: string) {
    update.mutate(
      { id: activity.id, body },
      {
        onSuccess: () => toast.success(done),
        onError: (err) => {
          if (body.entry_file !== undefined) setEntryError(errorMessage(err))
          else toast.error(errorMessage(err))
        },
      },
    )
  }

  function saveEntry() {
    const value = entry.trim()
    if (value === activity.entry_file) {
      setEntry(value)
      return
    }
    if (value === '' || value.startsWith('/') || value.split('/').includes('..')) {
      setEntryError('Enter a path inside the activity folder, like main.py.')
      return
    }
    setEntryError(null)
    patch({ entry_file: value }, 'Entry file saved')
  }

  return (
    <section aria-labelledby="settings-heading" className="flex flex-col gap-4 card p-5">
      <h2 id="settings-heading" className="text-lg font-semibold">
        How tests run
      </h2>

      <div className="max-w-md">
        <TextField
          label="Entry file"
          value={entry}
          onChange={(e) => {
            setEntry(e.target.value)
            setEntryError(null)
          }}
          onBlur={saveEntry}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              saveEntry()
            }
          }}
          error={entryError}
          list="entry-file-options"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
        <datalist id="entry-file-options">
          {pyFiles.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <p className="mt-1.5 text-sm text-ink-muted">
          The program that is run for every case, relative to the activity folder.
        </p>
        {missing && (
          <p className="mt-1.5 text-sm text-warn">
            The starter files do not include{' '}
            <span className="font-mono">{activity.entry_file}</span>, so students will have to
            create it themselves.
          </p>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p id="ignore-prompts-label" className="text-sm font-medium">
            Ignore input() prompt text when testing
          </p>
          <p className="mt-1 max-w-xl text-sm text-ink-muted">
            When on, the text a program passes to{' '}
            <span className="font-mono">input(&quot;…&quot;)</span> is not printed, so students are
            not marked wrong for wording a prompt differently. Turn it off if your expected output
            includes the prompts.
          </p>
        </div>
        <Switch
          checked={activity.ignore_input_prompts}
          label="Ignore input() prompt text when testing"
          disabled={update.isPending}
          onChange={(checked) =>
            patch(
              { ignore_input_prompts: checked },
              checked ? 'Prompts are ignored when testing' : 'Prompts count when testing',
            )
          }
        />
      </div>
    </section>
  )
}

// -------------------------------------------------------------------------- list

function CaseList({
  cases,
  selected,
  onSelect,
  onMove,
  creating,
}: {
  cases: TestCase[]
  selected: number | 'new' | null
  onSelect: (id: number) => void
  onMove: (id: number, to: number) => void
  creating: boolean
}) {
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)

  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="Test cases, in the order they run" className="flex flex-col gap-1.5">
        {cases.map((c, i) => {
          const active = c.id === selected
          return (
            <li
              key={c.id}
              draggable
              onDragStart={(e) => {
                setDragId(c.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(c.id))
              }}
              onDragOver={(e) => {
                if (dragId === null) return
                e.preventDefault()
                setOverId(c.id)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId !== null && dragId !== c.id) onMove(dragId, i)
                setDragId(null)
                setOverId(null)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverId(null)
              }}
              className={`group flex items-stretch rounded-md border ${
                active && !creating ? 'border-focus bg-brand-100' : 'border-line bg-surface'
              } ${overId === c.id && dragId !== c.id ? 'border-t-2 border-t-focus' : ''} ${
                dragId === c.id ? 'opacity-50' : ''
              }`}
            >
              <span
                aria-hidden
                title="Drag to reorder"
                className="flex cursor-grab items-center px-1 text-ink-muted"
              >
                <GripVertical className="size-4" />
              </span>
              <button
                type="button"
                aria-current={active && !creating ? 'true' : undefined}
                onClick={() => onSelect(c.id)}
                className="min-w-0 flex-1 py-2 pr-2 text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <Badge tone={c.is_hidden ? 'pending' : 'open'}>
                    {c.is_hidden ? 'Hidden' : 'Sample'}
                  </Badge>
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {c.points} {c.points === 1 ? 'pt' : 'pts'} · {matchModeLabel(c.match_mode)}
                </span>
              </button>
              <span className="flex flex-col justify-center pr-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={`Move ${c.name} up`}
                  disabled={i === 0}
                  onClick={() => onMove(c.id, i - 1)}
                  className="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp aria-hidden className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${c.name} down`}
                  disabled={i === cases.length - 1}
                  onClick={() => onMove(c.id, i + 1)}
                  className="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown aria-hidden className="size-3.5" />
                </button>
              </span>
            </li>
          )
        })}
        {creating && (
          <li className="rounded-md border border-dashed border-focus px-3 py-2 text-sm text-ink-muted">
            New test case…
          </li>
        )}
      </ul>
      {cases.length > 1 && (
        <p className="text-xs text-ink-muted">
          Drag the cases, or use the arrows, to change the order.
        </p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------ editor

type FormState = CaseFormState

const toForm = (c: TestCase | undefined, nextNumber: number): FormState => ({
  name: c?.name ?? `Test case ${nextNumber}`,
  stdin: c?.stdin ?? '',
  expected: c?.expected_output ?? '',
  hidden: c?.is_hidden ?? false,
  points: String(c?.points ?? 1),
  mode: c?.match_mode ?? 'trim',
  readAll: c?.require_input_read ?? true,
})

const sameForm = (a: FormState, b: FormState) => JSON.stringify(a) === JSON.stringify(b)

interface CaseEditorProps {
  activityId: number
  /** The saved case being edited; absent for a new one. */
  testCase?: TestCase
  existingCount: number
  onCreated?: (created: TestCase) => void
  onCancel?: () => void
  onDelete?: () => void
  create: ReturnType<typeof useCreateTestCase>
}

function CaseEditor({
  activityId,
  testCase,
  existingCount,
  onCreated,
  onCancel,
  onDelete,
  create,
}: CaseEditorProps) {
  const update = useUpdateTestCase(activityId)
  const baseline = useMemo(() => toForm(testCase, existingCount + 1), [testCase, existingCount])
  const [form, setForm] = useState<FormState>(baseline)
  const [errors, setErrors] = useState<CaseFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const dirty = !sameForm(form, baseline)
  const saving = create.isPending || update.isPending

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))
  }

  function validate(): { points: number } | null {
    const found = validateCaseForm(form)
    setErrors(found)
    return Object.keys(found).length > 0 ? null : { points: Number(form.points) }
  }

  function showServerError(err: unknown) {
    if (err instanceof ApiError && err.code === 'EMPTY_EXPECTED_OUTPUT') {
      setErrors({ expected: err.detail })
    } else if (err instanceof ApiError && err.code === 'TEST_CASE_TOO_LARGE') {
      setErrors({ expected: err.detail })
    } else {
      setFormError(errorMessage(err))
    }
  }

  function save() {
    setFormError(null)
    const checked = validate()
    if (!checked) return
    const body = {
      name: form.name.trim(),
      stdin: form.stdin,
      expected_output: form.expected,
      is_hidden: form.hidden,
      points: checked.points,
      match_mode: form.mode,
      require_input_read: form.readAll ?? true,
    }
    if (!testCase) {
      create.mutate(body, {
        onSuccess: (created) => onCreated?.(created),
        onError: showServerError,
      })
    } else {
      update.mutate(
        { id: testCase.id, body },
        { onSuccess: () => toast.success('Test case saved'), onError: showServerError },
      )
    }
  }

  return (
    <section
      aria-label={testCase ? `Test case: ${testCase.name}` : 'New test case'}
      className="flex flex-col gap-4 card p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <ListChecks aria-hidden className="size-4 text-ink-muted" />
          {testCase ? 'Edit test case' : 'New test case'}
        </h3>
        {testCase && (
          <Button variant="ghost" onClick={onDelete}>
            <Trash2 aria-hidden className="size-4" />
            Delete
          </Button>
        )}
      </div>

      {formError && (
        <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
          {formError}
        </p>
      )}

      <TestCaseFields form={form} errors={errors} onChange={set} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {testCase ? (dirty ? 'You have unsaved changes.' : 'All changes saved.') : ''}
        </p>
        <div className="flex gap-2">
          {!testCase && <Button onClick={onCancel}>Cancel</Button>}
          <Button variant="primary" loading={saving} disabled={!!testCase && !dirty} onClick={save}>
            {testCase ? 'Save changes' : 'Save test case'}
          </Button>
        </div>
      </div>

      {testCase && <TryCase testCase={testCase} dirty={dirty} />}
    </section>
  )
}

// --------------------------------------------------------------------------- try

type TryState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: TestCaseResult }
  | { phase: 'failed'; message: string }

/** Runs the saved case against the activity's starter files and shows what came out next to what was expected. */
function TryCase({ testCase, dirty }: { testCase: TestCase; dirty: boolean }) {
  const [state, setState] = useState<TryState>({ phase: 'idle' })
  const watcher = useRef<{ close: () => void } | null>(null)

  useEffect(() => () => watcher.current?.close(), [])

  async function run() {
    watcher.current?.close()
    setState({ phase: 'running' })
    try {
      const accepted = await tryTestCase(testCase.id)
      watcher.current = watchExecution(accepted.execution_id, {
        onFinished: (ex) => {
          const result = parseTestResults(ex.test_results)[0]
          setState(
            result
              ? { phase: 'done', result }
              : {
                  phase: 'failed',
                  message:
                    ex.status === 'system_error'
                      ? 'Server problem, try again.'
                      : 'The case did not produce a result. Check that the entry file exists in the starter files.',
                },
          )
        },
        onGiveUp: () =>
          setState({ phase: 'failed', message: 'The result did not arrive. Please try again.' }),
      })
    } catch (err) {
      setState({ phase: 'failed', message: errorMessage(err) })
    }
  }

  const running = state.phase === 'running'

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          loading={running}
          disabled={dirty}
          title={dirty ? 'Save your changes first: Try runs the saved test case' : undefined}
          onClick={() => void run()}
        >
          {!running && <Play aria-hidden className="size-4" />}
          Try
        </Button>
        <p className="text-sm text-ink-muted">
          Runs this case against the starter files, so you can check the expected output.
        </p>
      </div>

      {state.phase === 'failed' && (
        <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
          {state.message}
        </p>
      )}

      {state.phase === 'done' && (
        <TryResult
          result={state.result}
          expected={testCase.expected_output ?? ''}
          mode={testCase.match_mode}
        />
      )}
    </div>
  )
}

function TryResult({
  result,
  expected,
  mode,
}: {
  result: TestCaseResult
  expected: string
  mode: MatchMode
}) {
  const badge = statusBadge(result.status)
  const actual = result.actualOutput ?? ''
  return (
    <div aria-label="Result of the try" className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <Badge tone={result.passed ? 'ok' : 'error'}>{result.passed ? 'Pass' : 'Fail'}</Badge>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        <span className="font-normal text-ink-muted">{result.durationMs} ms</span>
      </p>
      {!result.passed && result.message && <p className="text-sm text-warn">{result.message}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <Output label="Actual output" text={actual} empty="(nothing was printed)" />
        <Output label="Expected output" text={expected} empty="(nothing)" />
      </div>
      {!result.passed && <DiffView actual={actual} expected={expected} mode={mode} />}
    </div>
  )
}

function Output({ label, text, empty }: { label: string; text: string; empty: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">{label}</p>
      <pre className="max-h-48 overflow-auto rounded border border-line bg-canvas px-2 py-1.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
        {text === '' ? <span className="text-ink-muted">{empty}</span> : text}
      </pre>
    </div>
  )
}
