const PLACEHOLDER_PUBLIC_URL = 'http://localhost:5173'

function stripSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export function getPublicUrl() {
  const configured = stripSlash(import.meta.env.VITE_PUBLIC_URL || PLACEHOLDER_PUBLIC_URL)
  if (!configured.startsWith('http://') && !configured.startsWith('https://')) return PLACEHOLDER_PUBLIC_URL
  return configured
}

export function isPlaceholderPublicUrl() {
  return getPublicUrl() === PLACEHOLDER_PUBLIC_URL
}

export function getSupabaseUrl() {
  return String(import.meta.env.VITE_SUPABASE_URL || 'https://hckvwvrhmmwqxlbthafe.supabase.co')
}

export function getSupabasePublishableKey() {
  return String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_adOK0DUSXAvI8ySHC8Znfw_X71_KJP_')
}

export function getApiUrl() {
  return stripSlash(import.meta.env.VITE_API_URL || '/api')
}

export function getQueueJoinUrl(clinicIdentifier: string, token?: string) {
  const route = token ? `/q/${encodeURIComponent(token)}` : `/queue/${encodeURIComponent(clinicIdentifier)}`
  return `${getPublicUrl()}${route}`
}

export { PLACEHOLDER_PUBLIC_URL }
