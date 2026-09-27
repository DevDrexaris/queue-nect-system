import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: responseHeaders })
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: responseHeaders })

  const webhookSecret = Deno.env.get('QUEUE_PUSH_WEBHOOK_SECRET')
  if (!webhookSecret || request.headers.get('authorization') !== `Bearer ${webhookSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: responseHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return Response.json({ error: 'Push delivery is not configured' }, { status: 503, headers: responseHeaders })
  }

  const { queue_entry_id: queueEntryId } = await request.json().catch(() => ({}))
  if (typeof queueEntryId !== 'string') return Response.json({ error: 'Invalid event' }, { status: 400, headers: responseHeaders })

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const { data: entry, error: entryError } = await supabase
    .from('queue_entries')
    .select('id, queue_number, status')
    .eq('id', queueEntryId)
    .maybeSingle()
  if (entryError || !entry || entry.status !== 'CALLED') return Response.json({ delivered: 0 }, { headers: responseHeaders })

  const { data: subscriptions, error: subscriptionError } = await supabase
    .from('student_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('queue_entry_id', queueEntryId)
  if (subscriptionError) return Response.json({ error: 'Unable to load push subscriptions' }, { status: 500, headers: responseHeaders })

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  const payload = JSON.stringify({
    title: "Queue-Nect — You're being called",
    body: `Queue ${entry.queue_number} is now being called. Please proceed to the service area.`,
    queue_number: entry.queue_number,
    queue_entry_id: entry.id,
    url: '/queue/status',
  })

  const results = await Promise.allSettled((subscriptions ?? []).map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload)
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('student_push_subscriptions').delete().eq('id', subscription.id)
      }
      throw error
    }
  }))

  return Response.json({ delivered: results.filter((result) => result.status === 'fulfilled').length }, { headers: responseHeaders })
})
