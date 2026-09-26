import type { SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground shadow-sm disabled:cursor-not-allowed disabled:bg-muted',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}
