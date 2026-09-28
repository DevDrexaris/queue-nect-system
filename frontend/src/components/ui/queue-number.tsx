import { cn } from '../../lib/utils'

const sizes = {
  sm: 'text-xl',
  md: 'text-3xl',
  lg: 'text-5xl sm:text-6xl',
  next: 'text-3xl lg:text-5xl 2xl:text-6xl',
  display: 'text-[clamp(5rem,11vw,16rem)] leading-[0.9]',
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
        'queue-number font-display font-bold tracking-wide tabular-nums text-foreground',
        sizes[size],
        className,
      )}
    >
      {value}
    </span>
  )
}
