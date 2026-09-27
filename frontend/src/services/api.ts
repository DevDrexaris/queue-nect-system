import { getQueueJoinUrl } from '../lib/env'
import { supabase, supabaseAnon } from '../lib/supabase'
import { readStoredTicket, writeStoredTicket } from '../lib/ticket'
import type {
  AdminAccount,
  Clinic,
  Organization,
  QueueEntry,
  QueueSnapshot,
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

async function createOrganizationQrToken(organizationId: string) {
  const fetchExisting = async () => await withPublicFallback(
    async () => {
      const result = await supabaseAnon
        .from('organization_qr_tokens')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return result
    },
    async () => {
      const result = await supabase
        .from('organization_qr_tokens')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return result
    },
  )

  const { data: existing, error: existingError } = await fetchExisting()
  if (existingError && existingError.code !== 'PGRST116') throw existingError
  if (existing) return existing

  const token = generateSecureQrToken(32)
  const createToken = async () => await withPublicFallback(
    async () => {
      const result = await supabaseAnon
        .from('organization_qr_tokens')
        .insert({
          organization_id: organizationId,
          token,
          is_active: true,
          expires_at: null,
        })
        .select('*')
        .single()
      return result
    },
    async () => {
      const result = await supabase
        .from('organization_qr_tokens')
        .insert({
          organization_id: organizationId,
          token,
          is_active: true,
          expires_at: null,
        })
        .select('*')
        .single()
      return result
    },
  )

  const { data, error } = await createToken()
  if (error) throw error
  return data
}

export const queueService = {
  ensureAccessToken: async (clinicIdentifier: string): Promise<string> => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) throw new Error('Clinic not found.')

    const fetchActiveToken = async () => {
      const response = await withPublicFallback(
        async () => {
          const result = await supabaseAnon
            .from('organization_qr_tokens')
            .select('*')
            .eq('organization_id', org.id)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          return result
        },
        async () => {
          const result = await supabase
            .from('organization_qr_tokens')
            .select('*')
            .eq('organization_id', org.id)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          return result
        },
      )
      return response
    }

    const { data: existing, error: existingError } = await fetchActiveToken()
    if (existingError && existingError.code !== 'PGRST116') throw existingError
    if (existing) return existing.token

    const tokenRow = await createOrganizationQrToken(org.id)
    return tokenRow.token
  },
  regenerateAccessToken: async (clinicIdentifier: string): Promise<string> => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) throw new Error('Clinic not found.')

    const fetchActiveTokens = async () => await withPublicFallback(
      async () => {
        const result = await supabaseAnon
          .from('organization_qr_tokens')
          .select('*')
          .eq('organization_id', org.id)
          .eq('is_active', true)
        return result
      },
      async () => {
        const result = await supabase
          .from('organization_qr_tokens')
          .select('*')
          .eq('organization_id', org.id)
          .eq('is_active', true)
        return result
      },
    )

    const { data: activeTokens, error: listError } = await fetchActiveTokens()
    if (listError) throw listError

    if (activeTokens && activeTokens.length > 0) {
      const deactivate = await withPublicFallback(
        async () => {
          const result = await supabaseAnon
            .from('organization_qr_tokens')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .in('id', activeTokens.map((item) => item.id))
          return result
        },
        async () => {
          const result = await supabase
            .from('organization_qr_tokens')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .in('id', activeTokens.map((item) => item.id))
          return result
        },
      )

      if (deactivate.error) throw deactivate.error
    }

    const tokenRow = await createOrganizationQrToken(org.id)
    return tokenRow.token
  },
  getAccessTokenDetails: async (clinicIdentifier: string): Promise<{ token: string; link: string }> => {
    const token = await queueService.ensureAccessToken(clinicIdentifier)
    return {
      token,
      link: getQueueJoinUrl(clinicIdentifier, token),
    }
  },
  issueAccessToken: async (clinicIdentifier: string): Promise<{ token: string; link: string }> => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) throw new Error('Clinic not found.')

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    const token = generateSecureQrToken(32)

    const insertToken = async () => {
      const response = await withPublicFallback(
        async () => {
          const result = await supabaseAnon
            .from('organization_qr_tokens')
            .insert({
              organization_id: org.id,
              token,
              is_active: true,
              expires_at: expiresAt,
            })
            .select('*')
            .single()
          return result
        },
        async () => {
          const result = await supabase
            .from('organization_qr_tokens')
            .insert({
              organization_id: org.id,
              token,
              is_active: true,
              expires_at: expiresAt,
            })
            .select('*')
            .single()
          return result
        },
      )

      return response
    }

    const { data, error } = await insertToken()
    if (error) throw error
    if (!data) {
      throw new Error('Queue access is invalid or expired.')
    }

    return {
      token: data.token,
      link: getQueueJoinUrl(clinicIdentifier, data.token),
    }
  },
  validateAccessToken: async (token: string): Promise<{ clinicIdentifier: string; clinicName: string }> => {
    const { data, error } = await supabaseAnon
      .from('organization_qr_tokens')
      .select('token, organization_id, is_active, expires_at, organizations!inner(public_identifier, name)')
      .eq('token', token)
      .eq('is_active', true)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      throw new Error('Queue access is invalid or expired.')
    }

    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
      throw new Error('Queue access is invalid or expired.')
    }

    const orgRow = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations
    if (!orgRow) {
      throw new Error('Queue access is invalid or expired.')
    }

    return {
      clinicIdentifier: orgRow.public_identifier,
      clinicName: orgRow.name,
    }
  },
  getSnapshot: async (clinicIdentifier: string): Promise<QueueSnapshot> => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) {
      return {
        clinic: { id: '', identifier: clinicIdentifier, name: clinicIdentifier, queuePrefix: 'A' },
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
    const entriesQuery = client === supabase
      ? client.from('queue_entries').select('*').eq('organization_id', org.id)
      : client.from('public_queue_snapshot').select('*').eq('public_identifier', clinicIdentifier)
    const { data: entries, error } = await entriesQuery.order('joined_at', { ascending: true })

    if (error) throw error

    const mapped = (entries ?? []).map((entry) => {
      const peopleAhead = countPeopleAhead(entries ?? [], entry.id, entry.joined_at)
      const estimatedWaitMinutes = ['WAITING', 'CALLED'].includes(entry.status) ? getElapsedMinutes(entry.joined_at) : null

      return {
        id: 'id' in entry ? entry.id : entry.queue_number,
        clinicId: 'organization_id' in entry ? entry.organization_id : '',
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
        schoolName: org.name,
        address: org.address ?? '',
        contact: org.contact_information ?? '',
        queuePrefix: org.queue_prefix,
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

  callNext: async (clinicIdentifier: string): Promise<QueueEntry> => {
    const { data: org } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (!org) throw new Error('Clinic not found.')
    const { data: waiting } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('organization_id', org.id)
      .eq('status', 'WAITING')
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!waiting) throw new Error('No waiting queue.')
    return queueService.updateStatus(waiting.id, 'call')
  },

  serveNext: async (clinicIdentifier: string): Promise<QueueEntry> => {
    const { data: org } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (!org) throw new Error('Clinic not found.')

    const { data: target } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('organization_id', org.id)
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

  resetQueue: async (clinicIdentifier: string) => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) throw new Error('Clinic not found.')

    const today = new Date().toISOString().slice(0, 10)
    const { data: session, error: sessionError } = await supabase
      .from('queue_sessions')
      .select('*')
      .eq('organization_id', org.id)
      .eq('session_date', today)
      .eq('is_active', true)
      .maybeSingle()

    if (sessionError) throw sessionError
    if (!session) {
      throw new Error('There is no active queue session for today to reset.')
    }

    const { data, error } = await supabase.rpc('reset_queue_session', { p_organization_id: org.id })
    if (error) throw error
    return { queueSessionId: session.id, queuePrefix: org.queue_prefix, cancelledEntries: data }
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
  summary: async (clinicIdentifier: string, from: string, to: string) => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) throw new Error('Clinic not found.')

    const { data, error } = await supabase.rpc('get_organization_analytics', {
      p_organization_id: org.id,
      p_from: from,
      p_to: to,
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
