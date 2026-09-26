import { getApiUrl } from './env'

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

async function parseError(response: Response) {
  const fallback = response.status === 401 ? 'Invalid credentials. Please try again.' : 'Something went wrong. Please try again.'
  try {
    const data = (await response.json()) as { message?: string; error?: string }
    const message = data.message || data.error
    if (message && !/sqlstate|stack|pdo|mysql|exception/i.test(message)) return message
  } catch {
    /* ignore non-json */
  }
  return fallback
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 12000, headers, ...init } = options
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${getApiUrl()}${path}`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      signal: controller.signal,
      ...init,
    })

    if (!response.ok) {
      throw new ApiError(await parseError(response), response.status)
    }

    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The request took too long. Please try again.', 408)
    }
    throw new ApiError('Unable to reach the server. Check your connection and try again.', 0)
  } finally {
    window.clearTimeout(timer)
  }
}

export function userMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  return 'Unable to complete that action. Please try again.'
}
