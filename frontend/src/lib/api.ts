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

export function userMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: string; details?: string }).message
    const details = (error as { details?: string }).details
    if (message) return message
    if (details) return details
  }
  return DEFAULT_USER_MESSAGE
}
