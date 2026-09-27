const spokenDigit: Record<string, string> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
}

type QueuedAnnouncement = {
  text: string
  rate: number
  volume: number
  voiceName?: string
}

const announcementQueue: QueuedAnnouncement[] = []
let processingAnnouncement = false
let retryTimer: number | undefined

export function queueNumberForSpeech(value: string) {
  return Array.from(value.toUpperCase())
    .map((character) => spokenDigit[character] ?? character)
    .join(' ')
}

export function enqueueSpeechAnnouncement(announcement: QueuedAnnouncement) {
  if (!announcement.text.trim() || !('speechSynthesis' in window)) return
  announcementQueue.push(announcement)
  processSpeechQueue()
}

function processSpeechQueue() {
  if (processingAnnouncement || !announcementQueue.length || !('speechSynthesis' in window)) return
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.clearTimeout(retryTimer)
    retryTimer = window.setTimeout(processSpeechQueue, 120)
    return
  }

  const next = announcementQueue.shift()
  if (!next) return
  processingAnnouncement = true

  try {
    const utterance = new SpeechSynthesisUtterance(next.text)
    utterance.rate = next.rate
    utterance.volume = next.volume
    utterance.voice = window.speechSynthesis.getVoices().find((voice) => voice.name === next.voiceName) ?? null
    const finish = () => {
      processingAnnouncement = false
      processSpeechQueue()
    }
    utterance.onend = finish
    utterance.onerror = (event) => {
      console.error('[Queue-Nect] Speech announcement failed:', event.error)
      finish()
    }
    window.speechSynthesis.speak(utterance)
  } catch (caught) {
    processingAnnouncement = false
    console.error('[Queue-Nect] Speech announcement setup failed:', caught)
    processSpeechQueue()
  }
}

export function buildQueueAnnouncement({
  queueNumber,
  organizationName,
  serviceArea,
  useCustom,
  template,
  speech = false,
}: {
  queueNumber: string
  organizationName: string
  serviceArea: string
  useCustom: boolean
  template: string
  speech?: boolean
}) {
  const resolvedQueue = queueNumber?.trim() || ''
  const resolvedServiceArea = serviceArea?.trim() || 'the service desk'
  const resolvedOrganization = organizationName?.trim() || 'the clinic'
  const spokenQueue = resolvedQueue ? queueNumberForSpeech(resolvedQueue) : ''
  const displayQueue = resolvedQueue || 'Queue'

  const templateText = useCustom && template?.trim()
    ? template.trim()
    : 'Queue {queue_number}, please proceed to {service_area}.'

  const rendered = templateText
    .replaceAll('{queue_number}', speech ? spokenQueue : displayQueue)
    .replaceAll('{organization_name}', resolvedOrganization)
    .replaceAll('{service_area}', resolvedServiceArea)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .replace(/\s+,/g, ',')
    .replace(/\s+$/g, '')

  if (!resolvedQueue) return ''
  return rendered
}
