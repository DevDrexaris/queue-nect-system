import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from './button'
import { cn } from '../../lib/utils'

export function ActionMenu({
  label = 'Actions',
  children,
}: {
  label?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal className="size-4" />
        <span className="sr-only sm:not-sr-only">{label}</span>
      </Button>
      {open ? (
        <div
          role="menu"
          className={cn(
            'absolute right-0 z-20 mt-1 min-w-40 rounded-lg border border-border bg-card p-1 shadow-md',
          )}
        >
          <div onClick={() => setOpen(false)}>{children}</div>
        </div>
      ) : null}
    </div>
  )
}

export function ActionItem({
  children,
  onClick,
  destructive,
  disabled,
  icon,
}: {
  children: ReactNode
  onClick?: () => void
  destructive?: boolean
  disabled?: boolean
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center rounded-md px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50',
        destructive && 'text-destructive',
      )}
    >
      {icon ? <span className="mr-2 inline-flex items-center justify-center">{icon}</span> : null}
      {children}
    </button>
  )
}
