import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { useOnlineStatus } from '../../hooks/use-online-status'

export function ConnectionBanner({ compact = false }: { compact?: boolean }) {
  const online = useOnlineStatus()
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    if (!online) setWasOffline(true)
  }, [online])

  if (online && compact) return null
  if (online && !wasOffline) return null

  if (!online) {
    return (
      <div
        role="status"
        className={
          compact
            ? 'flex items-center gap-2 text-xs text-amber-700'
            : 'flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
        }
      >
        <WifiOff className="size-4" />
        Connection lost. Trying to reconnect...
      </div>
    )
  }

  return compact ? null : (
    <div role="status" className="bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-800">
      Connection restored. Refreshing...
    </div>
  )
}
