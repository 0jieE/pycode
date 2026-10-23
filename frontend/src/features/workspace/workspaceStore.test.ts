import { beforeEach, describe, expect, it } from 'vitest'
import { dirtyIds, isDirty, useWorkspaceStore } from './workspaceStore'

const s = () => useWorkspaceStore.getState()
const file = (id: number, content = 'x', updated_at = `t${id}`) => ({ id, content, updated_at })

beforeEach(() => s().reset())

describe('opening and closing', () => {
  it('opens a file in a tab and makes it active', () => {
    s().load(file(1))
    s().load(file(2))
    expect(s().tabs).toEqual([1, 2])
    expect(s().activeId).toBe(2)
  })

  it('does not duplicate a tab, and keeps unsaved text when the file is loaded again', () => {
    s().load(file(1, 'saved'))
    s().edit(1, 'typed but not saved')
    s().load(file(1, 'saved')) // e.g. clicking the file in the tree again
    expect(s().tabs).toEqual([1])
    expect(s().files[1]!.content).toBe('typed but not saved')
  })

  it('shows the right neighbour when the active tab closes, else the left one', () => {
    s().load(file(1))
    s().load(file(2))
    s().load(file(3))
    s().activate(2)
    s().closeTab(2)
    expect(s().activeId).toBe(3)
    s().closeTab(3)
    expect(s().activeId).toBe(1)
    s().closeTab(1)
    expect(s().activeId).toBeNull()
  })

  it('keeps the active tab when another one closes', () => {
    s().load(file(1))
    s().load(file(2))
    s().closeTab(1)
    expect(s().activeId).toBe(2)
  })

  it('ignores activating a file that is not open', () => {
    s().load(file(1))
    s().activate(99)
    expect(s().activeId).toBe(1)
  })
})

describe('dirty tracking and saving', () => {
  it('is dirty exactly when the buffer differs from what the server has', () => {
    s().load(file(1, 'a'))
    expect(isDirty(s().files[1])).toBe(false)
    s().edit(1, 'ab')
    expect(isDirty(s().files[1])).toBe(true)
    s().edit(1, 'a') // typed it back
    expect(isDirty(s().files[1])).toBe(false)
  })

  it('bumps rev only when the text really changes', () => {
    s().load(file(1, 'a'))
    s().edit(1, 'a')
    expect(s().files[1]!.rev).toBe(0)
    s().edit(1, 'b')
    expect(s().files[1]!.rev).toBe(1)
  })

  it('stores the new token after a save and clears dirty', () => {
    s().load(file(1, 'a', 'T1'))
    s().edit(1, 'b')
    s().applySaved(1, 'b', 'T2')
    expect(s().files[1]).toMatchObject({ savedContent: 'b', updatedAt: 'T2' })
    expect(isDirty(s().files[1])).toBe(false)
  })

  it('stays dirty when the student typed more while the save was in flight', () => {
    s().load(file(1, 'a', 'T1'))
    s().edit(1, 'b')
    s().edit(1, 'bc') // typed during the request that sent 'b'
    s().applySaved(1, 'b', 'T2')
    expect(isDirty(s().files[1])).toBe(true)
    expect(s().files[1]!.content).toBe('bc')
    expect(s().files[1]!.updatedAt).toBe('T2')
  })

  it('lists dirty files', () => {
    s().load(file(1, 'a'))
    s().load(file(2, 'b'))
    s().edit(2, 'bb')
    expect(dirtyIds(s().files)).toEqual([2])
  })
})

describe('conflict choices', () => {
  it('"load latest" replaces text and token and clears the conflict', () => {
    s().load(file(1, 'mine', 'T1'))
    s().edit(1, 'mine, edited')
    s().setConflict(1, true)
    s().replaceFromServer(1, 'theirs', 'T9')
    expect(s().files[1]).toMatchObject({
      content: 'theirs',
      savedContent: 'theirs',
      updatedAt: 'T9',
      conflict: false,
    })
  })

  it('"keep mine" keeps the text, takes the new token and stays dirty', () => {
    s().load(file(1, 'orig', 'T1'))
    s().edit(1, 'mine')
    s().setConflict(1, true)
    s().adoptToken(1, 'T9')
    expect(s().files[1]).toMatchObject({ content: 'mine', updatedAt: 'T9', conflict: false })
    expect(isDirty(s().files[1])).toBe(true)
  })
})

describe('deleting files', () => {
  it('closes the tabs of deleted files and moves to a surviving neighbour', () => {
    s().load(file(1))
    s().load(file(2))
    s().load(file(3))
    s().activate(2)
    s().drop([2, 3])
    expect(s().tabs).toEqual([1])
    expect(s().activeId).toBe(1)
    expect(s().files[2]).toBeUndefined()
  })

  it('does nothing for files that are not open', () => {
    s().load(file(1))
    s().drop([42])
    expect(s().tabs).toEqual([1])
  })
})

describe('ownership', () => {
  it('begin() empties the state and records the workspace, so another one never shows old tabs', () => {
    s().load(file(1))
    s().begin(7)
    expect(s()).toMatchObject({ owner: 7, tabs: [], activeId: null, files: {} })
    s().load(file(2))
    s().begin('practice')
    expect(s()).toMatchObject({ owner: 'practice', tabs: [], activeId: null, files: {} })
  })
})

describe('saving flag', () => {
  it('tracks an in-flight save', () => {
    s().load(file(1))
    s().setSaving(1, true)
    expect(s().files[1]!.saving).toBe(true)
    s().setSaving(1, false)
    expect(s().files[1]!.saving).toBe(false)
  })
})

describe('lock flags', () => {
  it('reset clears everything, including the lock', () => {
    s().load(file(1))
    s().setLocked(true)
    s().setUnsavedNotice(true)
    s().reset()
    expect(s()).toMatchObject({ tabs: [], activeId: null, locked: false, unsavedNotice: false })
  })
})
