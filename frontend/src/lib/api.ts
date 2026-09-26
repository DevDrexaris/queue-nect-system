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
  throw new ApiError('This app no longer uses the legacy PHP backend. Use the Supabase services layer instead.', 410)
}


export function userMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  return 'Unable to complete that action. Please try again.'
}
