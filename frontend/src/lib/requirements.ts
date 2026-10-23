import type { Requirements } from '@/api/types'

/**
 * An activity's code requirements (checked by the server before its tests run): functions to define, constructs
 * of which at least one must appear, calls and imports that are not allowed. Here: reading what the instructor
 * types, and saying it in sentences for the student.
 */

export type Construct = 'for' | 'while' | 'if' | 'def' | 'class'

export const CONSTRUCTS: { value: Construct; label: string }[] = [
  { value: 'for', label: 'a for loop' },
  { value: 'while', label: 'a while loop' },
  { value: 'if', label: 'an if statement' },
  { value: 'def', label: 'a function (def)' },
  { value: 'class', label: 'a class' },
]

export const EMPTY_REQUIREMENTS: Required<Requirements> = {
  must_define_functions: [],
  must_use: [],
  must_not_use_calls: [],
  must_not_use_imports: [],
}

/** Every list present (the API may leave empty ones out). */
export function fullRequirements(r: Requirements | null | undefined): Required<Requirements> {
  return {
    must_define_functions: r?.must_define_functions ?? [],
    must_use: r?.must_use ?? [],
    must_not_use_calls: r?.must_not_use_calls ?? [],
    must_not_use_imports: r?.must_not_use_imports ?? [],
  }
}

export const hasRequirements = (r: Requirements | null | undefined): boolean =>
  Object.values(fullRequirements(r)).some((list) => list.length > 0)

/** "average(), total" -> ["average", "total"]: commas or spaces, a trailing "()" dropped, no repeats. */
export function parseNames(text: string): string[] {
  const names = text
    .split(/[\s,]+/)
    .map((n) => n.trim().replace(/\(\)$/, ''))
    .filter(Boolean)
  return [...new Set(names)]
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const CALL = /^\.?[A-Za-z_][A-Za-z0-9_]*$/
const MODULE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/

export type NameKind = 'function' | 'call' | 'import'

/** The first name that is not one, in a sentence, or null when all are fine. */
export function badName(names: readonly string[], kind: NameKind): string | null {
  const ok = kind === 'function' ? IDENT : kind === 'call' ? CALL : MODULE
  const bad = names.find((n) => !ok.test(n))
  if (!bad) return null
  return kind === 'call'
    ? `"${bad}" is not a call name: use a name like sorted, or .index for a method.`
    : kind === 'import'
      ? `"${bad}" is not a module name, e.g. math or os.path.`
      : `"${bad}" is not a function name: letters, digits and _, not starting with a digit.`
}

const list = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** ".index" -> ".index()", "sorted" -> "sorted()". */
const asCall = (name: string) => `${name}()`

/** The requirements as sentences for the student, in a fixed order. */
export function describeRequirements(r: Requirements | null | undefined): string[] {
  const req = fullRequirements(r)
  const lines: string[] = []
  const fns = req.must_define_functions
  if (fns.length === 1) lines.push(`Define a function named ${asCall(fns[0]!)}.`)
  else if (fns.length > 1) lines.push(`Define the functions ${list(fns.map(asCall))}.`)
  const use = req.must_use.map((u) => CONSTRUCTS.find((c) => c.value === u)?.label ?? u)
  if (use.length === 1) lines.push(`Use ${use[0]}.`)
  else if (use.length > 1) lines.push(`Use at least one of: ${use.join(', ')}.`)
  if (req.must_not_use_calls.length > 0) {
    lines.push(`Do not use ${list(req.must_not_use_calls.map(asCall))}.`)
  }
  if (req.must_not_use_imports.length > 0) {
    lines.push(`Do not import ${list(req.must_not_use_imports)}.`)
  }
  return lines
}
