import { useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useClearRequirements, useSetRequirements } from '@/api/queries/activities'
import { errorMessage } from '@/api/errors'
import type { Activity } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { toast } from '@/components/ui/toastStore'
import {
  CONSTRUCTS,
  badName,
  describeRequirements,
  fullRequirements,
  hasRequirements,
  parseNames,
  type Construct,
} from '@/lib/requirements'

type Errors = Partial<Record<'functions' | 'calls' | 'imports', string>>

/**
 * The activity's code requirements: checked before its tests run, and every case fails when one is broken (so a
 * hardcoded answer, or a forbidden shortcut, earns nothing). Students see them next to the instructions.
 */
export function RequirementsSection({
  activity,
  classId,
}: {
  activity: Activity
  classId: number
}) {
  const saved = fullRequirements(activity.requirements)
  return (
    // A fresh form whenever the saved requirements change (after Save or Remove).
    <RequirementsForm
      key={JSON.stringify(saved)}
      activityId={activity.id}
      classId={classId}
      saved={saved}
    />
  )
}

function RequirementsForm({
  activityId,
  classId,
  saved,
}: {
  activityId: number
  classId: number
  saved: ReturnType<typeof fullRequirements>
}) {
  const save = useSetRequirements(classId, activityId)
  const clear = useClearRequirements(classId, activityId)
  const [functions, setFunctions] = useState(saved.must_define_functions.join(', '))
  const [use, setUse] = useState<Construct[]>(saved.must_use)
  const [calls, setCalls] = useState(saved.must_not_use_calls.join(', '))
  const [imports, setImports] = useState(saved.must_not_use_imports.join(', '))
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const draft = {
    must_define_functions: parseNames(functions),
    must_use: CONSTRUCTS.map((c) => c.value).filter((v) => use.includes(v)),
    must_not_use_calls: parseNames(calls),
    must_not_use_imports: parseNames(imports),
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const any = hasRequirements(saved)
  const preview = describeRequirements(draft)

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const found: Errors = {}
    const f = badName(draft.must_define_functions, 'function')
    const c = badName(draft.must_not_use_calls, 'call')
    const i = badName(draft.must_not_use_imports, 'import')
    if (f) found.functions = f
    if (c) found.calls = c
    if (i) found.imports = i
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const done = { onError: (err: unknown) => setFormError(errorMessage(err)) }
    if (!hasRequirements(draft)) {
      clear.mutate(undefined, { ...done, onSuccess: () => toast.success('Requirements removed') })
    } else {
      save.mutate(draft, { ...done, onSuccess: () => toast.success('Requirements saved') })
    }
  }

  return (
    <section aria-labelledby="requirements-heading" className="card">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 p-5">
        <div>
          <h2 id="requirements-heading" className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck aria-hidden className="size-5 text-ink-muted" />
            Code requirements
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Checked before the tests run: code that breaks one fails every case, with a message
            saying why. Leave everything empty for no requirements. Students see them next to the
            instructions. Changes apply from the next Test; existing grades change only with
            Regrade.
          </p>
        </div>

        {formError && (
          <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
            {formError}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Functions it must define"
            placeholder="e.g. average, total"
            value={functions}
            onChange={(e) => setFunctions(e.target.value)}
            error={errors.functions}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Must use at least one of</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {CONSTRUCTS.map((c) => (
                <label key={c.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={use.includes(c.value)}
                    onChange={(e) =>
                      setUse((u) =>
                        e.target.checked ? [...u, c.value] : u.filter((v) => v !== c.value),
                      )
                    }
                    className="size-4 accent-brand-600"
                  />
                  <code className="font-mono">{c.value}</code>
                </label>
              ))}
            </div>
          </fieldset>
          <TextField
            label="Calls it must not use"
            placeholder="e.g. .index, sorted"
            value={calls}
            onChange={(e) => setCalls(e.target.value)}
            error={errors.calls}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <TextField
            label="Imports it must not use"
            placeholder="e.g. statistics, math"
            value={imports}
            onChange={(e) => setImports(e.target.value)}
            error={errors.imports}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </div>
        <p className="text-xs text-ink-muted">
          Separate names with commas. <code className="font-mono">.index</code> means a method call
          (anything<code className="font-mono">.index(…)</code>);{' '}
          <code className="font-mono">sorted</code> means a plain call (
          <code className="font-mono">sorted(…)</code>).
        </p>

        {preview.length > 0 && (
          <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
            <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Students will see
            </p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {preview.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {any && (
            <Button
              loading={clear.isPending}
              onClick={() =>
                clear.mutate(undefined, {
                  onSuccess: () => toast.success('Requirements removed'),
                  onError: (err) => setFormError(errorMessage(err)),
                })
              }
            >
              Remove all
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={!dirty} loading={save.isPending}>
            Save requirements
          </Button>
        </div>
      </form>
    </section>
  )
}
