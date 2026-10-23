import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, readPrefs, usePrefs } from './prefs'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('prefs', () => {
  it('falls back to the defaults when nothing is stored', () => {
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
  })

  it('ignores corrupt or wrong-typed stored values', () => {
    localStorage.setItem('lab.ui-prefs', '{not json')
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
    localStorage.setItem('lab.ui-prefs', JSON.stringify({ editorTheme: 'neon', treeWidth: 'wide' }))
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
  })

  it('survives localStorage throwing on read and on write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(readPrefs()).toEqual(DEFAULT_PREFS)
    expect(() => usePrefs.getState().set({ editorTheme: 'light' })).not.toThrow()
    // The in-memory value still changes for this visit.
    expect(usePrefs.getState().editorTheme).toBe('light')
    usePrefs.getState().set({ editorTheme: 'dark' })
  })

  it('stores only UI preferences', () => {
    usePrefs.getState().set({ treeWidth: 300 })
    expect(Object.keys(JSON.parse(localStorage.getItem('lab.ui-prefs')!)).sort()).toEqual([
      'editorTheme',
      'runWidth',
      'treeWidth',
    ])
  })
})
