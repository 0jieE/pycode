import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme, cachedTheme, resolveEditorTheme, resolveTheme } from './theme'

describe('resolveTheme', () => {
  it('keeps an explicit choice whatever the computer says', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('follows the computer for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('resolveEditorTheme', () => {
  it('matches the app unless told otherwise', () => {
    expect(resolveEditorTheme('match', 'light')).toBe('light')
    expect(resolveEditorTheme('match', 'dark')).toBe('dark')
    expect(resolveEditorTheme('dark', 'light')).toBe('dark')
    expect(resolveEditorTheme('light', 'dark')).toBe('light')
  })
})

describe('applying and remembering', () => {
  afterEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('marks the page and remembers the theme for the next load', () => {
    expect(cachedTheme()).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(cachedTheme()).toBe('light')
  })
})
