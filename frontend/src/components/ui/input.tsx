import type { InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
        className,
      )}
      {...props}
    />
  )
}
