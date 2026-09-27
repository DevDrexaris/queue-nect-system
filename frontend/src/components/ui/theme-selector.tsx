import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from './button'
import { useTheme } from '../../hooks/use-theme'

const nextTheme = {
  light: 'dark',
  dark: 'system',
  system: 'light',
} as const

export function ThemeSelector() {
  const { theme, setTheme } = useTheme()
  const label = `${theme[0].toUpperCase()}${theme.slice(1)} mode`
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${label}. Click to change theme.`}
      title={label}
      onClick={() => setTheme(nextTheme[theme])}
      className="shrink-0 motion-safe:transition-transform motion-safe:hover:scale-105 motion-safe:focus-visible:scale-105"
    >
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  )
}