import { supabase } from '../lib/supabase'
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
        announcement: '',
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
    .select('*, organizations!organization_id(name, public_identifier, queue_prefix, address, contact_information, is_active)')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

function getOrgIdFromClinicIdentifier(clinicIdentifier: string) {
  return supabase.from('organizations').select('*').eq('public_identifier', clinicIdentifier).maybeSingle()
}

export const queueService = {
  ensureAccessToken: async (clinicIdentifier: string): Promise<string> => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) throw new Error('Clinic not found.')

    const { data: existing, error: existingError } = await supabase
      .from('organization_qr_tokens')
      .select('*')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingError && existingError.code !== 'PGRST116') throw existingError
    if (existing) return existing.token

    const token = crypto.randomUUID().replace(/-/g, '')
    const { error } = await supabase.from('organization_qr_tokens').insert({
      organization_id: org.id,
      token,
      is_active: true,
      expires_at: null,
    })

    if (error) throw error
    return token
  },
  validateAccessToken: async (token: string): Promise<{ clinicIdentifier: string; clinicName: string }> => {
    const { data, error } = await supabase
      .from('organization_qr_tokens')
      .select('token, organization_id, is_active, organizations!inner(public_identifier, name)')
      .eq('token', token)
      .eq('is_active', true)
      .maybeSingle()

    if (error) throw error
    if (!data) {
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

    const { data: entries, error } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('organization_id', org.id)
      .order('joined_at', { ascending: true })

    if (error) throw error

    const mapped = (entries ?? []).map((entry) => ({
      id: entry.id,
      clinicId: org.id,
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

    const nowServing = mapped.find((entry) => entry.status === 'SERVING') ?? null
    const upNext = mapped.filter((entry) => entry.status === 'WAITING').slice(0, 5)
    const waitingCount = mapped.filter((entry) => entry.status === 'WAITING').length
    const servingCount = mapped.filter((entry) => entry.status === 'SERVING').length
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
      },
      nowServing,
      upNext,
      waitingCount,
      servingCount,
      completedCount,
      todayCount: mapped.length,
      entries: mapped,
    }
  },

  getEntry: async (clinicIdentifier: string, queueId: string): Promise<QueueEntry> => {
    const { data: org } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (!org) throw new Error('Clinic not found.')

    const { data, error } = await supabase
      .from('queue_entries')
      .select('*')
      .eq('organization_id', org.id)
      .eq('id', queueId)
      .single()

    if (error) throw error

    return {
      id: data.id,
      clinicId: data.organization_id,
      queueNumber: data.queue_number,
      studentId: data.student_id,
      studentName: data.full_name,
      course: data.course,
      yearLevel: data.year_level,
      purpose: data.purpose,
      status: data.status,
      joinedAt: data.joined_at,
      calledAt: data.called_at,
      servedAt: data.started_at ?? data.completed_at,
      peopleAhead: 0,
      estimatedWaitMinutes: null,
    }
  },

  join: async (clinicIdentifier: string, payload: JoinQueuePayload): Promise<QueueEntry> => {
    const { data: org, error: orgError } = await getOrgIdFromClinicIdentifier(clinicIdentifier)
    if (orgError) throw orgError
    if (!org) throw new Error('Clinic not found.')

    const today = new Date().toISOString().slice(0, 10)
    let { data: session, error: sessionError } = await supabase
      .from('queue_sessions')
      .select('*')
      .eq('organization_id', org.id)
      .eq('session_date', today)
      .maybeSingle()

    if (sessionError) throw sessionError

    if (!session) {
      const insert = await supabase
        .from('queue_sessions')
        .insert({ organization_id: org.id, session_date: today, queue_prefix: org.queue_prefix, next_number: 1, is_active: true })
        .select('*')
        .single()
      if (insert.error) throw insert.error
      session = insert.data
    }

    const nextNumber = (session.next_number ?? 1).toString().padStart(3, '0')
    const queueNumber = `${org.queue_prefix}${nextNumber}`

    const { data, error } = await supabase
      .from('queue_entries')
      .insert({
        organization_id: org.id,
        queue_session_id: session.id,
        queue_number: queueNumber,
        student_id: payload.studentId,
        full_name: payload.fullName,
        course: payload.course,
        year_level: payload.yearLevel,
        purpose: payload.purpose,
        status: 'WAITING',
      })
      .select('*')
      .single()

    if (error) throw error

    await supabase
      .from('queue_sessions')
      .update({ next_number: (session.next_number ?? 1) + 1, updated_at: new Date().toISOString() })
      .eq('id', session.id)

    return {
      id: data.id,
      clinicId: data.organization_id,
      queueNumber: data.queue_number,
      studentId: data.student_id,
      studentName: data.full_name,
      course: data.course,
      yearLevel: data.year_level,
      purpose: data.purpose,
      status: data.status,
      joinedAt: data.joined_at,
      calledAt: data.called_at,
      servedAt: data.started_at ?? data.completed_at,
      peopleAhead: 0,
      estimatedWaitMinutes: null,
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

    const { data, error } = await supabase
      .from('queue_entries')
      .update({ status: 'CALLED', called_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', waiting.id)
      .select('*')
      .single()

    if (error) throw error

    return {
      id: data.id,
      clinicId: data.organization_id,
      queueNumber: data.queue_number,
      studentId: data.student_id,
      studentName: data.full_name,
      course: data.course,
      yearLevel: data.year_level,
      purpose: data.purpose,
      status: data.status,
      joinedAt: data.joined_at,
      calledAt: data.called_at,
      servedAt: data.started_at ?? data.completed_at,
      peopleAhead: 0,
      estimatedWaitMinutes: null,
    }
  },

  updateStatus: async (queueId: string, action: 'call' | 'serve' | 'skip' | 'cancel' | 'recall') => {
    const map: Record<string, Partial<any>> = {
      call: { status: 'CALLED', called_at: new Date().toISOString() },
      serve: { status: 'SERVING', started_at: new Date().toISOString() },
      skip: { status: 'NO_SHOW', no_show_at: new Date().toISOString() },
      cancel: { status: 'CANCELLED', cancelled_at: new Date().toISOString() },
      recall: { status: 'WAITING', called_at: null },
    }

    const payload = map[action]
    if (!payload) throw new Error('Invalid action.')

    const { data, error } = await supabase
      .from('queue_entries')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', queueId)
      .select('*')
      .single()

    if (error) throw error

    return {
      id: data.id,
      clinicId: data.organization_id,
      queueNumber: data.queue_number,
      studentId: data.student_id,
      studentName: data.full_name,
      course: data.course,
      yearLevel: data.year_level,
      purpose: data.purpose,
      status: data.status,
      joinedAt: data.joined_at,
      calledAt: data.called_at,
      servedAt: data.started_at ?? data.completed_at,
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
      announcement: '',
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
      announcement: '',
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
  summary: async (_range: string) => {
    const { data, error } = await supabase.from('queue_entries').select('*')
    if (error) throw error

    const entries = data ?? []
    return {
      total: entries.length,
      completed: entries.filter((entry) => entry.status === 'COMPLETED').length,
      cancelled: entries.filter((entry) => entry.status === 'CANCELLED').length,
      noShow: entries.filter((entry) => entry.status === 'NO_SHOW').length,
      averageWaitMinutes: null,
      averageServiceMinutes: null,
      hourly: [],
      daily: [],
      purposes: [],
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
}
