import { cn } from '../../lib/utils'
import bshireLogo from '../../assets/bshirelogo.jpg'

type Size = 'sm' | 'md' | 'lg'

const sizes: Record<Size, { mark: string; text: string; gap: string }> = {
  sm: { mark: 'size-7', text: 'text-sm', gap: 'gap-2' },
  md: { mark: 'size-9', text: 'text-base', gap: 'gap-2.5' },
  lg: { mark: 'size-12', text: 'text-xl', gap: 'gap-3' },
}

type BrandProps = {
  className?: string
  size?: Size
  inverted?: boolean
}

export function BrandMark({ className, size = 'md' }: BrandProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-lg',
        'bg-transparent shadow-none ring-0',
        sizes[size].mark,
        className,
      )}
      aria-hidden="true"
    >
      <img src={bshireLogo} alt="" className="size-full rounded-lg object-contain" />
    </span>
  )
}

export function BrandName({ className, size = 'md', inverted = false }: BrandProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap font-semibold tracking-tight',
        inverted ? 'text-white' : 'text-slate-900 dark:text-slate-100',
        sizes[size].text,
        className,
      )}
    >
      QUEUE-NECT
    </span>
  )
}

export function Logo({ className, size = 'md', inverted = false }: BrandProps) {
  return (
    <span className={cn('inline-flex items-center', sizes[size].gap, className)}>
      <BrandMark size={size} inverted={inverted} />
      <span className="flex flex-col leading-none">
        <BrandName size={size} inverted={inverted} />
        {size === 'lg' ? (
          <span className={cn('mt-1 text-xs font-medium whitespace-nowrap', inverted ? 'text-white/70' : 'text-slate-700 dark:text-slate-300')}>
            Smart Queuing
          </span>
        ) : null}
      </span>
    </span>
  )
}
