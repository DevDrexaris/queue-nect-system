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

export function queueNumberForSpeech(value: string) {
  return Array.from(value.toUpperCase())
    .map((character) => spokenDigit[character] ?? character)
    .join(' ')
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
