import type { Preferences } from '@/api/types'

/** The two looks the app actually has. "system" in the preferences resolves to one of them. */
export type AppliedTheme = 'dark' | 'light'

export const DEFAULT_PREFERENCES: Preferences = { theme: 'dark', editor_theme: 'match' }

/** The theme to show: the user's choice, with "system" following the computer's light/dark setting. */
export function resolveTheme(
  theme: Preferences['theme'],
  systemPrefersDark: boolean,
): AppliedTheme {
  if (theme === 'system') return systemPrefersDark ? 'dark' : 'light'
  return theme
}

/** The code editor's colours: its own choice, or the app's ("match"). */
export function resolveEditorTheme(
  editorTheme: Preferences['editor_theme'],
  appTheme: AppliedTheme,
): AppliedTheme {
  return editorTheme === 'match' ? appTheme : editorTheme
}

/**
 * The last theme shown, kept in this browser so the next page load starts with it (before the server has said
 * who is signed in) instead of flashing the default.
 */
const CACHE_KEY = 'lab.theme.v1'

export function cachedTheme(): AppliedTheme {
  try {
    return localStorage.getItem(CACHE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: AppliedTheme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(CACHE_KEY, theme)
  } catch {
    // Storage blocked: the next load starts dark, then switches when the user is known.
  }
}

export const systemPrefersDark = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches
