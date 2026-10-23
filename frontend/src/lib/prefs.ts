import { create } from 'zustand'

/**
 * UI preferences only (editor theme, pane sizes). Never tokens, passwords or code.
 * localStorage can be missing or throw (private windows, blocked site data), so every access is guarded.
 */
const KEY = 'lab.ui-prefs'

export interface Prefs {
  editorTheme: 'dark' | 'light'
  treeWidth: number
  runWidth: number
}

export const DEFAULT_PREFS: Prefs = { editorTheme: 'dark', treeWidth: 240, runWidth: 380 }

export function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFS
    const p = parsed as Partial<Prefs>
    return {
      editorTheme: p.editorTheme === 'light' ? 'light' : 'dark',
      treeWidth: typeof p.treeWidth === 'number' ? p.treeWidth : DEFAULT_PREFS.treeWidth,
      runWidth: typeof p.runWidth === 'number' ? p.runWidth : DEFAULT_PREFS.runWidth,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function writePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Not saved: the preference simply resets next visit.
  }
}

interface PrefsState extends Prefs {
  set: (patch: Partial<Prefs>) => void
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...readPrefs(),
  set: (patch) => {
    set(patch)
    const { editorTheme, treeWidth, runWidth } = get()
    writePrefs({ editorTheme, treeWidth, runWidth })
  },
}))
