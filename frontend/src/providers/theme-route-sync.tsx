import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useTheme } from '../hooks/use-theme'

export function ThemeRouteSync() {
  const { isDark } = useTheme()
  const { pathname } = useLocation()
  const isDisplay = /^\/(display|tv)(\/|$)/.test(pathname)

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', isDisplay || isDark)
  }, [isDark, isDisplay])

  return null
}