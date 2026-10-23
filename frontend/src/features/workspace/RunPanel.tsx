import { useState } from 'react'
import { ListChecks, OctagonX, Play, RotateCcw } from 'lucide-react'
import type { StudentCase } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { baseName } from '@/lib/paths'
import { useNow } from '@/lib/useNow'
import { InputRequestPanel } from './InputRequestPanel'
import { promptOf, type RunMode } from './interactive'
import { PanelTabs, type PanelTab } from './PanelTabs'
import { RunStatusLine } from './RunStatusLine'
import { isBusy, type RunState } from './runStore'
import { Terminal } from './Terminal'
import { initialTestState, type TestState } from './testStore'
import { TestResultsPanel } from './TestResultsPanel'
import { TestStatusLine } from './TestStatusLine'

/** What the Test button and the results need: only given when the activity being worked on has tests. */
export interface TestsProps {
  state: TestState
  /** False when the last Test was of another activity's folder: its results are not shown here. */
  matches: boolean
  /** The cases the student may see. */
  cases: readonly StudentCase[]
  onTest: () => void
  /** Why Test is off right now ("Laboratory access is closed"), or null when it can be used. */
  disabledReason: string | null
}

interface RunPanelProps {
  /** Paths of the .py files the student can run. */
  entries: string[]
  entry: string
  onEntryChange: (path: string) => void
  stdin: string
  onStdinChange: (text: string) => void
  /** How the next run gets its input: typed live as the program asks, or read from the input list. */
  mode: RunMode
  onModeChange: (mode: RunMode) => void
  onRun: () => void
  /** Run the same program again, reading the inputs of the last interactive run from the list. */
  onRunAgain: () => void
  /** Answers, ends the input of, or stops the interactive run that is going. */
  onSendInput: (value: string) => void
  onEndInput: () => void
  onStop: () => void
  /** Why Run is off right now ("Laboratory access is closed"), or null when it can be used. */
  runDisabledReason: string | null
  run: RunState
  onClear: () => void
  tests?: TestsProps
}

const MODES: { value: RunMode; label: string; help: string }[] = [
  {
    value: 'interactive',
    label: 'Interactive',
    help: 'The program stops at each input() and you type the answer.',
  },
  {
    value: 'batch',
    label: 'Use input list',
    help: 'Every input is read from the list below, one value per line.',
  },
]

/** Entry file, how input is given, Run / Test / Stop, the status line, and the terminal / test results. */
export function RunPanel(props: RunPanelProps) {
  const { entries, entry, runDisabledReason, run, tests, mode } = props
  const runBusy = isBusy(run.phase)
  const testPhase = tests?.state.phase ?? 'idle'
  const testBusy = isBusy(testPhase)
  const busy = runBusy || testBusy

  // After a 429/503 the buttons stay off for a few seconds.
  const blockedUntil = Math.max(run.blockedUntil ?? 0, tests?.state.blockedUntil ?? 0)
  const now = useNow(blockedUntil > 0 ? 250 : 60_000)
  const paused = blockedUntil > now

  // The bottom panel follows what the student just did: Test shows the results, Run shows the terminal.
  const [tab, setTab] = useState<PanelTab>('terminal')
  const [seen, setSeen] = useState({ run: run.phase, test: testPhase })
  if (seen.run !== run.phase || seen.test !== testPhase) {
    setSeen({ run: run.phase, test: testPhase })
    if (testPhase === 'saving' && seen.test !== 'saving') setTab('tests')
    else if (run.phase === 'saving' && seen.run !== 'saving') setTab('terminal')
  }
  const shownTab: PanelTab = tests ? tab : 'terminal'

  const shownTest = tests && tests.matches ? tests.state : initialTestState
  const totals = shownTest.phase === 'finished' ? shownTest.totals : null
  const tabs = tests ? (
    <PanelTabs
      active={shownTab}
      onChange={setTab}
      testsBadge={totals ? `${totals.passed}/${totals.total}` : undefined}
    />
  ) : undefined

  // An interactive run that took typed input can be run again with the same lines.
  const canRerun = run.phase === 'finished' && run.mode === 'interactive' && run.inputs.length > 0
  const showList = mode === 'batch' || canRerun
  const canStop =
    run.mode === 'interactive' &&
    !run.stopping &&
    (run.phase === 'queued' || run.phase === 'running')
  const asking = run.phase === 'running' && run.waitingForInput && !run.stopping

  return (
    <section aria-label="Run" className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex flex-col gap-3 border-b border-line p-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="entry-file" className="text-sm font-medium">
            File to run
          </label>
          <select
            id="entry-file"
            value={entry}
            onChange={(e) => props.onEntryChange(e.target.value)}
            disabled={entries.length === 0 || busy}
            className="h-8 rounded-md border border-line bg-field px-2 text-sm"
          >
            {entries.length === 0 && <option value="">No .py files yet</option>}
            {entries.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span id="input-mode-label" className="text-sm font-medium">
            Input
          </span>
          <div
            role="radiogroup"
            aria-labelledby="input-mode-label"
            className="flex rounded-md bg-field p-0.5 text-sm"
          >
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                title={m.help}
                disabled={busy}
                onClick={() => props.onModeChange(m.value)}
                className={`h-6 flex-1 rounded px-2 font-medium disabled:cursor-not-allowed ${
                  mode === m.value
                    ? 'bg-brand-600 text-white'
                    : 'text-ink-muted hover:text-ink-strong disabled:hover:text-ink-muted'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {showList && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="program-input" className="text-sm font-medium">
              {mode === 'batch'
                ? 'Program input (one value per line, read by input())'
                : 'Inputs from the last run (one value per line)'}
            </label>
            <textarea
              id="program-input"
              value={props.stdin}
              onChange={(e) => props.onStdinChange(e.target.value)}
              rows={3}
              spellCheck={false}
              className="resize-y rounded-md border border-line bg-field px-2 py-1.5 font-mono text-sm"
            />
          </div>
        )}

        <div className="flex items-start gap-3">
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              variant="primary"
              loading={runBusy}
              disabled={runDisabledReason !== null || entry === '' || paused || testBusy}
              title={runDisabledReason ?? `Run ${baseName(entry)} (Ctrl+Enter)`}
              onClick={props.onRun}
            >
              {!runBusy && <Play aria-hidden className="size-4" />}
              Run
            </Button>
            {canStop && (
              <Button variant="danger" onClick={props.onStop} title="End the program now">
                <OctagonX aria-hidden className="size-4" />
                Stop
              </Button>
            )}
            {tests && (
              <Button
                loading={testBusy}
                disabled={tests.disabledReason !== null || paused || runBusy}
                title={
                  tests.disabledReason ??
                  "Check your work against this activity's tests, without submitting"
                }
                onClick={tests.onTest}
              >
                {!testBusy && <ListChecks aria-hidden className="size-4" />}
                Test
              </Button>
            )}
          </div>
          <div className="min-h-7 min-w-0 flex-1 pt-1 text-sm" aria-live="polite">
            {runDisabledReason && !busy ? (
              <span className="text-ink-muted">{runDisabledReason}</span>
            ) : tests && (testBusy || (tests.state.notice && run.phase === 'idle')) ? (
              <TestStatusLine test={tests.state} />
            ) : (
              <RunStatusLine run={run} />
            )}
          </div>
        </div>

        {canRerun && (
          <div>
            <Button
              disabled={runDisabledReason !== null || entry === '' || paused || busy}
              title="Run it again, giving it the same inputs from the list (no questions asked)"
              onClick={props.onRunAgain}
            >
              <RotateCcw aria-hidden className="size-4" />
              Run again with same inputs
            </Button>
          </div>
        )}
      </div>
      {tests && shownTab === 'tests' ? (
        <TestResultsPanel state={shownTest} cases={tests.cases} tabs={tabs} />
      ) : (
        <Terminal
          text={run.output}
          echoes={run.echoes}
          onClear={props.onClear}
          tabs={tabs}
          reserveBottom={asking}
          overlay={
            asking ? (
              // Remounted for each question, so every answer starts with an empty, focused box.
              <InputRequestPanel
                key={run.inputRequestedAt}
                prompt={promptOf(run.output)}
                error={run.inputError}
                onSend={props.onSendInput}
                onEndInput={props.onEndInput}
                onStop={props.onStop}
              />
            ) : undefined
          }
        />
      )}
    </section>
  )
}
