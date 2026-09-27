import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { Logo } from '../../components/brand/logo'
import { QueueNumber } from '../../components/ui/queue-number'
import { useQueueSnapshot } from '../../hooks/use-queue-snapshot'
import { queueService } from '../../services/api'
import { cn } from '../../lib/utils'
import { ThemeSelector } from '../../components/ui/theme-selector'

export function TvDisplayPage() {
  const { clinicId } = useParams()
  const [params] = useSearchParams()
  const identifier = clinicId || params.get('clinic') || ''
  const { data, error, loading } = useQueueSnapshot(identifier || undefined, 3000)
  const [now, setNow] = useState(() => new Date())
  const [qr, setQr] = useState('')
  const [flash, setFlash] = useState(false)
  const lastCalled = useRef<string | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1280px)')
    const updateOverflow = () => {
      document.body.style.overflow = media.matches ? 'hidden' : ''
      document.documentElement.style.overflow = media.matches ? 'hidden' : ''
    }
    const previousOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow
    updateOverflow()
    media.addEventListener('change', updateOverflow)

    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => {
      window.clearInterval(id)
      media.removeEventListener('change', updateOverflow)
      document.body.style.overflow = previousOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
    }
  }, [])

  useEffect(() => {
    if (!identifier) return

    async function generateQr() {
      try {
        const { link } = await queueService.issueAccessToken(identifier)
        const dataUrl = await QRCode.toDataURL(link, {
          errorCorrectionLevel: 'H',
          margin: 1,
          width: 220,
          color: { dark: '#0B2A4A', light: '#ffffff' },
        })
        setQr(dataUrl)
      } catch {
        setQr('')
      }
    }

    void generateQr()
  }, [identifier])

  const serving = data?.entries.find((entry) => entry.status === 'SERVING') ?? null
  const calling = data?.entries.find((entry) => entry.status === 'CALLED') ?? null
  const next = [...(calling ? [calling] : []), ...(data?.entries.filter((entry) => entry.status === 'WAITING') ?? [])].slice(0, 4)
  const active = Boolean(serving || calling || next.length)
  const isCalling = Boolean(calling)

  useEffect(() => {
    const currentCallNumber = calling?.queueNumber ?? serving?.queueNumber
    if (!currentCallNumber) return
    if (lastCalled.current && lastCalled.current !== currentCallNumber) {
      setFlash(true)
      const timeout = window.setTimeout(() => setFlash(false), 1200)
      lastCalled.current = currentCallNumber
      return () => window.clearTimeout(timeout)
    }
    lastCalled.current = currentCallNumber
  }, [calling?.queueNumber, serving?.queueNumber])

  return (
    <div className="flex min-h-dvh flex-col px-4 py-5 sm:px-8 sm:py-6 lg:px-14 lg:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div>
          <Logo inverted size="lg" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl lg:text-5xl">{data?.clinic.name || identifier || 'Clinic Display'}</h1>
        </div>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:flex-col sm:items-end">
          <ThemeSelector />
          <div className="text-right">
          <p className="font-mono text-2xl tabular-nums lg:text-4xl">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-sm text-muted-foreground">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col justify-center py-8">
        {!identifier ? (
          <p className="text-center text-2xl text-muted-foreground">Open /display/CLINIC_IDENTIFIER to start the waiting room screen.</p>
        ) : loading ? (
          <p className="text-center text-xl text-muted-foreground">Loading queue...</p>
        ) : error ? (
          <p className="text-center text-xl text-muted-foreground">Unable to load queue. Retrying...</p>
        ) : active ? (
          <div className="grid gap-10 xl:grid-cols-[1.4fr_0.6fr] xl:items-center">
            <section
              className={cn(
                'rounded-3xl border border-border bg-card p-8 text-center transition-colors duration-300',
                isCalling
                  ? 'border-status-called/40 bg-status-called/10'
                  : '',
                flash && 'border-status-called/50 bg-status-called/15',
              )}
            >
              <div className={cn('mb-3 flex items-center justify-center gap-2 text-sm font-medium tracking-[0.25em] uppercase', isCalling ? 'text-status-called' : 'text-status-serving')}>
                <span>{isCalling ? 'Calling' : 'Now serving'}</span>
                {isCalling ? <span className="size-2.5 animate-pulse rounded-full bg-status-called" /> : null}
              </div>
              <div className="mt-4">
                <QueueNumber value={calling?.queueNumber ?? serving?.queueNumber ?? '—'} size="display" className={isCalling ? 'text-status-called' : 'text-status-serving'} />
              </div>
              {serving && calling && serving.id !== calling.id ? (
                <div className="mt-6 rounded-2xl border border-border bg-surface p-4 text-left">
                  <p className="text-[10px] font-medium tracking-[0.2em] text-muted-foreground uppercase">Currently serving</p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <QueueNumber value={serving.queueNumber} size="sm" className="text-foreground" />
                    <span className="text-sm text-foreground">{serving.studentName}</span>
                  </div>
                </div>
              ) : null}
            </section>

            <div className="space-y-6">
              <section className="rounded-3xl border border-border bg-card p-6 text-center">
                <p className="text-sm font-medium tracking-[0.25em] text-muted-foreground uppercase">Scan to join</p>
                {qr ? (
                  <img src={qr} alt="Queue join QR code" className="mx-auto mt-5 size-44 rounded-2xl bg-white p-3 shadow-sm" />
                ) : (
                  <div className="mt-5 flex h-44 items-center justify-center rounded-2xl border border-dashed border-border bg-surface text-sm text-muted-foreground">
                    QR unavailable
                  </div>
                )}
                <p className="mt-4 text-sm text-muted-foreground">Use your phone camera to join the queue.</p>
              </section>

              <section>
                <p className="text-sm font-medium tracking-[0.25em] text-muted-foreground uppercase">Next</p>
                <ol className="mt-4 space-y-3">
                  {next.slice(0, 4).map((item) => (
                    <li
                      key={item.id}
                      className={cn(
                        'rounded-2xl px-5 py-4 font-mono text-3xl font-semibold tabular-nums lg:text-5xl transition-all',
                        item.status === 'CALLED'
                          ? 'border border-status-called/25 bg-status-called/10 text-status-called'
                          : 'border border-border bg-surface text-foreground',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span>{item.queueNumber}</span>
                        {item.status === 'CALLED' ? <span className="text-xs tracking-[0.2em] uppercase text-status-called">Calling</span> : null}
                      </span>
                    </li>
                  ))}
                  {next.length === 0 ? <li className="text-muted-foreground">No one waiting</li> : null}
                </ol>
              </section>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <p className="text-sm font-medium tracking-[0.2em] text-muted-foreground uppercase">No active queue</p>
            <p className="mt-4 max-w-xl text-2xl text-foreground">Please scan the QR code to join the queue.</p>
            {qr ? <img src={qr} alt="Queue join QR code" className="mt-8 size-52 rounded-xl bg-white p-3" /> : null}
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <p>{data?.clinic.announcement || 'Please listen for your queue number.'}</p>
  
      </footer>
    </div>
  )
}
