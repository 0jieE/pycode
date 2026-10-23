import { describe, expect, it } from 'vitest'
import { buildTree, folderPaths, renameSubtree, type TreeNode } from './treeUtils'

const file = (path: string) => ({ path, is_folder: false })
const folder = (path: string) => ({ path, is_folder: true })

/** Compact text form: folders end in "/", children are indented. */
function outline(nodes: TreeNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.name}${n.isFolder ? '/' : ''}`,
    ...outline(n.children, depth + 1),
  ])
}

describe('buildTree', () => {
  it('nests flat paths and lists folders before files, each sorted', () => {
    const tree = buildTree([
      file('zeta.py'),
      file('Lab 1/main.py'),
      folder('Lab 1'),
      file('alpha.txt'),
      folder('data'),
      file('Lab 1/helpers.py'),
      file('data/scores.csv'),
    ])
    expect(outline(tree)).toEqual([
      'data/',
      '  scores.csv',
      'Lab 1/',
      '  helpers.py',
      '  main.py',
      'alpha.txt',
      'zeta.py',
    ])
  })

  it('creates folders that are only implied by a file path', () => {
    expect(outline(buildTree([file('a/b/c.py')]))).toEqual(['a/', '  b/', '    c.py'])
  })

  it('sorts numbers naturally and ignores case', () => {
    const names = buildTree([file('file10.py'), file('File2.py'), file('file1.py')]).map(
      (n) => n.name,
    )
    expect(names).toEqual(['file1.py', 'File2.py', 'file10.py'])
  })

  it('shows an empty folder', () => {
    expect(outline(buildTree([folder('empty')]))).toEqual(['empty/'])
  })

  it('does not duplicate a path listed twice', () => {
    expect(outline(buildTree([file('a.py'), file('a.py')]))).toEqual(['a.py'])
  })
})

describe('folderPaths', () => {
  it('lists every folder including implied parents', () => {
    expect(folderPaths([file('a/b/c.py'), folder('x')]).sort()).toEqual(['a', 'a/b', 'x'])
  })
})

describe('renameSubtree', () => {
  const entries = [
    { id: 1, path: 'lab', is_folder: true },
    { id: 2, path: 'lab/main.py', is_folder: false },
    { id: 3, path: 'lab/data', is_folder: true },
    { id: 4, path: 'lab/data/in.csv', is_folder: false },
    { id: 5, path: 'lab2', is_folder: true },
    { id: 6, path: 'lab2/other.py', is_folder: false },
    { id: 7, path: 'notes.txt', is_folder: false },
  ]
  const paths = (list: { path: string }[]) => list.map((e) => e.path)

  it('renames a folder and everything inside it, at any depth', () => {
    expect(paths(renameSubtree(entries, 'lab', 'practice'))).toEqual([
      'practice',
      'practice/main.py',
      'practice/data',
      'practice/data/in.csv',
      'lab2',
      'lab2/other.py',
      'notes.txt',
    ])
  })

  it('leaves a sibling that only shares the first letters alone', () => {
    const after = renameSubtree(entries, 'lab', 'x')
    expect(after.find((e) => e.id === 5)!.path).toBe('lab2')
    expect(after.find((e) => e.id === 6)!.path).toBe('lab2/other.py')
  })

  it('moves a folder into another one', () => {
    expect(paths(renameSubtree(entries, 'lab/data', 'lab2/data'))).toEqual([
      'lab',
      'lab/main.py',
      'lab2/data',
      'lab2/data/in.csv',
      'lab2',
      'lab2/other.py',
      'notes.txt',
    ])
  })

  it('renames a single file, and keeps ids and other fields', () => {
    const after = renameSubtree(entries, 'notes.txt', 'lab/notes.txt')
    expect(after[6]).toEqual({ id: 7, path: 'lab/notes.txt', is_folder: false })
  })

  it('does not change the list it was given, and changes nothing for an unknown path', () => {
    const copy = JSON.parse(JSON.stringify(entries))
    renameSubtree(entries, 'lab', 'practice')
    expect(entries).toEqual(copy)
    expect(renameSubtree(entries, 'missing', 'x')).toEqual(entries)
  })

  it('the renamed list builds the tree you expect', () => {
    const tree = buildTree(renameSubtree(entries, 'lab', 'practice'))
    expect(tree.map((n) => n.name)).toEqual(['lab2', 'practice', 'notes.txt'])
  })
})
