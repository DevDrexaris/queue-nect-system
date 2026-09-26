import { createClient } from '@supabase/supabase-js'
import { getSupabasePublishableKey, getSupabaseUrl } from './env'

const supabaseUrl = getSupabaseUrl()
const supabaseAnonKey = getSupabasePublishableKey()

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export async function getProfileRole(profileId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, full_name, email, organization_id, is_active')
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
