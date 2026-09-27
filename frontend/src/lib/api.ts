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
  throw new ApiError(DEFAULT_USER_MESSAGE, 410)
}

export function userMessage(_error: unknown) {
  return DEFAULT_USER_MESSAGE
}
