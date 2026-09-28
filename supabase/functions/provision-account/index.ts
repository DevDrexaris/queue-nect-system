import { createClient } from 'npm:@supabase/supabase-js@2'

const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ORG_ADMIN_ROLES = new Set(['ADMIN', 'ORG_ADMIN'])

type AccountCreationMode = 'temporary-password' | 'email-invitation'

function normalizeRole(value: unknown): 'ADMIN' | 'ORG_ADMIN' | 'STAFF' | 'SUPER_ADMIN' | null {
  if (value === 'SUPER_ADMIN' || value === 'ADMIN' || value === 'ORG_ADMIN' || value === 'STAFF') {
    return value
  }
  return null
}

function normalizeMode(value: unknown): AccountCreationMode | null {
  if (value === 'temporary-password' || value === 'email-invitation') {
    return value
  }
  return null
}

function hasStrongPassword(value: string): boolean {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value)
}

function resolveInvitationRedirectUrl(): string | null {
  const configured = Deno.env.get('APP_REDIRECT_URL')
    ?? Deno.env.get('SITE_URL')
    ?? Deno.env.get('PUBLIC_SITE_URL')
    ?? null

  if (!configured) return null
  return configured.trim()
}

function parseJsonBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body is required.')
  }
  return body as Record<string, unknown>
}

function reject(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: responseHeaders })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: responseHeaders })
  }

  if (request.method !== 'POST') {
    return reject('Method not allowed', 405)
  }

  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reject('Missing bearer token.', 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return reject('Server is not configured for account provisioning.', 500)
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) {
    return reject('Your session is invalid or expired.', 401)
  }

  const callerId = userData.user.id
  const { data: callerProfile, error: callerProfileError } = await userClient
    .from('profiles')
    .select('id, role, organization_id, is_active')
    .eq('id', callerId)
    .maybeSingle()

  if (callerProfileError || !callerProfile) {
    return reject('Authenticated profile not found.', 403)
  }

  if (!callerProfile.is_active) {
    return reject('Your account is inactive.', 403)
  }

  let body: Record<string, unknown>
  try {
    body = parseJsonBody(await request.json())
  } catch {
    return reject('Request body is required.', 400)
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const creationMode = normalizeMode(body.mode) ?? 'temporary-password'
  const targetRole = normalizeRole(body.role)
  const targetOrganizationId = typeof body.organizationId === 'string' ? body.organizationId : null
  const targetLocationId = typeof body.locationId === 'string' ? body.locationId : null
  const targetQueueId = typeof body.queueId === 'string' ? body.queueId : null

  if (!name || !email) {
    return reject('Name and email are required.', 400)
  }

  if (creationMode === 'temporary-password') {
    if (!password) {
      return reject('A temporary password is required.', 400)
    }

    if (!hasStrongPassword(password)) {
      return reject('Temporary password must be at least 8 characters and include a letter and a number.', 400)
    }
  }

  if (!targetRole) {
    return reject('A valid account role is required.', 400)
  }

  const isCallerSuperAdmin = callerProfile.role === 'SUPER_ADMIN'
  const isCallerOrgAdmin = ORG_ADMIN_ROLES.has(callerProfile.role)
  const isCallerStaff = callerProfile.role === 'STAFF'

  if (isCallerStaff) {
    return reject('Staff accounts cannot manage other accounts.', 403)
  }

  let finalOrganizationId: string | null = targetOrganizationId
  let finalLocationId: string | null = targetLocationId
  let finalQueueId: string | null = targetQueueId

  if (targetRole === 'SUPER_ADMIN') {
    if (!isCallerSuperAdmin) {
      return reject('Only a super administrator can create super administrator accounts.', 403)
    }
  } else if (targetRole === 'ADMIN' || targetRole === 'ORG_ADMIN') {
    if (!isCallerSuperAdmin) {
      return reject('Only a super administrator can create organization administrator accounts.', 403)
    }
    if (!finalOrganizationId) {
      return reject('Organization is required for organization administrator accounts.', 400)
    }
  } else if (targetRole === 'STAFF') {
    if (isCallerSuperAdmin) {
      if (!finalOrganizationId) {
        return reject('Organization is required for staff accounts.', 400)
      }
    } else if (isCallerOrgAdmin) {
      if (callerProfile.organization_id == null) {
        return reject('Your organization assignment is missing.', 403)
      }
      finalOrganizationId = callerProfile.organization_id
    } else {
      return reject('Only super administrators or organization administrators can create staff accounts.', 403)
    }
  }

  if (!finalOrganizationId) {
    return reject('Organization selection is required.', 400)
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .select('id, is_active')
    .eq('id', finalOrganizationId)
    .maybeSingle()

  if (orgError || !org || org.is_active !== true) {
    return reject('The selected organization is unavailable.', 400)
  }

  if (isCallerOrgAdmin && callerProfile.organization_id !== finalOrganizationId) {
    return reject('Organization administrators can only manage their own organization.', 403)
  }

  if (finalLocationId) {
    const { data: location, error: locationError } = await supabaseAdmin
      .from('organization_locations')
      .select('id, organization_id, is_active')
      .eq('id', finalLocationId)
      .maybeSingle()

    if (locationError || !location || location.organization_id !== finalOrganizationId || location.is_active !== true) {
      return reject('The selected location does not belong to the chosen organization.', 400)
    }
  }

  if (finalQueueId) {
    const { data: queue, error: queueError } = await supabaseAdmin
      .from('organization_queues')
      .select('id, organization_id, location_id, is_active')
      .eq('id', finalQueueId)
      .maybeSingle()

    if (queueError || !queue || queue.organization_id !== finalOrganizationId || queue.is_active !== true) {
      return reject('The selected queue does not belong to the chosen organization.', 400)
    }

    if (finalLocationId && queue.location_id !== finalLocationId) {
      return reject('The selected queue must belong to the selected location.', 400)
    }
  }

  const duplicateCheck = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const duplicateUser = duplicateCheck.data.users.find((candidate) => candidate.email?.toLowerCase() === email)
  if (duplicateUser) {
    return reject('An account for this email already exists.', 409)
  }

  let createdUserId: string | null = null
  let methodLabel = 'temporary-password'

  if (creationMode === 'temporary-password') {
    const { data: createdUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: name,
      },
    })

    if (createUserError || !createdUser?.user) {
      return reject(createUserError?.message ?? 'Unable to create the account.', 400)
    }

    createdUserId = createdUser.user.id
  } else {
    const invitationRedirectUrl = resolveInvitationRedirectUrl()
    if (!invitationRedirectUrl) {
      return reject('Invitation redirect URL is not configured for this environment.', 500)
    }

    const { data: invitedUser, error: inviteUserError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: name,
      },
      redirectTo: invitationRedirectUrl,
    })

    if (inviteUserError || !invitedUser?.user) {
      return reject(inviteUserError?.message ?? 'Unable to send invitation.', 400)
    }

    createdUserId = invitedUser.user.id
    methodLabel = 'email-invitation'
  }

  const safeRole: 'ADMIN' | 'ORG_ADMIN' | 'STAFF' = targetRole === 'SUPER_ADMIN' ? 'ADMIN' : targetRole

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .upsert({
      id: createdUserId,
      organization_id: finalOrganizationId,
      full_name: name,
      email,
      role: safeRole,
      is_active: true,
      location_id: finalLocationId,
      queue_id: finalQueueId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

  if (profileError) {
    if (createdUserId) {
      await supabaseAdmin.auth.admin.deleteUser(createdUserId)
    }
    return reject(profileError.message || 'Account profile could not be created.', 500)
  }

  return Response.json({
    success: true,
    method: methodLabel,
    user: {
      id: createdUserId,
      email,
      role: safeRole,
      organizationId: finalOrganizationId,
      locationId: finalLocationId,
      queueId: finalQueueId,
    },
  }, { headers: responseHeaders })
})
