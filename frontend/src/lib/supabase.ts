import { createClient } from '@supabase/supabase-js'
import { validateSupabaseRuntimeEnv } from './env'

const { url: supabaseUrl, key: supabasePublishableKey } = validateSupabaseRuntimeEnv()

console.info('[Queue-Nect] Supabase client initialization:', {
  url: supabaseUrl,
  keyExists: Boolean(supabasePublishableKey),
  keyLength: supabasePublishableKey.length,
  keyPrefix: supabasePublishableKey.substring(0, 14),
})

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
})

export const supabaseAnon = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

export async function getProfileRole(profileId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, email, organization_id, is_active, organizations!organization_id(name, public_identifier, queue_prefix, address, contact_information, is_active)')
    .eq('id', profileId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getCurrentProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) return null
  return getProfileRole(user.id)
}
