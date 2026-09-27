import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

type ThemeContextValue = {
  theme: ThemePreference
  isDark: boolean
  setTheme: (theme: ThemePreference) => void
}

const THEME_KEY = 'queue-nect-theme'
const ThemeContext = createContext<ThemeContextValue | null>(null)

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

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}