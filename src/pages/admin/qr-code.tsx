import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Download, Printer } from 'lucide-react'
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
  const [qr, setQr] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => {
    async function loadQr() {
      try {
        const nextToken = await queueService.ensureAccessToken(identifier)
        setToken(nextToken)
        const url = getQueueJoinUrl(identifier, nextToken)
        const result = await QRCode.toDataURL(url, {
          errorCorrectionLevel: 'H',
          margin: 2,
          width: 360,
          color: { dark: '#0B2A4A', light: '#ffffff' },
        })
        setQr(result)
      } catch {
        setQr('')
      }
    }

    void loadQr()
  }, [identifier])

  const preview = useMemo(() => getQueueJoinUrl(identifier, token), [identifier, token])

  function download() {
    if (!qr) return
    const link = document.createElement('a')
    link.href = qr
    link.download = `queue-nect-${identifier}.png`
    link.click()
    toast.success('QR code downloaded.')
  }

  return (
    <div>
      <PageHeader
        title="QR Code"
        description="Print this code so students can join the queue with their phone camera."
        actions={
          <>
            <Button variant="outline" onClick={download}>
              <Download className="size-4" />
              Download QR
            </Button>
            <Button onClick={() => window.print()}>
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
            {qr ? <img src={qr} alt={`QR code for ${preview}`} className="size-64 rounded-lg border border-border bg-white p-2" /> : null}
            <p className="mt-4 max-w-sm text-center text-sm text-muted-foreground">
              Students can scan this QR code using their phone's built-in camera or QR scanner to join the queue.
            </p>
            <code className="mt-4 block w-full break-all rounded-lg bg-muted px-3 py-2 text-xs">{preview}</code>
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
            <div className="mx-auto max-w-sm rounded-[2rem] border border-border bg-background p-5">
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
