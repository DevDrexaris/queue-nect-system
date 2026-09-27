import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { Logo } from '../../components/brand/logo'
import { QueueNumber } from '../../components/ui/queue-number'
import { useQueueSnapshot } from '../../hooks/use-queue-snapshot'
import { queueService } from '../../services/api'
import { cn } from '../../lib/utils'

const VOICE_KEY = 'qn.display.voice'

export function TvDisplayPage() {
  const { clinicId } = useParams()
  const [params] = useSearchParams()
  const identifier = clinicId || params.get('clinic') || ''
  const { data, error, loading } = useQueueSnapshot(identifier || undefined, 3000)
  const [now, setNow] = useState(() => new Date())
  const [voice, setVoice] = useState(() => localStorage.getItem(VOICE_KEY) === 'on')
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

  const serving = data?.nowServing
  const next = data?.upNext ?? []
  const active = Boolean(serving || next.length)

  useEffect(() => {
    if (!serving?.queueNumber) return
    if (lastCalled.current && lastCalled.current !== serving.queueNumber) {
      setFlash(true)
      const timeout = window.setTimeout(() => setFlash(false), 1200)
      if (voice && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(
          `Queue number ${serving.queueNumber.split('').join(' ')}, please proceed to the clinic.`,
        )
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(utterance)
      }
      lastCalled.current = serving.queueNumber
      return () => window.clearTimeout(timeout)
    }
    lastCalled.current = serving.queueNumber
  }, [serving?.queueNumber, voice])

  return (
    <div className="flex min-h-dvh flex-col px-8 py-6 lg:px-14 lg:py-8">
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
          <label className="mt-3 inline-flex items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={voice}
              onChange={(event) => {
                const nextValue = event.target.checked
                setVoice(nextValue)
                localStorage.setItem(VOICE_KEY, nextValue ? 'on' : 'off')
              }}
            />
            Voice announcement
          </label>
        </div>
      </header>

      <main className="flex flex-1 flex-col justify-center py-8">
        {!identifier ? (
          <p className="text-center text-2xl text-white/70">Open /display/CLINIC_IDENTIFIER to start the waiting room screen.</p>
        ) : loading ? (
          <p className="text-center text-xl text-white/70">Loading queue...</p>
        ) : error ? (
          <p className="text-center text-xl text-white/70">Unable to load queue. Retrying...</p>
        ) : !active ? (
          <div className="flex flex-col items-center text-center">
            <p className="text-sm font-medium tracking-[0.2em] text-white/50 uppercase">No active queue</p>
            <p className="mt-4 max-w-xl text-2xl text-white/80">Please scan the QR code to join the queue.</p>
            {qr ? <img src={qr} alt="Queue join QR code" className="mt-8 size-52 rounded-xl bg-white p-3" /> : null}
          </div>
        ) : (
          <div className="grid gap-10 xl:grid-cols-[1.4fr_0.6fr] xl:items-center">
            <section className={cn('rounded-3xl bg-white/5 p-8 text-center transition-transform duration-300', flash && 'scale-[1.02] bg-white/10')}>
              <p className="text-sm font-medium tracking-[0.25em] text-sky-300 uppercase">Now serving</p>
              <div className="mt-4">
                <QueueNumber value={serving?.queueNumber || '—'} size="display" className="text-white" />
              </div>
            </section>
            <section>
              <p className="text-sm font-medium tracking-[0.25em] text-white/50 uppercase">Next</p>
              <ol className="mt-4 space-y-3">
                {next.slice(0, 3).map((item) => (
                  <li key={item.id} className="rounded-2xl bg-white/5 px-5 py-4 font-mono text-3xl font-semibold tabular-nums lg:text-5xl">
                    {item.queueNumber}
                  </li>
                ))}
                {next.length === 0 ? <li className="text-white/50">No one waiting</li> : null}
              </ol>
            </section>
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between gap-4 text-sm text-white/55">
        <p>{data?.clinic.announcement || 'Please listen for your queue number.'}</p>
        <p>QUEUE-NECT</p>
      </footer>
    </div>
  )
}
