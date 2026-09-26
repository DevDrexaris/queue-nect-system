import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Button } from './button'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {Icon ? (
        <span className="mb-3 inline-flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
      ) : null}
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 px-6 py-16 text-sm text-muted-foreground" role="status">
      <span className="size-2 animate-pulse rounded-full bg-accent" />
      {label}
    </div>
  )
}

export function ErrorState({
  title = 'Unable to load this page.',
  description,
  onRetry,
}: {
  title?: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {description || 'Please check your connection and try again.'}
      </p>
      {onRetry ? (
        <Button className="mt-4" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}
