import { Search } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn('relative block', className)}>
      <span className="sr-only">{props['aria-label'] || 'Search'}</span>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        className="h-10 w-full rounded-lg border border-border bg-card pr-3 pl-9 text-sm shadow-sm placeholder:text-muted-foreground/70"
        {...props}
      />
    </label>
  )
}
