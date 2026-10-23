import { useId } from 'react'
import { SelectField } from '@/components/ui/SelectField'
import { Switch } from '@/components/ui/Switch'
import { TextAreaField } from '@/components/ui/TextAreaField'
import { TextField } from '@/components/ui/TextField'
import { MATCH_MODES } from '@/features/workspace/testResults'
import type { CaseFormErrors, CaseFormState } from '@/lib/testCaseForm'

interface TestCaseFieldsProps {
  form: CaseFormState
  errors: CaseFormErrors
  onChange: <K extends keyof CaseFormState>(key: K, value: CaseFormState[K]) => void
}

/**
 * Name, input, expected output, hidden, points and match mode: the body of every test case editor. An activity's
 * case also has "Program must read all the input" (when `form.readAll` is set).
 */
export function TestCaseFields({ form, errors, onChange }: TestCaseFieldsProps) {
  const modeInfo = MATCH_MODES.find((m) => m.value === form.mode)
  const idBase = useId()
  return (
    <>
      <TextField
        label="Name"
        value={form.name}
        onChange={(e) => onChange('name', e.target.value)}
        error={errors.name}
        maxLength={150}
        autoComplete="off"
      />

      <TextAreaField
        label="Input"
        hint="What the program reads with input(): one value per line."
        value={form.stdin}
        onChange={(e) => onChange('stdin', e.target.value)}
        error={errors.stdin}
        rows={4}
        spellCheck={false}
        className="font-mono"
      />

      <TextAreaField
        label="Expected output"
        hint="What the program should print for that input."
        value={form.expected}
        onChange={(e) => onChange('expected', e.target.value)}
        error={errors.expected}
        rows={5}
        spellCheck={false}
        className="font-mono"
      />

      {form.readAll !== undefined && (
        <div className="flex items-start gap-2.5">
          <input
            id={`${idBase}-read-all`}
            type="checkbox"
            checked={form.readAll}
            onChange={(e) => onChange('readAll', e.target.checked)}
            aria-describedby={`${idBase}-read-all-help`}
            className="mt-0.5 size-4 shrink-0 accent-brand-600"
          />
          <div>
            <label htmlFor={`${idBase}-read-all`} className="text-sm font-medium">
              Program must read all the input
            </label>
            <p id={`${idBase}-read-all-help`} className="mt-0.5 text-sm text-ink-muted">
              Catches hardcoded answers: a program that prints the expected output without reading
              every line of the input fails this case. Only matters when the case has input.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Hidden</p>
          <p className="mt-1 max-w-md text-sm text-ink-muted">
            {form.hidden
              ? 'Students see only Pass or Fail for this case, never its input or output.'
              : 'A sample case: students see its input, their output and the expected output.'}
          </p>
        </div>
        <Switch
          checked={form.hidden}
          label="Hidden test case"
          onChange={(checked) => onChange('hidden', checked)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <TextField
          label="Points"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={form.points}
          onChange={(e) => onChange('points', e.target.value)}
          error={errors.points}
        />
        <div>
          <SelectField
            label="Match mode"
            value={form.mode}
            onChange={(e) => onChange('mode', e.target.value as CaseFormState['mode'])}
            options={MATCH_MODES.map((m) => ({ value: m.value, label: m.label }))}
          />
          <p className="mt-1.5 text-sm text-ink-muted">{modeInfo?.help}</p>
        </div>
      </div>
    </>
  )
}
