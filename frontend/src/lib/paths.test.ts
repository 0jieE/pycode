import { describe, expect, it } from 'vitest'
import {
  baseName,
  hasPathCollision,
  parentOf,
  validateActivityTitle,
  validateEntryPath,
  validateFilePath,
  validatePath,
} from './paths'

describe('validatePath', () => {
  it.each(['a.py', 'lab1/main.py', 'my folder/notes.txt', 'a/b/c/d.json'])('accepts %s', (p) => {
    expect(validatePath(p)).toBeNull()
  })

  it.each([
    ['', /enter a name/i],
    ['/etc/x.py', /start with \//i],
    ['../x.py', /not allowed/i],
    ['a/../x.py', /not allowed/i],
    ['a\\b.py', /\\/],
    ['a//b.py', /empty/i],
    ['a/', /empty/i],
    ['.hidden.py', /start with '\.'/],
    ['dir/.env', /start with '\.'/],
    [' a.py', /space/i],
    ['a /b.py', /space/i],
    ['x'.repeat(256), /at most 255/],
  ])('rejects %j', (p, message) => {
    expect(validatePath(p)).toMatch(message)
  })
})

describe('validateFilePath', () => {
  it('allows the five workspace types, in any case', () => {
    for (const ext of ['py', 'txt', 'csv', 'json', 'md', 'PY']) {
      expect(validateFilePath(`file.${ext}`)).toBeNull()
    }
  })

  it('rejects other types and extensionless names', () => {
    expect(validateFilePath('run.exe')).toMatch(/file types/)
    expect(validateFilePath('Makefile')).toMatch(/file types/)
    expect(validateFilePath('.py')).toMatch(/start with '\.'/)
  })
})

describe('validateActivityTitle', () => {
  it('needs a single folder name', () => {
    expect(validateActivityTitle('Lab 1 - Loops')).toBeNull()
    expect(validateActivityTitle('   ')).toMatch(/enter a title/i)
    expect(validateActivityTitle('Lab/1')).toMatch(/'\/'/)
    expect(validateActivityTitle('.hidden')).toMatch(/start with/)
  })
})

describe('path helpers', () => {
  it('detects case-insensitive collisions', () => {
    expect(hasPathCollision('A.py', ['b.py', 'a.py'])).toBe(true)
    expect(hasPathCollision('c.py', ['b.py', 'a.py'])).toBe(false)
  })

  it('splits names and parents', () => {
    expect(baseName('a/b/c.py')).toBe('c.py')
    expect(baseName('c.py')).toBe('c.py')
    expect(parentOf('a/b/c.py')).toBe('a/b')
    expect(parentOf('c.py')).toBe('')
  })
})

describe('validateEntryPath', () => {
  const entries = [
    { path: 'Lab 1', is_folder: true },
    { path: 'Lab 1/main.py', is_folder: false },
    { path: 'notes.txt', is_folder: false },
  ]

  it('accepts a new file in an existing folder and a brand new nested path', () => {
    expect(validateEntryPath('Lab 1/helpers.py', { isFolder: false, entries })).toBeNull()
    expect(validateEntryPath('new/deeper/a.py', { isFolder: false, entries })).toBeNull()
  })

  it('applies the file-type rule to files but not folders', () => {
    expect(validateEntryPath('run.exe', { isFolder: false, entries })).toMatch(/file types/)
    expect(validateEntryPath('archive.exe', { isFolder: true, entries })).toBeNull()
  })

  it('rejects a name that exists, ignoring capitals', () => {
    expect(validateEntryPath('lab 1/MAIN.PY', { isFolder: false, entries })).toMatch(
      /already exists/,
    )
    expect(validateEntryPath('LAB 1', { isFolder: true, entries })).toMatch(/already exists/)
  })

  it('lets an entry be renamed to a different capitalisation of itself', () => {
    expect(
      validateEntryPath('Notes.txt', { isFolder: false, entries, movingFrom: 'notes.txt' }),
    ).toBeNull()
  })

  it('rejects building a path through a file', () => {
    expect(validateEntryPath('notes.txt/inner.py', { isFolder: false, entries })).toMatch(
      /is a file/,
    )
  })

  it('rejects moving a folder into itself or its own subfolder', () => {
    const moving = { isFolder: true, entries, movingFrom: 'Lab 1' }
    expect(validateEntryPath('Lab 1/sub', moving)).toMatch(/into itself/)
    expect(validateEntryPath('lab 1/a/b', moving)).toMatch(/into itself/)
    expect(validateEntryPath('Lab 2', moving)).toBeNull()
  })
})
