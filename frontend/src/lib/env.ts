const PLACEHOLDER_PUBLIC_URL = 'http://localhost:5173'

function stripSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export function getPublicUrl() {
  const configured = stripSlash(
    import.meta.env.VITE_PUBLIC_URL || PLACEHOLDER_PUBLIC_URL
  )

  if (!configured.startsWith('http://') && !configured.startsWith('https://')) {
    return PLACEHOLDER_PUBLIC_URL
  }

  return configured
}

export function isPlaceholderPublicUrl() {
  return getPublicUrl() === PLACEHOLDER_PUBLIC_URL
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