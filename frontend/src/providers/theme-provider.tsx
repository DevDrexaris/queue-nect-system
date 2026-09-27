import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { ThemeContext, type ThemePreference } from './theme-context'

const THEME_KEY = 'queue-nect-theme'

function readTheme(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
    const legacy = window.localStorage.getItem('queue-nect-admin-theme')
    if (legacy === 'light' || legacy === 'dark') return legacy
  } catch {
    return 'system'
  }
  return 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePreference>(readTheme)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const dark = theme === 'dark' || (theme === 'system' && systemDark)

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, theme)
    } catch {
      // The theme still works for the current session when storage is unavailable.
    }
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return <ThemeContext.Provider value={{ theme, isDark: dark, setTheme }}>{children}</ThemeContext.Provider>
}