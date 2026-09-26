import { Link } from 'react-router-dom'
import { QrCode, ShieldAlert } from 'lucide-react'
import { buttonVariants } from '../../components/ui/button'
import { cn } from '../../lib/utils'

export function QueueAccessRequiredPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-4 py-8">
      <div className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <ShieldAlert className="size-6" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Queue Access Required</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Please scan the official QR code provided by the clinic or school to join the queue.
        </p>
        <div className="mt-6 rounded-xl border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
          <div className="flex items-center justify-center gap-2 font-medium text-foreground">
            <QrCode className="size-4" />
            Use your phone camera to scan the QR code
          </div>
          <p className="mt-2">No app installation is required.</p>
        </div>
        <Link to="/" className={cn(buttonVariants({ size: 'lg' }), 'mt-6 w-full')}>
          Scan QR Code
        </Link>
      </div>
    </div>
  )
}
