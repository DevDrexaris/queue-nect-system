import { cn } from '../../lib/utils'

export type QueueEventKind = 'called' | 'served'

export function QueueEventAnimation({
  kind,
  className,
}: {
  kind: QueueEventKind
  className?: string
}) {
  const calling = kind === 'called'

  return (
    <span
      aria-hidden="true"
      data-event-kind={kind}
      className={cn(
        'pointer-events-none absolute inset-[-0.12em] z-0 flex items-center justify-center',
        calling ? 'text-status-calling' : 'text-status-serving',
        className,
      )}
    >
      <svg viewBox="0 0 240 120" className="h-full w-full overflow-visible" fill="none">
        <circle cx="120" cy="60" r="24" stroke="currentColor" strokeWidth="1.5" opacity="0.55" className="queue-event-ring" />
        <circle cx="120" cy="60" r="40" stroke="currentColor" strokeWidth="1" opacity="0.35" className="queue-event-ring queue-event-ring-delayed" />
        {calling ? (
          <path d="M120 9v10m0 82v10M69 60H59m122 0h-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.65" />
        ) : (
          <path d="m106 61 10 10 20-23" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="queue-event-mark" />
        )}
      </svg>
    </span>
  )
}