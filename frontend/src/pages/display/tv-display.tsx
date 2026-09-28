import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { Logo } from '../../components/brand/logo'
import { QueueNumber } from '../../components/ui/queue-number'
import { useQueueSnapshot } from '../../hooks/use-queue-snapshot'
import { queueService } from '../../services/api'
import { cn } from '../../lib/utils'
import { QueueEventAnimation, type QueueEventKind } from '../../components/ui/queue-event-animation'
import { buildQueueAnnouncement, enqueueSpeechAnnouncement } from '../../lib/speech'
import { queueSessionLabel } from '../../lib/queue-session'

export function TvDisplayPage() {
  const { clinicId } = useParams()
  const [params] = useSearchParams()
  const identifier = clinicId || params.get('clinic') || ''
  const queueId = params.get('queue') || undefined
  const { data, error, loading } = useQueueSnapshot(identifier || undefined, 3000, queueId)
  const [now, setNow] = useState(() => new Date())
  const [qr, setQr] = useState('')
  const [queueEvent, setQueueEvent] = useState<{ kind: QueueEventKind; sequence: number } | null>(null)
  const lastActiveKey = useRef<string | null>(null)
  const eventSequence = useRef(0)
  const announcementInitialized = useRef(false)
  const lastAnnouncedCallKey = useRef<string | null>(null)

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
        const { link } = await queueService.issueAccessToken(identifier, queueId)
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
  }, [identifier, queueId])

  const serving = data?.entries.find((entry) => entry.status === 'SERVING') ?? null
  const calling = data?.entries.find((entry) => entry.status === 'CALLED') ?? null
  const awaitingReturn = data?.entries.find((entry) => entry.status === 'AWAITING_RETURN') ?? null
  const primary = calling ?? serving ?? awaitingReturn
  const next = [...(calling ? [calling] : []), ...(data?.entries.filter((entry) => entry.status === 'WAITING' || entry.status === 'AWAITING_RETURN') ?? [])].slice(0, 4)
  const active = Boolean(serving || calling || awaitingReturn || next.length)
  const isCalling = Boolean(calling)
  const availability = data?.clinic.availability ?? 'UNKNOWN'
  const primaryId = primary?.id
  const primaryQueueNumber = primary?.queueNumber
  const primaryStatus = primary?.status
  const announcementText = data?.clinic && primaryQueueNumber
    ? buildQueueAnnouncement({
        queueNumber: primaryQueueNumber,
        organizationName: data.clinic.name,
        serviceArea: data.clinic.serviceArea || data.clinic.announcementServiceArea || 'the service desk',
        useCustom: data.clinic.announcementUseCustom ?? false,
        template: data.clinic.announcementTemplate || 'Queue {queue_number}, please proceed to {service_area}.',
      })
    : 'Please listen for your queue number.'

  useEffect(() => {
    const key = primaryId && primaryQueueNumber && primaryStatus
      ? `${primaryId}:${primaryQueueNumber}:${primaryStatus}`
      : null
    const previousKey = lastActiveKey.current
    lastActiveKey.current = key

    if (!key || !previousKey || key === previousKey) return

    const kind = primaryStatus === 'CALLED' ? 'called' : primaryStatus === 'SERVING' ? 'served' : null
    if (!kind) return

    const event: { kind: QueueEventKind; sequence: number } = { kind, sequence: ++eventSequence.current }
    const showTimeout = window.setTimeout(() => setQueueEvent(event), 0)
    const clearTimeout = window.setTimeout(() => setQueueEvent(null), 900)
    return () => {
      window.clearTimeout(showTimeout)
      window.clearTimeout(clearTimeout)
    }
  }, [primaryId, primaryQueueNumber, primaryStatus])

  useEffect(() => {
    const clinic = data?.clinic
    if (!clinic || !data) return

    const callKey = calling?.calledAt && calling.id
      ? `${calling.id}:${calling.calledAt}`
      : null

    if (!announcementInitialized.current) {
      announcementInitialized.current = true
      lastAnnouncedCallKey.current = callKey
      return
    }
    if (!calling || !callKey || callKey === lastAnnouncedCallKey.current) return
    lastAnnouncedCallKey.current = callKey
    if (clinic.announcementsEnabled === false) return

    enqueueSpeechAnnouncement({
      text: buildQueueAnnouncement({
        queueNumber: calling.queueNumber,
        organizationName: clinic.name,
        serviceArea: clinic.serviceArea || clinic.announcementServiceArea || 'the service desk',
        useCustom: clinic.announcementUseCustom ?? false,
        template: clinic.announcementTemplate || 'Queue {queue_number}, please proceed to {service_area}.',
        speech: true,
      }),
      rate: clinic.announcementRate ?? 0.95,
      volume: clinic.announcementVolume ?? 1,
      voiceName: clinic.announcementVoice,
    })
  }, [calling?.calledAt, calling?.id, data, data?.clinic])

  return (
    <div className="flex min-h-dvh flex-col px-4 py-5 sm:px-8 sm:py-6 lg:px-14 lg:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div>
          <Logo inverted size="lg" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl lg:text-5xl">{data?.clinic.queueName || data?.clinic.name || identifier || 'Clinic Display'}</h1>
          {data?.clinic.locationName ? <p className="mt-2 text-sm text-muted-foreground">{data.clinic.locationName} · {data.clinic.name}</p> : null}
        </div>
        <div className="flex w-full items-center justify-end gap-3 sm:w-auto sm:flex-col sm:items-end">
          <div className="text-right">
          <p className="font-mono text-2xl tabular-nums lg:text-4xl">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-sm text-muted-foreground">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col justify-center py-8">
        {data && (availability !== 'OPEN' || data.clinic.sessionStatus !== 'ACTIVE') ? (
          <div className="mb-6 rounded-xl border border-border bg-card px-4 py-3 text-center text-sm text-muted-foreground" role="status">
            {data.clinic.sessionStatus === 'NOT_STARTED' || data.clinic.sessionStatus === 'ENDED'
              ? `${queueSessionLabel(data.clinic.sessionStatus)}. New registrations are unavailable.`
              : availability === 'PAUSED'
              ? 'New queue registrations are temporarily paused.'
              : availability === 'CLOSED'
                ? 'The clinic is currently closed to new queue registrations.'
                : 'Queue admission status is temporarily unavailable.'}
          </div>
        ) : null}
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
                  ? 'border-status-calling/45 bg-status-calling/10'
                  : '',
              )}
            >
              <div className={cn('mb-3 flex items-center justify-center gap-2 text-sm font-medium tracking-[0.25em] uppercase', isCalling ? 'text-status-calling' : 'text-status-serving')}>
                <span>{isCalling ? 'Calling' : primary?.status === 'AWAITING_RETURN' ? 'Awaiting return' : 'Now serving'}</span>
                {isCalling ? <span className="size-2.5 animate-pulse rounded-full bg-status-calling" /> : null}
              </div>
              <div className="mt-4 flex justify-center">
                <div className="relative inline-flex items-center justify-center">
                  {queueEvent ? <QueueEventAnimation key={queueEvent.sequence} kind={queueEvent.kind} /> : null}
                  <QueueNumber
                    value={primary?.queueNumber ?? '—'}
                    size="display"
                    className={cn(
                      'relative z-10 transition-[color,text-shadow] duration-300',
                      isCalling ? 'queue-number-calling' : 'text-status-serving',
                      queueEvent && 'queue-number-enter',
                    )}
                  />
                </div>
              </div>
              {serving && calling && serving.id !== calling.id ? (
                <div className="mt-6 rounded-2xl border border-border bg-surface p-4 text-left">
                  <p className="text-[10px] font-medium tracking-[0.2em] text-muted-foreground uppercase">Currently serving</p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <QueueNumber value={serving.queueNumber} size="sm" className="text-status-serving" />
                    <span className="text-sm text-foreground">{serving.studentName}</span>
                  </div>
                </div>
              ) : null}
            </section>

            <div className="space-y-6">
              <section className="rounded-3xl border border-border bg-card p-6 text-center">
                <p className="text-sm font-medium tracking-[0.25em] text-muted-foreground uppercase">{availability === 'OPEN' ? 'Scan to join' : 'Queue QR code'}</p>
                {qr ? (
                  <img src={qr} alt="Queue join QR code" className="mx-auto mt-5 size-44 rounded-2xl bg-white p-3 shadow-sm" />
                ) : (
                  <div className="mt-5 flex h-44 items-center justify-center rounded-2xl border border-dashed border-border bg-surface text-sm text-muted-foreground">
                    QR unavailable
                  </div>
                )}
                <p className="mt-4 text-sm text-muted-foreground">{availability === 'OPEN' ? 'Use your phone camera to join the queue.' : 'Admission is unavailable; existing queue entries remain active.'}</p>
              </section>

              <section>
                <p className="text-sm font-medium tracking-[0.25em] text-muted-foreground uppercase">Next</p>
                <ol className="mt-4 space-y-3">
                  {next.slice(0, 4).map((item) => (
                    <li
                      key={item.id}
                      className={cn(
                        'rounded-2xl px-5 py-4 transition-colors duration-300',
                        item.status === 'CALLED'
                          ? 'border border-status-calling/30 bg-status-calling/10'
                          : 'border border-border bg-surface',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <QueueNumber
                          value={item.queueNumber}
                          size="next"
                          className={item.status === 'CALLED' ? 'queue-number-calling' : 'text-foreground'}
                        />
                        {item.status === 'CALLED' ? <span className="text-xs tracking-[0.2em] uppercase text-status-calling">Calling</span> : null}
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
            <p className="text-sm font-medium tracking-[0.2em] text-muted-foreground uppercase">{availability === 'PAUSED' ? 'Queue paused' : availability === 'CLOSED' ? 'Queue closed' : 'No active queue'}</p>
            <p className="mt-4 max-w-xl text-2xl text-foreground">{availability === 'PAUSED' ? 'New registrations are temporarily paused.' : availability === 'CLOSED' ? 'The clinic is not accepting new queue entries right now.' : availability === 'OPEN' ? 'Please scan the QR code to join the queue.' : 'Queue availability could not be verified.'}</p>
            {qr ? <img src={qr} alt="Queue join QR code" className="mt-8 size-52 rounded-xl bg-white p-3" /> : null}
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <p>{announcementText}</p>
  
      </footer>
    </div>
  )
}
