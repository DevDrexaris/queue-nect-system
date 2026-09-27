const PLACEHOLDER_PUBLIC_URL = 'http://localhost:5173'

function stripSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export function getPublicUrl() {
  const configured = (import.meta.env.VITE_PUBLIC_URL ?? '').trim()
  const candidate = configured ? stripSlash(configured) : ''

  if (candidate && (candidate.startsWith('http://') || candidate.startsWith('https://'))) {
    return candidate
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return stripSlash(window.location.origin)
  }

  return PLACEHOLDER_PUBLIC_URL
}

export function isPlaceholderPublicUrl() {
  return getPublicUrl() === PLACEHOLDER_PUBLIC_URL
}

export function validateSupabaseRuntimeEnv() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

  const diagnostics = {
    urlExists: Boolean(url),
    keyExists: Boolean(key),
    keyLength: key?.length ?? 0,
    keyPrefix: key?.substring(0, 14) ?? 'missing',
    url: url ?? 'missing',
  }

  console.info('[Queue-Nect] Supabase runtime config:', diagnostics)

  if (!url || !key) {
    throw new Error(
      'Queue-Nect Supabase config is incomplete. VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.'
    )
  }

  return { url, key }
}

export function getSupabaseUrl() {
  const url = import.meta.env.VITE_SUPABASE_URL

  if (!url) {
    throw new Error('VITE_SUPABASE_URL is missing')
  }

  return url
}

export function getSupabasePublishableKey() {
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

  if (!key) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is missing')
  }

  return key
}

export function getApiUrl() {
  // Legacy PHP backend is intentionally disabled.
  // Queue-Nect uses Supabase directly.
  return ''
}

export function getQueueJoinUrl(
  clinicIdentifier: string,
  token?: string
) {
  const route = token
    ? `/q/${encodeURIComponent(token)}`
    : `/queue/${encodeURIComponent(clinicIdentifier)}`

  return `${getPublicUrl()}${route}`
}

export { PLACEHOLDER_PUBLIC_URL }