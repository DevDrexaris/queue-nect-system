import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Copy, Download, Printer, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { PageHeader } from '../../components/ui/page-header'
import { useAuth } from '../../hooks/use-auth'
import { getQueueJoinUrl, isPlaceholderPublicUrl } from '../../lib/env'
import { queueService } from '../../services/api'

export function AdminQrCodePage() {
  const { user } = useAuth()
  const clinicName = user?.clinic?.name || 'Clinic'
  const identifier = user?.clinic?.identifier || 'clinic'
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)

  async function loadQr() {
    try {
      setLoading(true)
      const nextToken = await queueService.ensureAccessToken(identifier)
      setToken(nextToken)
    } catch {
      setToken('')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadQr()
  }, [identifier])

  const preview = useMemo(() => getQueueJoinUrl(identifier, token), [identifier, token])
  const displayUrl = useMemo(() => `/tv/${encodeURIComponent(identifier)}`, [identifier])

  function openTvDisplay() {
    window.open(displayUrl, '_blank', 'noopener,noreferrer')
  }

  async function regenerate() {
    try {
      setRegenerating(true)
      const nextToken = await queueService.regenerateAccessToken(identifier)
      setToken(nextToken)
      toast.success('QR code regenerated successfully.')
    } catch {
      toast.error('Unable to complete that action. Please try again.')
    } finally {
      setRegenerating(false)
    }
  }

  async function copyLink() {
    if (!preview) return

    try {
      await navigator.clipboard.writeText(preview)
      toast.success('Queue link copied.')
    } catch {
      toast.error('Unable to complete that action. Please try again.')
    }
  }

  function download() {
    if (!preview) return

    const canvas = document.getElementById('queue-qr-canvas') as HTMLCanvasElement | null
    if (!canvas) return

    const link = document.createElement('a')
    link.href = canvas.toDataURL('image/png')
    link.download = `queue-nect-${identifier}.png`
    link.click()
    toast.success('QR code downloaded.')
  }

  return (
    <div>
      <PageHeader
        title="QR Code"
        description="This organization has its own secure queue link and QR code."
        actions={
          <>
            <Button variant="outline" onClick={copyLink} disabled={!preview}>
              <Copy className="size-4" />
              Copy Link
            </Button>
            <Button variant="outline" onClick={download} disabled={!preview}>
              <Download className="size-4" />
              Download QR
            </Button>
            <Button variant="secondary" onClick={openTvDisplay}>
              Open TV Display
            </Button>
            <Button onClick={() => void regenerate()} loading={regenerating}>
              <RefreshCw className="size-4" />
              Regenerate QR
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="size-4" />
              Print QR
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{clinicName}</CardTitle>
            <CardDescription>Official Queue-Nect QR Code</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {loading ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Loading QR code...</div>
            ) : preview ? (
              <div className="rounded-xl border border-border bg-white p-4">
                <QRCodeSVG
                  id="queue-qr-canvas"
                  value={preview}
                  size={250}
                  bgColor="#ffffff"
                  fgColor="#0B2A4A"
                  level="H"
                  includeMargin
                />
              </div>
            ) : null}
            <p className="mt-4 max-w-sm text-center text-sm text-muted-foreground">
              Students can scan this QR code to open the queue access link for this organization.
            </p>
            <code className="mt-4 block w-full break-all rounded-lg bg-muted px-3 py-2 text-xs">{preview || 'Queue link unavailable'}</code>
            {isPlaceholderPublicUrl() ? (
              <p className="mt-3 text-sm text-amber-700">
                Set VITE_PUBLIC_URL to your HTTPS domain before printing for production.
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Student preview</CardTitle>
            <CardDescription>This is what students see after scanning.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mx-auto max-w-sm rounded-4xl border border-border bg-background p-5">
              <p className="text-xs font-medium text-muted-foreground">Welcome to</p>
              <p className="text-2xl font-semibold">{clinicName}</p>
              <p className="text-sm text-muted-foreground">Digital Queue</p>
              <div className="mt-5 rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground uppercase">Currently serving</p>
                <p className="mt-1 font-mono text-2xl font-semibold">—</p>
              </div>
              <div className="mt-4 flex h-11 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground">
                JOIN QUEUE
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
