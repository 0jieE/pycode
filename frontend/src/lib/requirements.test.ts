import { describe, expect, it } from 'vitest'
import { badName, describeRequirements, hasRequirements, parseNames } from './requirements'

describe('activity code requirements', () => {
  it('reads names typed with commas, spaces or brackets', () => {
    expect(parseNames('average(), total  average')).toEqual(['average', 'total'])
    expect(parseNames(' .index(), sorted ')).toEqual(['.index', 'sorted'])
    expect(parseNames('')).toEqual([])
  })

  it('checks the names before sending them', () => {
    expect(badName(['average', '_x1'], 'function')).toBeNull()
    expect(badName(['2nd'], 'function')).toMatch(/not a function name/)
    expect(badName(['.index', 'sorted'], 'call')).toBeNull()
    expect(badName(['a.b'], 'call')).toMatch(/not a call name/)
    expect(badName(['os.path', 'math'], 'import')).toBeNull()
    expect(badName(['os..path'], 'import')).toMatch(/not a module name/)
  })

  it('says them in sentences for the student', () => {
    expect(
      describeRequirements({
        must_define_functions: ['average'],
        must_use: ['for', 'while'],
        must_not_use_calls: ['.index', 'sorted'],
        must_not_use_imports: ['statistics', 'math'],
      }),
    ).toEqual([
      'Define a function named average().',
      'Use at least one of: a for loop, a while loop.',
      'Do not use .index() and sorted().',
      'Do not import statistics and math.',
    ])
    expect(
      describeRequirements({ must_define_functions: ['a', 'b', 'c'], must_use: ['if'] }),
    ).toEqual(['Define the functions a(), b() and c().', 'Use an if statement.'])
    expect(describeRequirements(null)).toEqual([])
    expect(hasRequirements({ must_use: [] })).toBe(false)
    expect(hasRequirements({ must_not_use_imports: ['math'] })).toBe(true)
  })
})
