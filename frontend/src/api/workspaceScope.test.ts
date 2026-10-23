import { describe, expect, it } from 'vitest'
import { isPractice, PRACTICE, workspaceEndpoints } from './workspaceScope'

describe('workspaceEndpoints', () => {
  it('a class workspace uses the /workspace endpoints, with the class id where the server wants it', () => {
    const e = workspaceEndpoints(7)
    expect(e.tree).toBe('/workspace/7/tree')
    expect(e.create).toBe('/workspace/7/files')
    expect(e.run).toBe('/workspace/7/run')
    expect(e.file(42)).toBe('/workspace/files/42')
    expect(e.versions(42)).toBe('/workspace/files/42/versions')
    expect(e.version(9)).toBe('/workspace/versions/9')
  })

  it('Practice uses the parallel /practice endpoints, which need no class id', () => {
    const e = workspaceEndpoints(PRACTICE)
    expect(e.tree).toBe('/practice/tree')
    expect(e.create).toBe('/practice/files')
    expect(e.run).toBe('/practice/run')
    expect(e.file(42)).toBe('/practice/files/42')
    expect(e.versions(42)).toBe('/practice/files/42/versions')
    expect(e.version(9)).toBe('/practice/versions/9')
  })

  it('never mixes the two: a Practice path never contains /workspace and the reverse', () => {
    const practice = workspaceEndpoints('practice')
    const lab = workspaceEndpoints(3)
    const all = (e: typeof practice) => [
      e.tree,
      e.create,
      e.run,
      e.file(1),
      e.versions(1),
      e.version(1),
    ]
    expect(all(practice).some((p) => p.includes('/workspace'))).toBe(false)
    expect(all(lab).some((p) => p.includes('/practice'))).toBe(false)
  })

  it('tells the scopes apart', () => {
    expect(isPractice('practice')).toBe(true)
    expect(isPractice(0)).toBe(false)
    expect(isPractice(12)).toBe(false)
  })
})
