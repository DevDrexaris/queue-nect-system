export const DEFAULT_USER_MESSAGE = 'Unable to complete that action. Please try again.'

export class ApiError extends Error {
  status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type RequestOptions = RequestInit & {
  timeoutMs?: number
}

export async function apiRequest<T>(_path: string, _options: RequestOptions = {}): Promise<T> {
  throw new ApiError('The queue service is unavailable right now. Please try again later.', 503)
}

export function userMessage(error: unknown, audience: 'student' | 'staff' | 'general' = 'general') {
  console.error('[Queue-Nect] Request failed:', error)

  const source = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : ''
  const normalized = source.toLowerCase()

  if (normalized.includes('already have an active queue')) return 'You already have an active queue for this session.'
  if (normalized.includes('queue is not open')) return 'This queue is not accepting entries yet. Please ask staff for help.'
  if (normalized.includes('queue_paused')) return 'Queue Temporarily Paused. New queue entries are unavailable right now.'
  if (normalized.includes('queue_closed')) return 'Queue Currently Closed. Please ask staff for assistance.'
  if (normalized.includes('no active queue session')) return 'There is no active queue session today. Please contact your organization administrator.'
  if (normalized.includes('not authorized to manage this queue')) return 'You are not authorized to change queue availability.'
  if (normalized.includes('invalid or expired') || normalized.includes('no longer active')) return 'This queue link is no longer active. Please scan the current QR code.'
  if (normalized.includes('no waiting queue')) return 'There are no students waiting to be called.'
  if (normalized.includes('no called number')) return 'There is no called queue ready to start service.'
  if (normalized.includes('another number is already being served')) return 'Finish the current service before starting another.'
  if (normalized.includes('finish the active call')) return 'Finish the current call before calling another queue.'
  if (normalized.includes('can no longer be cancelled') || normalized.includes('action is not allowed')) return 'That action is no longer available for this queue.'
  if (normalized.includes('queue access is invalid')) return 'This queue link is no longer active. Please scan the current QR code.'

  if (audience === 'student') return 'Queue information is temporarily unavailable. Please try again.'
  if (audience === 'staff') return 'Unable to complete that action right now. Please try again.'
  return DEFAULT_USER_MESSAGE
}
