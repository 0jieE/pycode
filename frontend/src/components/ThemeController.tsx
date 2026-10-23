import { useEffect } from 'react'
import { applyTheme } from '@/lib/theme'
import { useAppTheme } from '@/lib/useTheme'

/** Puts the theme on the page (`<html data-theme>`), and keeps it there as it changes. Renders nothing. */
export function ThemeController() {
  const theme = useAppTheme()
  useEffect(() => applyTheme(theme), [theme])
  return null
}
