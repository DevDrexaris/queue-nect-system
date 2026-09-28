import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { QrCode, ShieldAlert } from 'lucide-react'
import { buttonVariants } from '../../components/ui/button'
import { ThemeSelector } from '../../components/ui/theme-selector'
import { queueService } from '../../services/api'
import { cn } from '../../lib/utils'
import { userMessage } from '../../lib/api'

export function QueueAccessRequiredPage() {
  const { clinicId = '' } = useParams()
  const [link, setLink] = useState('')
  const [loading, setLoading] = useState(Boolean(clinicId))
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!clinicId) {
      setLoading(false)
      return
    }

    async function loadAccessToken() {
      try {
        setErrorMessage('')
        const details = await queueService.issueAccessToken(clinicId)
        setLink(details.link)
      } catch (error) {
        setLink('')
        setErrorMessage(userMessage(error, 'student'))
      } finally {
        setLoading(false)
      }
    }

    void loadAccessToken()
  }, [clinicId])

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 py-8">
      <div className="flex w-full justify-end">
        <ThemeSelector />
      </div>
      <div className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-warning/10 text-warning">
          <ShieldAlert className="size-6" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Queue Access Required</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Please scan the official QR code provided by the clinic or school to join the queue.
        </p>

        <div className="mt-6 rounded-xl border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
          {loading ? (
            <div className="flex min-h-45 items-center justify-center text-sm text-muted-foreground">
              Generating queue access QR...
            </div>
          ) : link ? (
            <div className="flex flex-col items-center">
              <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
                <QRCodeSVG value={link} size={180} bgColor="#ffffff" fgColor="#0B2A4A" level="H" includeMargin />
              </div>
              <div className="mt-4 flex items-center justify-center gap-2 font-medium text-foreground">
                <QrCode className="size-4" />
                Use your phone camera to scan the QR code
              </div>
              <p className="mt-2">No app installation is required.</p>
            </div>
          ) : (
            <div className="flex min-h-45 items-center justify-center px-2 text-center text-sm text-destructive">
              {errorMessage || 'QR code is unavailable right now. Please try again.'}
            </div>
          )}
        </div>

        <Link to="/" className={cn(buttonVariants({ size: 'lg' }), 'mt-6 w-full')}>
          {link ? 'Scan QR Code' : 'Back to home'}
        </Link>
      </div>
    </div>
  )
}
