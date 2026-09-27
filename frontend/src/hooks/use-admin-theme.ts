import { useState } from 'react'

const THEME_KEY = 'queue-nect-admin-theme'

export function useAdminTheme() {
  const [isDark, setIsDark] = useState(() => window.localStorage.getItem(THEME_KEY) !== 'light')

  function toggleTheme() {
    setIsDark((current) => {
      const next = !current
      window.localStorage.setItem(THEME_KEY, next ? 'dark' : 'light')
      return next
    })
  }

  return { isDark, toggleTheme }
}