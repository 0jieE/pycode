import { useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import {
  cachedTheme,
  resolveEditorTheme,
  resolveTheme,
  systemPrefersDark,
  type AppliedTheme,
} from './theme'

/** Whether the computer is set to dark, kept up to date when it changes. */
function useSystemPrefersDark(): boolean {
  const [dark, setDark] = useState(systemPrefersDark)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return dark
}

/** The theme on screen: the signed-in user's, or the last one shown in this browser while nobody is. */
export function useAppTheme(): AppliedTheme {
  const { user } = useAuth()
  const systemDark = useSystemPrefersDark()
  return user ? resolveTheme(user.preferences.theme, systemDark) : cachedTheme()
}

/** The code editor's colours for the signed-in user. */
export function useEditorTheme(): AppliedTheme {
  const { user } = useAuth()
  const app = useAppTheme()
  return user ? resolveEditorTheme(user.preferences.editor_theme, app) : app
}
