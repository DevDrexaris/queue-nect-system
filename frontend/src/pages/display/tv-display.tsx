import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { Logo } from '../../components/brand/logo'
import { QueueNumber } from '../../components/ui/queue-number'
import { useQueueSnapshot } from '../../hooks/use-queue-snapshot'
import { queueService } from '../../services/api'
import { cn } from '../../lib/utils'

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
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
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
    <div className="flex min-h-dvh flex-col overflow-hidden px-8 py-6 lg:px-14 lg:py-8 [&::-webkit-scrollbar]:hidden">
      <header className="flex items-start justify-between gap-6">
        <div>
          <Logo inverted size="lg" />
          <h1 className="mt-4 text-3xl font-semibold tracking-tight lg:text-5xl">{data?.clinic.name || identifier || 'Clinic Display'}</h1>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl tabular-nums lg:text-4xl">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-sm text-white/60">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
      </header>

      <main className="flex flex-1 flex-col justify-center py-8">
        {!identifier ? (
          <p className="text-center text-2xl text-white/70">Open /display/CLINIC_IDENTIFIER to start the waiting room screen.</p>
        ) : loading ? (
          <p className="text-center text-xl text-white/70">Loading queue...</p>
        ) : error ? (
          <p className="text-center text-xl text-white/70">Unable to load queue. Retrying...</p>
        ) : active ? (
          <div className="grid gap-10 xl:grid-cols-[1.4fr_0.6fr] xl:items-center">
            <section
              className={cn(
                'rounded-3xl border p-8 text-center transition-all duration-300',
                isCalling
                  ? 'border-amber-300/70 bg-amber-400/10 shadow-[0_0_35px_rgba(251,191,36,0.35)]'
                  : 'border-white/10 bg-white/5',
                flash && 'scale-[1.02] border-amber-200/80 bg-amber-300/10',
              )}
            >
              <div className="mb-3 flex items-center justify-center gap-2 text-sm font-medium tracking-[0.25em] uppercase text-sky-300">
                <span className={cn(isCalling ? 'text-amber-200' : 'text-sky-300')}>{isCalling ? 'Calling' : 'Now serving'}</span>
                {isCalling ? <span className="h-2.5 w-2.5 rounded-full bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.8)]" /> : null}
              </div>
              <div className="mt-4">
                <QueueNumber value={calling?.queueNumber ?? serving?.queueNumber ?? '—'} size="display" className={cn('text-white', isCalling && 'text-amber-100')} />
              </div>
              {serving && calling && serving.id !== calling.id ? (
                <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-left">
                  <p className="text-[10px] font-medium tracking-[0.2em] text-white/60 uppercase">Currently serving</p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <QueueNumber value={serving.queueNumber} size="sm" className="text-white" />
                    <span className="text-sm text-white/70">{serving.studentName}</span>
                  </div>
                </div>
              ) : null}
            </section>

            <div className="space-y-6">
              <section className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center">
                <p className="text-sm font-medium tracking-[0.25em] text-white/50 uppercase">Scan to join</p>
                {qr ? (
                  <img src={qr} alt="Queue join QR code" className="mx-auto mt-5 size-44 rounded-2xl bg-white p-3 shadow-[0_0_18px_rgba(255,255,255,0.18)]" />
                ) : (
                  <div className="mt-5 flex h-44 items-center justify-center rounded-2xl border border-dashed border-white/15 bg-slate-950/20 text-sm text-white/60">
                    QR unavailable
                  </div>
                )}
                <p className="mt-4 text-sm text-white/70">Use your phone camera to join the queue.</p>
              </section>

              <section>
                <p className="text-sm font-medium tracking-[0.25em] text-white/50 uppercase">Next</p>
                <ol className="mt-4 space-y-3">
                  {next.slice(0, 4).map((item) => (
                    <li
                      key={item.id}
                      className={cn(
                        'rounded-2xl px-5 py-4 font-mono text-3xl font-semibold tabular-nums lg:text-5xl transition-all',
                        item.status === 'CALLED'
                          ? 'border border-amber-300/70 bg-amber-400/15 text-amber-100 shadow-[0_0_20px_rgba(252,211,77,0.25)]'
                          : 'bg-white/5 text-white',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span>{item.queueNumber}</span>
                        {item.status === 'CALLED' ? <span className="text-xs tracking-[0.2em] uppercase text-amber-200">Calling</span> : null}
                      </span>
                    </li>
                  ))}
                  {next.length === 0 ? <li className="text-white/50">No one waiting</li> : null}
                </ol>
              </section>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <p className="text-sm font-medium tracking-[0.2em] text-white/50 uppercase">No active queue</p>
            <p className="mt-4 max-w-xl text-2xl text-white/80">Please scan the QR code to join the queue.</p>
            {qr ? <img src={qr} alt="Queue join QR code" className="mt-8 size-52 rounded-xl bg-white p-3" /> : null}
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between gap-4 text-sm text-white/55">
        <p>{data?.clinic.announcement || 'Please listen for your queue number.'}</p>
  
      </footer>
    </div>
  )
}
