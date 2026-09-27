import { Monitor } from 'lucide-react'
import { useTheme } from '../../providers/theme-provider'

export function ThemeSelector({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme()

  return (
    <label className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-input px-2 text-foreground ${className}`}>
      <Monitor className="size-4 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Color theme</span>
      <select
        aria-label="Color theme"
        value={theme}
        onChange={(event) => setTheme(event.target.value as 'light' | 'dark' | 'system')}
        className="h-full w-[76px] cursor-pointer bg-transparent text-xs font-medium outline-none"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  )
}