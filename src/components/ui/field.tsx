import type { LabelHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-sm font-medium text-foreground', className)} {...props} />
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="mt-1.5 text-sm text-destructive" role="alert">
      {message}
    </p>
  )
}
