import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-muted text-foreground',
        outline: 'border-border text-muted-foreground',
        success: 'border-transparent bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
        warning: 'border-transparent bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
        danger: 'border-transparent bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200',
        info: 'border-transparent bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
