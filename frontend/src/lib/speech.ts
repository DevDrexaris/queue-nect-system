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
}: {
  queueNumber: string
  organizationName: string
  serviceArea: string
  useCustom: boolean
  template: string
}) {
  if (!useCustom) {
    return `Queue number ${queueNumberForSpeech(queueNumber)}, please proceed to ${serviceArea}.`
  }
  return template
    .replaceAll('{queue_number}', queueNumberForSpeech(queueNumber))
    .replaceAll('{organization_name}', organizationName)
    .replaceAll('{service_area}', serviceArea)
}
