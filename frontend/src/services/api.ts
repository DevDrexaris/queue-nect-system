import { getQueueJoinUrl } from '../lib/env'
import { supabase, supabaseAnon } from '../lib/supabase'
import { readStoredTicket, writeStoredTicket } from '../lib/ticket'
import type {
  AdminAccount,
  Clinic,
  OrganizationLocation,
  OrganizationQueue,
  Organization,
  QueueEntry,
  QueueSnapshot,
  QueueAvailability,
  SessionUser,
  StudentRecord,
  UserRole,
} from '../types'

export type JoinQueuePayload = {
  studentId: string
  fullName: string
  course: string
  yearLevel: string
  purpose: string
}

function mapRole(value: string | null | undefined): UserRole {
  if (value === 'SUPER_ADMIN') return 'SUPER_ADMIN'
  if (value === 'ADMIN') return 'ADMIN'
  if (value === 'ORG_ADMIN') return 'ORG_ADMIN'
  return 'STAFF'
}

function safeSessionUser(profile: any, user?: any): SessionUser {
  const org = profile?.organizations ?? null
  const clinic = profile?.organization_id && org
    ? {
        id: profile.organization_id,
        identifier: org.public_identifier ?? '',
        name: org.name ?? 'Clinic',
        schoolName: org.name ?? 'Clinic',
        address: org.address ?? '',
        contact: org.contact_information ?? '',
        queuePrefix: org.queue_prefix ?? 'A',
        queueId: profile.queue_id ?? undefined,
        locationId: profile.location_id ?? undefined,
        announcement: org.announcement_template ?? '',
        announcementsEnabled: org.announcements_enabled ?? true,
        announcementUseCustom: org.announcement_use_custom ?? false,
        announcementTemplate: org.announcement_template ?? 'Queue {queue_number}, please proceed to {service_area}.',
        announcementServiceArea: org.announcement_service_area ?? 'the service desk',
        announcementVoice: org.announcement_voice ?? '',
        announcementRate: Number(org.announcement_rate ?? 0.95),
        announcementVolume: Number(org.announcement_volume ?? 1),
      }
    : undefined

  return {
    id: profile?.id ?? user?.id ?? 'unknown',
    name: profile?.full_name ?? user?.email?.split('@')[0] ?? 'User',
    email: profile?.email ?? user?.email ?? '',
    role: mapRole(profile?.role ?? user?.role ?? 'STAFF'),
    clinic,
  }
}

async function getProfileByUserId(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, organizations!organization_id(name, public_identifier, queue_prefix, address, contact_information, is_active, announcements_enabled, announcement_use_custom, announcement_template, announcement_service_area, announcement_voice, announcement_rate, announcement_volume)')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

function generateSecureQrToken(length = 32) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, length)
}

async function getQueueClient() {
  const { data: { session } } = await supabase.auth.getSession()
  return session ? supabase : supabaseAnon
}

function isRlsPermissionError(error: any) {
  const message = error?.message ?? ''
  return /permission denied|row level security|policy|42501/i.test(message)
}

async function withPublicFallback<T>(
  publicCall: () => Promise<{ data: T | null; error: any }>,
  staffCall?: () => Promise<{ data: T | null; error: any }>
): Promise<{ data: T | null; error: any }> {
  const publicResult = await publicCall()
  if (!publicResult.error || !isRlsPermissionError(publicResult.error)) {
    return publicResult
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session || !staffCall) {
    return publicResult
  }

  return await staffCall()
}

async function getOrgIdFromClinicIdentifier(clinicIdentifier: string) {
  const publicQuery = async () => {
    const result = await supabaseAnon.from('organizations').select('*').eq('public_identifier', clinicIdentifier).maybeSingle()
    return result
  }
  const staffQuery = async () => {
    const result = await supabase.from('organizations').select('*').eq('public_identifier', clinicIdentifier).maybeSingle()
    return result
  }

  return withPublicFallback(publicQuery, staffQuery)
}

function getElapsedMinutes(iso?: string | null, now = Date.now()) {
  if (!iso) return 0
  const diff = now - new Date(iso).getTime()
  return Math.max(0, Math.round(diff / 60000))
}

function countPeopleAhead(entries: Array<{ id: string; status: string; joined_at?: string | null }>, currentId: string, joinedAt?: string | null) {
  if (!joinedAt) return 0

  return entries.filter((entry) => {
    if (entry.id === currentId) return false
    if (!['WAITING', 'CALLED', 'SERVING'].includes(entry.status)) return false
    if (!entry.joined_at) return false
    return new Date(entry.joined_at).getTime() < new Date(joinedAt).getTime()
  }).length
}

async function createOrganizationQrToken(organizationId: string, queueId?: string) {
  let targetQueueId = queueId
  if (!targetQueueId) {
    const { data: defaultQueue, error: queueError } = await supabase
      .from('organization_queues')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('is_default', true)
      .maybeSingle()
    if (queueError) throw queueError
    if (!defaultQueue) throw new Error('No default queue exists for this organization.')
    targetQueueId = defaultQueue.id
  }
  const { data: existing, error: existingError } = await supabase
    .from('organization_qr_tokens')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('queue_id', targetQueueId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingError && existingError.code !== 'PGRST116') throw existingError
  if (existing) return existing

  const token = generateSecureQrToken(32)
  const { data, error } = await supabase
    .from('organization_qr_tokens')
    .insert({
      organization_id: organizationId,
      queue_id: targetQueueId,
      token,
      is_active: true,
      expires_at: null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

async function resolveQueueId(clinicIdentifier: string, queueId?: string) {
  if (queueId) return queueId
  const { data, error } = await supabaseAnon.rpc('get_default_queue_id', { p_public_identifier: clinicIdentifier })
  if (error) throw error
  if (!data) throw new Error('No active queue exists for this organization.')
  return data as string
}

export const queueService = {
  ensureAccessToken: async (clinicIdentifier: string, queueId?: string): Promise<string> => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) throw new Error('Clinic not found.')
    const targetQueueId = await resolveQueueId(clinicIdentifier, queueId)

    const { data: publicToken, error: publicTokenError } = await supabaseAnon.rpc('get_public_queue_qr_token', {
      p_public_identifier: clinicIdentifier,
      p_queue_id: targetQueueId,
    })
    if (publicTokenError) throw publicTokenError
    if (publicToken) return publicToken as string

    const { data: existing, error: existingError } = await supabase
      .from('organization_qr_tokens')
      .select('*')
      .eq('organization_id', org.id)
      .eq('queue_id', targetQueueId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existingError && existingError.code !== 'PGRST116') throw existingError
    if (existing) return existing.token

    const tokenRow = await createOrganizationQrToken(org.id, targetQueueId)
    return tokenRow.token
  },
  regenerateAccessToken: async (clinicIdentifier: string, queueId?: string): Promise<string> => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) throw new Error('Clinic not found.')
    const targetQueueId = await resolveQueueId(clinicIdentifier, queueId)

    const { data: activeTokens, error: listError } = await supabase
      .from('organization_qr_tokens')
      .select('*')
      .eq('organization_id', org.id)
      .eq('queue_id', targetQueueId)
      .eq('is_active', true)
    if (listError) throw listError

    if (activeTokens && activeTokens.length > 0) {
      const deactivate = await supabase
        .from('organization_qr_tokens')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in('id', activeTokens.map((item) => item.id))
      if (deactivate.error) throw deactivate.error
    }

    const tokenRow = await createOrganizationQrToken(org.id, targetQueueId)
    return tokenRow.token
  },
  getAccessTokenDetails: async (clinicIdentifier: string, queueId?: string): Promise<{ token: string; link: string }> => {
    const token = await queueService.ensureAccessToken(clinicIdentifier, queueId)
    return {
      token,
      link: getQueueJoinUrl(clinicIdentifier, token),
    }
  },
  issueAccessToken: async (clinicIdentifier: string, queueId?: string): Promise<{ token: string; link: string }> => {
    const token = await queueService.ensureAccessToken(clinicIdentifier, queueId)
    return {
      token,
      link: getQueueJoinUrl(clinicIdentifier, token),
    }
  },
  validateAccessToken: async (token: string): Promise<{ clinicIdentifier: string; clinicName: string; queueId: string; queueName: string; locationName: string; availability: QueueAvailability }> => {
    const { data, error } = await supabaseAnon.rpc('resolve_queue_qr_token', { p_token: token })
    if (error) throw error
    if (!data?.queueId || !data?.clinicIdentifier) {
      throw new Error('Queue access is invalid or expired.')
    }

    return {
      clinicIdentifier: data.clinicIdentifier,
      clinicName: data.clinicName,
      queueId: data.queueId,
      queueName: data.queueName,
      locationName: data.locationName,
      availability: data.availability,
    }
  },
  getSnapshot: async (clinicIdentifier: string, queueId?: string): Promise<QueueSnapshot> => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) {
      return {
        clinic: { id: '', identifier: clinicIdentifier, name: clinicIdentifier, queuePrefix: 'A', availability: 'UNKNOWN' },
        nowServing: null,
        upNext: [],
        waitingCount: 0,
        servingCount: 0,
        completedCount: 0,
        todayCount: 0,
        entries: [],
      }
    }

    const client = await getQueueClient()
    let resolvedQueueId = queueId
    if (!resolvedQueueId) {
      const scopeResult = await supabaseAnon.rpc('get_default_queue_id', { p_public_identifier: clinicIdentifier })
      if (scopeResult.error) throw scopeResult.error
      resolvedQueueId = scopeResult.data ?? undefined
    }
    if (!resolvedQueueId) throw new Error('No active queue is available for this organization.')
    const entriesQuery = client === supabase
      ? client.from('queue_entries').select('*').eq('organization_id', org.id).eq('queue_id', resolvedQueueId)
      : client.from('public_queue_snapshot').select('*').eq('public_identifier', clinicIdentifier).eq('queue_id', resolvedQueueId)
    const [{ data: entries, error }, availabilityResult, queueDetailsResult] = await Promise.all([
      entriesQuery.order('joined_at', { ascending: true }),
      resolvedQueueId
        ? supabaseAnon.rpc('get_organization_queue_availability', {
            p_public_identifier: clinicIdentifier,
            p_queue_id: resolvedQueueId,
          })
        : supabaseAnon.rpc('get_queue_availability', { p_public_identifier: clinicIdentifier }),
      resolvedQueueId
        ? supabaseAnon.rpc('get_public_queue_details', {
            p_public_identifier: clinicIdentifier,
            p_queue_id: resolvedQueueId,
          })
        : Promise.resolve({ data: null, error: null }),
    ])

    if (error) throw error
    if (availabilityResult.error) console.error('[Queue-Nect] Queue availability lookup failed:', availabilityResult.error)
    if (queueDetailsResult.error) console.error('[Queue-Nect] Public queue details lookup failed:', queueDetailsResult.error)
    const availabilityValue = availabilityResult.data
    const availability: QueueAvailability = ['OPEN', 'PAUSED', 'CLOSED'].includes(availabilityValue)
      ? availabilityValue as QueueAvailability
      : 'UNKNOWN'

    const mapped = (entries ?? []).map((entry) => {
      const peopleAhead = countPeopleAhead(entries ?? [], entry.id, entry.joined_at)
      const estimatedWaitMinutes = ['WAITING', 'CALLED'].includes(entry.status) ? getElapsedMinutes(entry.joined_at) : null

      return {
        id: 'id' in entry ? entry.id : entry.queue_number,
        clinicId: 'organization_id' in entry ? entry.organization_id : '',
        queueId: 'queue_id' in entry ? entry.queue_id : resolvedQueueId,
        queueNumber: entry.queue_number,
        studentId: 'student_id' in entry ? entry.student_id : undefined,
        studentName: 'full_name' in entry ? entry.full_name : undefined,
        course: 'course' in entry ? entry.course : undefined,
        yearLevel: 'year_level' in entry ? entry.year_level : undefined,
        purpose: 'purpose' in entry ? entry.purpose : undefined,
        status: entry.status,
        joinedAt: entry.joined_at,
        calledAt: entry.called_at,
        servedAt: entry.started_at ?? entry.completed_at,
        peopleAhead,
        estimatedWaitMinutes,
      }
    })

    const activeServing = mapped.find((entry) => entry.status === 'SERVING') ?? null
    const activeCalled = activeServing ? null : mapped.find((entry) => entry.status === 'CALLED') ?? null
    const nowServing = activeServing ?? activeCalled ?? null
    const upNext = mapped.filter((entry) => entry.status === 'WAITING' || entry.status === 'AWAITING_RETURN').slice(0, 5)
    const waitingCount = mapped.filter((entry) => entry.status === 'WAITING').length
    const servingCount = mapped.filter((entry) => entry.status === 'SERVING').length
    const awaitingReturnCount = mapped.filter((entry) => entry.status === 'AWAITING_RETURN').length
    const completedCount = mapped.filter((entry) => entry.status === 'COMPLETED').length

    return {
      clinic: {
        id: org.id,
        identifier: org.public_identifier,
        name: org.name,
        queueName: queueDetailsResult.data?.queueName,
        locationName: queueDetailsResult.data?.locationName,
        serviceArea: queueDetailsResult.data?.serviceArea,
        schoolName: org.name,
        address: org.address ?? '',
        contact: org.contact_information ?? '',
        queuePrefix: queueDetailsResult.data?.queuePrefix ?? org.queue_prefix,
        queueId: resolvedQueueId ?? undefined,
        availability,
        announcement: org.announcement_template ?? '',
        announcementsEnabled: org.announcements_enabled ?? true,
        announcementUseCustom: org.announcement_use_custom ?? false,
        announcementTemplate: org.announcement_template ?? 'Queue {queue_number}, please proceed to {service_area}.',
        announcementServiceArea: org.announcement_service_area ?? 'the service desk',
        announcementVoice: org.announcement_voice ?? '',
        announcementRate: Number(org.announcement_rate ?? 0.95),
        announcementVolume: Number(org.announcement_volume ?? 1),
      },
      nowServing,
      upNext,
      waitingCount,
      servingCount,
      awaitingReturnCount,
      completedCount,
      todayCount: mapped.length,
      entries: mapped,
    }
  },

  getEntry: async (clinicIdentifier: string, queueId: string): Promise<QueueEntry> => {
    const ticket = readStoredTicket()
    if (!ticket || ticket.queueId !== queueId || ticket.clinicIdentifier !== clinicIdentifier) {
      throw new Error('Queue access is invalid or expired.')
    }
    let statusToken = ticket.statusToken
    if (!statusToken) {
      const upgrade = await supabaseAnon.rpc('exchange_legacy_queue_ticket', {
        p_queue_entry_id: ticket.queueId,
        p_queue_number: ticket.queueNumber,
        p_public_identifier: ticket.clinicIdentifier,
      })
      if (upgrade.error) throw upgrade.error
      statusToken = upgrade.data
      writeStoredTicket({ ...ticket, statusToken })
    }
    const { data, error } = await supabaseAnon.rpc('get_student_queue_entry', { p_status_token: statusToken })
    if (error) throw error
    const row = data.entry

    return {
      id: row.id,
      clinicId: row.organization_id,
      queueId: row.queue_id,
      queueNumber: row.queue_number,
      studentId: row.student_id,
      studentName: row.full_name,
      course: row.course,
      yearLevel: row.year_level,
      purpose: row.purpose,
      status: row.status,
      cancellationSource: row.cancellation_source,
      joinedAt: row.joined_at,
      calledAt: row.called_at,
      servedAt: row.started_at ?? row.completed_at,
      peopleAhead: data.people_ahead,
      estimatedWaitMinutes: ['WAITING', 'CALLED'].includes(row.status) ? getElapsedMinutes(row.joined_at) : null,
    }
  },

  join: async (clinicIdentifier: string, accessToken: string, payload: JoinQueuePayload): Promise<QueueEntry & { statusToken: string }> => {
    const { data, error } = await supabaseAnon.rpc('join_queue_with_status_token', {
      p_public_identifier: clinicIdentifier,
      p_qr_token: accessToken,
      p_student_id: payload.studentId,
      p_full_name: payload.fullName,
      p_course: payload.course,
      p_year_level: payload.yearLevel,
      p_purpose: payload.purpose,
    })
    if (error) throw error

    const entry = data.entry
    return {
      id: entry.id,
      clinicId: entry.organization_id,
      queueId: entry.queue_id,
      queueNumber: entry.queue_number,
      studentId: entry.student_id,
      studentName: entry.full_name,
      course: entry.course,
      yearLevel: entry.year_level,
      purpose: entry.purpose,
      status: entry.status,
      joinedAt: entry.joined_at,
      calledAt: entry.called_at,
      servedAt: entry.started_at ?? entry.completed_at,
      peopleAhead: 0,
      estimatedWaitMinutes: 0,
      statusToken: data.status_token,
    }
  },

  callNext: async (clinicIdentifier: string, queueId?: string): Promise<QueueEntry> => {
    const { data: org } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (!org) throw new Error('Clinic not found.')
    const { data: waiting } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('organization_id', org.id)
      .eq('queue_id', queueId ?? (await supabase.rpc('get_default_queue_id', { p_public_identifier: clinicIdentifier })).data)
      .eq('status', 'WAITING')
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!waiting) throw new Error('No waiting queue.')
    return queueService.updateStatus(waiting.id, 'call')
  },

  registerWalkInPatient: async (queueId: string, fullName: string, referenceId?: string | null): Promise<QueueEntry> => {
    const { data, error } = await supabase.rpc('register_walk_in_for_queue', {
      p_queue_id: queueId,
      p_full_name: fullName,
      p_reference_id: referenceId?.trim() || null,
    })
    if (error) throw error

    const row = data.entry
    return {
      id: row.id,
      clinicId: row.organization_id,
      queueId: row.queue_id,
      queueNumber: row.queue_number,
      studentId: row.student_id,
      studentName: row.full_name,
      course: row.course,
      yearLevel: row.year_level,
      purpose: row.purpose,
      status: row.status,
      joinedAt: row.joined_at,
      calledAt: row.called_at,
      servedAt: row.started_at ?? row.completed_at,
      peopleAhead: 0,
      estimatedWaitMinutes: null,
    }
  },

  serveNext: async (clinicIdentifier: string, queueId?: string): Promise<QueueEntry> => {
    const { data: org } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (!org) throw new Error('Clinic not found.')

    const { data: target } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('organization_id', org.id)
      .eq('queue_id', queueId ?? (await supabase.rpc('get_default_queue_id', { p_public_identifier: clinicIdentifier })).data)
      .eq('status', 'CALLED')
      .order('called_at', { ascending: false })
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!target) throw new Error('No called number is ready to serve.')
    return queueService.updateStatus(target.id, 'serve')
  },

  cancelEntry: async (clinicIdentifier: string, queueId: string) => {
    const ticket = readStoredTicket()
    if (!ticket?.statusToken || ticket.queueId !== queueId || ticket.clinicIdentifier !== clinicIdentifier) {
      throw new Error('Queue access is invalid or expired.')
    }
    const { data, error } = await supabaseAnon.rpc('cancel_student_queue', { p_status_token: ticket.statusToken })
    if (error) throw error
    return data
  },

  deleteEntry: async (clinicIdentifier: string, queueId: string) => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) throw new Error('Clinic not found.')

    const { data, error } = await supabase.rpc('delete_queue_entry', { p_queue_entry_id: queueId })
    if (error) throw error
    return {
      id: (data as any)?.id ?? queueId,
      organizationId: org.id,
    }
  },

  resetQueue: async (clinicIdentifier: string, queueId?: string) => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) throw new Error('Clinic not found.')

    const resolvedQueueId = await resolveQueueId(clinicIdentifier, queueId)
    const today = new Date().toISOString().slice(0, 10)
    const { data: session, error: sessionError } = await supabase
      .from('queue_sessions')
      .select('*')
      .eq('organization_id', org.id)
      .eq('queue_id', resolvedQueueId)
      .eq('session_date', today)
      .eq('is_active', true)
      .maybeSingle()

    if (sessionError) throw sessionError
    if (!session) {
      throw new Error('There is no active queue session for today to reset.')
    }

    const { data, error } = resolvedQueueId
      ? await supabase.rpc('reset_organization_queue_session', { p_queue_id: resolvedQueueId })
      : await supabase.rpc('reset_queue_session', { p_organization_id: org.id })
    if (error) throw error
    return { queueSessionId: session.id, queuePrefix: session.queue_prefix, cancelledEntries: data }
  },

  setAvailability: async (queueId: string, availability: Exclude<QueueAvailability, 'UNKNOWN'>): Promise<Exclude<QueueAvailability, 'UNKNOWN'>> => {
    const { data, error } = await supabase.rpc('set_organization_queue_availability', {
      p_queue_id: queueId,
      p_admission_status: availability,
    })
    if (error) throw error
    if (!['OPEN', 'PAUSED', 'CLOSED'].includes(data)) throw new Error('Queue availability response was invalid.')
    return data as Exclude<QueueAvailability, 'UNKNOWN'>
  },

  updateStatus: async (queueId: string, action: 'call' | 'serve' | 'complete' | 'skip' | 'cancel' | 'return_to_waiting' | 'awaiting_return' | 'call_again') => {
    const { data, error } = await supabase.rpc('transition_queue_entry', {
      p_queue_entry_id: queueId,
      p_action: action
    })
    if (error) throw error

    const row = data

    return {
      id: row.id,
      clinicId: row.organization_id,
      queueId: row.queue_id,
      queueNumber: row.queue_number,
      studentId: row.student_id,
      studentName: row.full_name,
      course: row.course,
      yearLevel: row.year_level,
      purpose: row.purpose,
      status: row.status,
      joinedAt: row.joined_at,
      calledAt: row.called_at,
      servedAt: row.started_at ?? row.completed_at,
      peopleAhead: 0,
      estimatedWaitMinutes: null,
    }
  },
}

export const clinicService = {
  get: async (clinicIdentifier: string): Promise<Clinic> => {
    const { data, error } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (error) throw error
    if (!data) throw new Error('Clinic not found.')

    return {
      id: data.id,
      identifier: data.public_identifier,
      name: data.name,
      schoolName: data.name,
      address: data.address ?? '',
      contact: data.contact_information ?? '',
      queuePrefix: data.queue_prefix,
      announcement: data.announcement_template ?? '',
      announcementsEnabled: data.announcements_enabled ?? true,
      announcementUseCustom: data.announcement_use_custom ?? false,
      announcementTemplate: data.announcement_template ?? 'Queue {queue_number}, please proceed to {service_area}.',
      announcementServiceArea: data.announcement_service_area ?? 'the service desk',
      announcementVoice: data.announcement_voice ?? '',
      announcementRate: Number(data.announcement_rate ?? 0.95),
      announcementVolume: Number(data.announcement_volume ?? 1),
    }
  },
  update: async (payload: Partial<Clinic>) => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user?.id) throw new Error('Your session has expired. Please log in again.')

    const profile = await getProfileByUserId(user.id)
    if (!profile?.organization_id) throw new Error('No organization assigned to this profile.')

    const { data, error } = await supabase
      .from('organizations')
      .update({
        name: payload.name ?? undefined,
        address: payload.address ?? undefined,
        contact_information: payload.contact ?? undefined,
        queue_prefix: payload.queuePrefix ?? undefined,
        announcements_enabled: payload.announcementsEnabled ?? undefined,
        announcement_use_custom: payload.announcementUseCustom ?? undefined,
        announcement_template: payload.announcementTemplate ?? undefined,
        announcement_service_area: payload.announcementServiceArea ?? undefined,
        announcement_voice: payload.announcementVoice ?? undefined,
        announcement_rate: payload.announcementRate ?? undefined,
        announcement_volume: payload.announcementVolume ?? undefined,
      })
      .eq('id', profile.organization_id)
      .select('*')
      .single()

    if (error) throw error

    return {
      id: data.id,
      identifier: data.public_identifier,
      name: data.name,
      schoolName: data.name,
      address: data.address ?? '',
      contact: data.contact_information ?? '',
      queuePrefix: data.queue_prefix,
      announcement: data.announcement_template ?? '',
      announcementsEnabled: data.announcements_enabled ?? true,
      announcementUseCustom: data.announcement_use_custom ?? false,
      announcementTemplate: data.announcement_template ?? 'Queue {queue_number}, please proceed to {service_area}.',
      announcementServiceArea: data.announcement_service_area ?? 'the service desk',
      announcementVoice: data.announcement_voice ?? '',
      announcementRate: Number(data.announcement_rate ?? 0.95),
      announcementVolume: Number(data.announcement_volume ?? 1),
    }
  },
}

export const authService = {
  loginAdmin: async (email: string, password: string): Promise<{ user: SessionUser }> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)

    const profile = await getProfileByUserId(data.user.id)
    return { user: safeSessionUser(profile, data.user) }
  },
  loginSuperAdmin: async (email: string, password: string): Promise<{ user: SessionUser }> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)

    const profile = await getProfileByUserId(data.user.id)
    return { user: safeSessionUser(profile, data.user) }
  },
  me: async (): Promise<{ user: SessionUser }> => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (error) throw new Error(error.message)
    if (!user) throw new Error('Your session has expired. Please log in again.')

    const profile = await getProfileByUserId(user.id)
    return { user: safeSessionUser(profile, user) }
  },
  logout: async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw new Error(error.message)
  },
  changePassword: async (currentPassword: string, newPassword: string) => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError) throw new Error(userError.message)
    if (!user?.email) throw new Error('Your session has expired. Please log in again.')

    const { error: signInError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword })
    if (signInError) throw new Error('Current password is incorrect.')

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    if (updateError) throw new Error(updateError.message)
  },
}

export const studentsService = {
  list: async (query: string): Promise<{ students: StudentRecord[] }> => {
    const { data, error } = await supabase
      .from('queue_entries')
      .select('*')
      .or(`full_name.ilike.%${query}%,student_id.ilike.%${query}%`)
      .order('joined_at', { ascending: false })

    if (error) throw error

    const students: StudentRecord[] = (data ?? []).map((entry) => ({
      id: entry.id,
      studentId: entry.student_id,
      fullName: entry.full_name,
      course: entry.course,
      yearLevel: entry.year_level,
      queueActivity: 1,
      status: entry.status === 'WAITING' || entry.status === 'CALLED' || entry.status === 'SERVING' ? 'active' : 'inactive',
    }))

    return { students }
  },
}

export const historyService = {
  list: async (_params: string): Promise<{ entries: QueueEntry[] }> => {
    const { data, error } = await supabase.from('queue_entries').select('*').order('joined_at', { ascending: false })
    if (error) throw error

    const entries = (data ?? []).map((entry) => ({
      id: entry.id,
      clinicId: entry.organization_id,
      queueNumber: entry.queue_number,
      studentId: entry.student_id,
      studentName: entry.full_name,
      course: entry.course,
      yearLevel: entry.year_level,
      purpose: entry.purpose,
      status: entry.status,
      joinedAt: entry.joined_at,
      calledAt: entry.called_at,
      servedAt: entry.started_at ?? entry.completed_at,
      peopleAhead: 0,
      estimatedWaitMinutes: null,
    }))

    return { entries }
  },
}

export const analyticsService = {
  summary: async (clinicIdentifier: string, from: string, to: string, queueId?: string, staffScoped = false) => {
    if (staffScoped && !queueId) throw new Error('Select an assigned queue to view analytics.')

    const { data: org, error: orgError } = staffScoped
      ? { data: null, error: null }
      : await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!staffScoped && !org) throw new Error('Clinic not found.')

    const { data, error } = await supabase.rpc('get_organization_analytics', {
      p_organization_id: staffScoped ? null : org?.id,
      p_from: from,
      p_to: to,
      p_queue_id: staffScoped ? queueId : null,
    })
    if (error) throw error

    return {
      total: data.total as number,
      completed: data.completed as number,
      cancelled: data.cancelled as number,
      noShow: data.noShow as number,
      waiting: data.waiting as number,
      serving: data.serving as number,
      awaitingReturn: data.awaitingReturn as number,
      averageWaitMinutes: data.averageWaitMinutes as number | null,
      averageServiceMinutes: data.averageServiceMinutes as number | null,
      hourly: (data.hourly as { hour: number; value: number }[]).map((item) => ({ label: `${String(item.hour).padStart(2, '0')}:00`, value: item.value })),
      daily: (data.daily as { date: string; value: number }[]).map((item) => ({ label: new Date(`${item.date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }), value: item.value })),
      purposes: (data.purposes as { label: string; count: number; percent: number }[]).map((item) => ({ ...item, value: item.count })),
    }
  },
}

export const organizationStructureService = {
  stats: async (organizationId: string) => {
    const { data, error } = await supabase.rpc('get_organization_location_queue_stats', {
      p_organization_id: organizationId,
    })
    if (error) throw error
    return data as {
      combined: { total: number; waiting: number; serving: number; awaitingReturn: number; completed: number }
      locations: Array<{
        locationId: string
        name: string
        total: number
        waiting: number
        serving: number
        awaitingReturn: number
        completed: number
        queues: Array<{
          queueId: string
          name: string
          prefix: string
          availability: 'OPEN' | 'PAUSED' | 'CLOSED'
          active: boolean
          total: number
          waiting: number
          serving: number
          awaitingReturn: number
          completed: number
        }>
      }>
    }
  },
  list: async (organizationId: string): Promise<{ locations: OrganizationLocation[]; queues: OrganizationQueue[] }> => {
    const [locationResult, queueResult] = await Promise.all([
      supabase.from('organization_locations').select('*').eq('organization_id', organizationId).order('name'),
      supabase.from('organization_queues').select('*').eq('organization_id', organizationId).order('name'),
    ])
    if (locationResult.error) throw locationResult.error
    if (queueResult.error) throw queueResult.error
    const locations: OrganizationLocation[] = (locationResult.data ?? []).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      locationType: row.location_type,
      description: row.description,
      addressOrFloor: row.address_or_floor,
      contactInformation: row.contact_information,
      isActive: row.is_active,
      isDefault: row.is_default,
    }))
    const locationById = new Map(locations.map((location) => [location.id, location.name]))
    const queues: OrganizationQueue[] = (queueResult.data ?? []).map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      locationId: row.location_id,
      locationName: locationById.get(row.location_id),
      name: row.name,
      queuePrefix: row.queue_prefix,
      publicIdentifier: row.public_identifier,
      description: row.description,
      serviceArea: row.service_area,
      admissionStatus: row.admission_status,
      openingTime: row.opening_time,
      closingTime: row.closing_time,
      timeZone: row.time_zone,
      operatingDays: row.operating_days,
      isActive: row.is_active,
      isDefault: row.is_default,
    }))
    return { locations, queues }
  },
  createLocation: async (organizationId: string, values: Omit<OrganizationLocation, 'id' | 'organizationId' | 'isActive' | 'isDefault'>) => {
    const { data, error } = await supabase.rpc('create_organization_location', {
      p_organization_id: organizationId,
      p_name: values.name,
      p_location_type: values.locationType,
      p_description: values.description ?? null,
      p_address_or_floor: values.addressOrFloor ?? null,
      p_contact_information: values.contactInformation ?? null,
    })
    if (error) throw error
    return data
  },
  updateLocation: async (location: OrganizationLocation) => {
    const { data, error } = await supabase.rpc('update_organization_location', {
      p_location_id: location.id,
      p_name: location.name,
      p_location_type: location.locationType,
      p_description: location.description ?? null,
      p_address_or_floor: location.addressOrFloor ?? null,
      p_contact_information: location.contactInformation ?? null,
      p_is_active: location.isActive,
    })
    if (error) throw error
    return data
  },
  createQueue: async (organizationId: string, queue: Omit<OrganizationQueue, 'id' | 'organizationId' | 'publicIdentifier' | 'locationName' | 'isActive' | 'isDefault'>) => {
    const { data, error } = await supabase.rpc('create_organization_queue', {
      p_organization_id: organizationId,
      p_location_id: queue.locationId,
      p_name: queue.name,
      p_queue_prefix: queue.queuePrefix,
      p_description: queue.description ?? null,
      p_service_area: queue.serviceArea ?? null,
      p_admission_status: queue.admissionStatus,
      p_opening_time: queue.openingTime ?? null,
      p_closing_time: queue.closingTime ?? null,
      p_time_zone: queue.timeZone ?? null,
      p_operating_days: queue.operatingDays ?? null,
    })
    if (error) throw error
    return data
  },
  updateQueue: async (queue: OrganizationQueue) => {
    const { data, error } = await supabase.rpc('update_organization_queue', {
      p_queue_id: queue.id,
      p_location_id: queue.locationId,
      p_name: queue.name,
      p_queue_prefix: queue.queuePrefix,
      p_description: queue.description ?? null,
      p_service_area: queue.serviceArea ?? null,
      p_is_active: queue.isActive,
      p_opening_time: queue.openingTime ?? null,
      p_closing_time: queue.closingTime ?? null,
      p_time_zone: queue.timeZone ?? null,
      p_operating_days: queue.operatingDays ?? null,
      p_admission_status: queue.admissionStatus,
    })
    if (error) throw error
    return data
  },
  archiveLocation: async (locationId: string) => {
    const { data, error } = await supabase.rpc('archive_organization_location', { p_location_id: locationId })
    if (error) throw error
    return data
  },
  archiveQueue: async (queueId: string) => {
    const { data, error } = await supabase.rpc('archive_organization_queue', { p_queue_id: queueId })
    if (error) throw error
    return data
  },
  assignStaff: async (profileId: string, locationId: string | null, queueId: string | null) => {
    const { data, error } = await supabase.rpc('assign_profile_to_queue', {
      p_profile_id: profileId,
      p_location_id: locationId,
      p_queue_id: queueId,
    })
    if (error) throw error
    return data
  },
}

export const adminUsersService = {
  list: async (): Promise<{ users: AdminAccount[] }> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*, organizations!organization_id(name, public_identifier)')
      .order('created_at', { ascending: false })

    if (error) throw error

    const users: AdminAccount[] = (data ?? []).map((profile) => {
      const org = Array.isArray(profile.organizations) ? profile.organizations[0] : profile.organizations

      return {
        id: profile.id,
        name: profile.full_name,
        email: profile.email,
        role: mapRole(profile.role),
        organizationId: profile.organization_id ?? undefined,
        locationId: profile.location_id ?? undefined,
        queueId: profile.queue_id ?? undefined,
        clinicName: org?.name ?? undefined,
        status: profile.is_active ? 'active' : 'disabled',
      }
    })

    return { users }
  },
}

export const superAdminService = {
  organizations: async (): Promise<{ organizations: Organization[] }> => {
    const { data, error } = await supabase.from('organizations').select('*').order('created_at', { ascending: false })
    if (error) throw error

    const organizations: Organization[] = (data ?? []).map((org) => ({
      id: org.id,
      schoolName: org.name,
      clinicName: org.name,
      clinicIdentifier: org.public_identifier,
      adminName: undefined,
      status: org.is_active ? 'active' : 'disabled',
      createdAt: org.created_at,
    }))

    return { organizations }
  },
  updateOrganization: async (id: string, payload: Record<string, string>): Promise<Organization> => {
    const { data, error } = await supabase
      .from('organizations')
      .update({
        name: payload.name ?? payload.schoolName ?? undefined,
        public_identifier: payload.public_identifier ?? payload.clinicIdentifier ?? undefined,
        queue_prefix: payload.queue_prefix ?? payload.queuePrefix ?? undefined,
        address: payload.address ?? undefined,
        contact_information: payload.contact_information ?? payload.contact ?? undefined,
        is_active: payload.is_active ? payload.is_active === 'true' : undefined,
      })
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error

    return {
      id: data.id,
      schoolName: data.name,
      clinicName: data.name,
      clinicIdentifier: data.public_identifier,
      adminName: undefined,
      status: data.is_active ? 'active' : 'disabled',
      createdAt: data.created_at,
    }
  },
  createOrganization: async (payload: Record<string, string>): Promise<Organization> => {
    const { data, error } = await supabase.from('organizations').insert({
      name: payload.name ?? payload.schoolName ?? 'Clinic',
      organization_type: 'clinic',
      public_identifier: payload.public_identifier ?? payload.clinicIdentifier ?? `clinic-${Date.now()}`,
      queue_prefix: payload.queue_prefix ?? payload.queuePrefix ?? 'A',
      address: payload.address ?? '',
      contact_information: payload.contact_information ?? payload.contact ?? '',
      is_active: true,
    }).select('*').single()

    if (error) throw error

    await createOrganizationQrToken(data.id)

    return {
      id: data.id,
      schoolName: data.name,
      clinicName: data.name,
      clinicIdentifier: data.public_identifier,
      adminName: undefined,
      status: data.is_active ? 'active' : 'disabled',
      createdAt: data.created_at,
    }
  },
  administrators: async (): Promise<{ users: AdminAccount[] }> => {
    return adminUsersService.list()
  },
  updateAdmin: async (id: string, payload: Record<string, string>): Promise<AdminAccount> => {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        full_name: payload.name ?? undefined,
        email: payload.email ?? undefined,
        role: (payload.role ?? 'ADMIN') as UserRole,
        organization_id: payload.organizationId ?? null,
        is_active: payload.is_active ? payload.is_active === 'true' : undefined,
      })
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error

    return {
      id: data.id,
      name: data.full_name,
      email: data.email,
      role: mapRole(data.role),
      organizationId: data.organization_id ?? undefined,
      clinicName: undefined,
      status: data.is_active ? 'active' : 'disabled',
    }
  },
  createAdmin: async (payload: Record<string, string>): Promise<AdminAccount> => {
    const name = payload.name ?? payload.fullName ?? 'New Administrator'
    const email = payload.email ?? ''
    const roleValue = (payload.role ?? 'ADMIN') as UserRole
    const organizationId = payload.organizationId ?? null

    const { data, error } = await supabase.from('profiles').insert({
      full_name: name,
      email,
      role: roleValue,
      organization_id: organizationId,
      is_active: true,
    }).select('*').single()

    if (error) throw error

    return {
      id: data.id,
      name: data.full_name,
      email: data.email,
      role: mapRole(data.role),
      organizationId: data.organization_id ?? undefined,
      clinicName: undefined,
      status: data.is_active ? 'active' : 'disabled',
    }
  },
  deleteAdmin: async (id: string) => {
    const { error } = await supabase.from('profiles').delete().eq('id', id)
    if (error) throw error
  },
  deleteOrganization: async (id: string) => {
    const { error } = await supabase.from('organizations').delete().eq('id', id)
    if (error) throw error
  },
}
