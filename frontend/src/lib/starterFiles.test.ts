import { describe, expect, it } from 'vitest'
import { starterFilesProblem } from './starterFiles'

const f = (path: string, content = '') => ({ path, content })

describe('starterFilesProblem', () => {
  it('accepts an empty set and normal files', () => {
    expect(starterFilesProblem([])).toBeNull()
    expect(starterFilesProblem([f('main.py', 'print(1)'), f('data/in.csv', 'a,b')])).toBeNull()
  })

  it('reports bad paths with the file name', () => {
    expect(starterFilesProblem([f('../x.py')])).toMatch(/^\.\.\/x\.py: /)
    expect(starterFilesProblem([f('run.exe')])).toMatch(/file types/)
  })

  it('treats names that differ only by case as duplicates', () => {
    expect(starterFilesProblem([f('A.py'), f('a.py')])).toMatch(/appears twice/)
  })

  it('enforces the largest possible file limit (1 MB) in bytes, not characters', () => {
    // The students' own limit (set by an admin) is checked by the server, which names the file.
    expect(starterFilesProblem([f('big.py', 'x'.repeat(1024 * 1024))])).toBeNull()
    expect(starterFilesProblem([f('big.py', 'x'.repeat(1024 * 1024 + 1))])).toMatch(
      /larger than 1 MB/,
    )
    // 400,000 characters of 3 bytes each is 1,200,000 bytes.
    expect(starterFilesProblem([f('uni.py', '€'.repeat(400_000))])).toMatch(/larger than 1 MB/)
  })

  it('enforces the file count and the 1 MB total', () => {
    const many = Array.from({ length: 51 }, (_, i) => f(`f${i}.py`))
    expect(starterFilesProblem(many)).toMatch(/at most 50/)
    const heavy = Array.from({ length: 11 }, (_, i) => f(`f${i}.py`, 'x'.repeat(99 * 1024)))
    expect(starterFilesProblem(heavy)).toMatch(/1 MB/)
  })
})
