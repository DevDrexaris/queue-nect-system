import { cn } from '../../lib/utils'

const sizes = {
  sm: 'text-lg',
  md: 'text-3xl',
  lg: 'text-5xl sm:text-6xl',
  display: 'text-[clamp(4.5rem,14vw,11rem)] leading-none',
} as const

export function QueueNumber({
  value,
  size = 'md',
  className,
}: {
  value: string
  size?: keyof typeof sizes
  className?: string
}) {
  return (
    <span
      className={cn(
        'font-mono font-semibold tracking-tight tabular-nums text-foreground',
        sizes[size],
        className,
      )}
    >
      {value}
    </span>
  )
}
