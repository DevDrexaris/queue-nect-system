-- Explicit per-queue session lifecycle. Apply after 20261006_staff_queue_scope_analytics_realtime.sql.
-- Uses PostgreSQL current_date, matching existing database lifecycle RPCs; frontend date prechecks must not override it.
begin;

-- Public queue details expose only non-sensitive session state for the bound active queue.
create or replace function public.get_public_queue_details(
  p_public_identifier text,
  p_queue_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'queueId', q.id,
    'queueName', q.name,
    'locationName', l.name,
    'queuePrefix', q.queue_prefix,
    'serviceArea', q.service_area,
    'availability', q.admission_status,
    'sessionDate', current_date,
    'sessionId', s.id,
    'sessionStatus', case
      when s.id is null then 'NOT_STARTED'
      when s.is_active then 'ACTIVE'
      else 'ENDED'
    end
  )
  from public.organizations o
  join public.organization_queues q on q.organization_id = o.id
  join public.organization_locations l on l.id = q.location_id and l.organization_id = o.id
  left join public.queue_sessions s
    on s.organization_id = o.id
    and s.queue_id = q.id
    and s.session_date = current_date
  where o.public_identifier = p_public_identifier
    and o.is_active
    and q.id = p_queue_id
    and q.is_active
    and l.is_active
  limit 1;
$$;

create or replace function public.get_organization_queue_session_states(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_admin_scope boolean;
begin
  if p_organization_id is null then
    raise exception 'Organization is required to view queue sessions';
  end if;

  if not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'Organization not found';
  end if;

  v_admin_scope := public.is_super_admin() or public.is_org_admin(p_organization_id);
  if not v_admin_scope and not public.is_org_staff(p_organization_id) then
    raise exception 'Not authorized to view queue sessions for this organization';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'queueId', q.id,
    'sessionId', s.id,
    'sessionDate', current_date,
    'sessionStatus', case
      when s.id is null then 'NOT_STARTED'
      when s.is_active then 'ACTIVE'
      else 'ENDED'
    end
  ) order by q.name), '[]'::jsonb)
  into v_result
  from public.organization_queues q
  left join public.queue_sessions s
    on s.organization_id = q.organization_id
    and s.queue_id = q.id
    and s.session_date = current_date
  where q.organization_id = p_organization_id
    and q.is_active
    and (
      v_admin_scope
      or public.can_manage_organization_queue(p_organization_id, q.id)
    );

  return v_result;
end;
$$;

-- Append the active session link to the PII-free public snapshot. Keep all
-- existing view columns and grants; the public consumer uses only queue state.
create or replace view public.public_queue_snapshot as
select
  o.public_identifier,
  o.name as organization_name,
  q.queue_id,
  oq.public_identifier as queue_identifier,
  l.name as location_name,
  oq.name as queue_name,
  q.queue_number,
  q.status,
  q.joined_at,
  q.called_at,
  q.started_at,
  q.completed_at,
  q.updated_at,
  q.queue_session_id
from public.queue_entries q
join public.organizations o on o.id = q.organization_id
left join public.organization_queues oq on oq.id = q.queue_id
left join public.organization_locations l on l.id = oq.location_id
where q.status in ('WAITING', 'CALLED', 'SERVING', 'AWAITING_RETURN')
  and o.is_active
  and (oq.id is null or oq.is_active);

create or replace function public.start_organization_queue_session(p_queue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.organization_queues%rowtype;
  v_session public.queue_sessions%rowtype;
  v_resumed boolean := false;
begin
  select * into v_queue
  from public.organization_queues
  where id = p_queue_id
  for update;

  if not found or not v_queue.is_active
     or not public.can_manage_organization_queue(v_queue.organization_id, v_queue.id) then
    raise exception 'Queue not found or not authorized to start its session';
  end if;

  select * into v_session
  from public.queue_sessions
  where organization_id = v_queue.organization_id
    and queue_id = v_queue.id
    and session_date = current_date
  for update;

  if found and v_session.is_active then
    return jsonb_build_object(
      'sessionId', v_session.id,
      'sessionDate', v_session.session_date,
      'sessionStatus', 'ACTIVE',
      'availability', v_session.admission_status,
      'resumed', false
    );
  elsif found then
    -- One session row is allowed per queue/date. Resume it without resetting its counter.
    update public.queue_sessions
    set is_active = true,
        admission_status = v_queue.admission_status,
        updated_at = now()
    where id = v_session.id
    returning * into v_session;
    v_resumed := true;
  else
    insert into public.queue_sessions (
      organization_id, queue_id, session_date, queue_prefix, next_number, is_active, admission_status
    ) values (
      v_queue.organization_id, v_queue.id, current_date,
      v_queue.queue_prefix, 1, true, v_queue.admission_status
    ) returning * into v_session;
  end if;

  insert into public.activity_log (organization_id, queue_id, performed_by, action, details)
  values (
    v_queue.organization_id,
    v_queue.id,
    auth.uid(),
    'QUEUE_SESSION_STARTED',
    jsonb_build_object('queue_id', v_queue.id, 'session_id', v_session.id,
      'session_date', v_session.session_date, 'resumed', v_resumed)
  );

  perform realtime.send(
    jsonb_build_object('event_type', 'queue_session_changed', 'queue_id', v_queue.id,
      'session_status', 'ACTIVE', 'session_date', v_session.session_date, 'updated_at', now()),
    'queue_changed',
    'public-queue:' || (select public_identifier from public.organizations where id = v_queue.organization_id),
    false
  );

  return jsonb_build_object(
    'sessionId', v_session.id,
    'sessionDate', v_session.session_date,
    'sessionStatus', 'ACTIVE',
    'availability', v_session.admission_status,
    'resumed', v_resumed
  );
end;
$$;

-- Registration no longer silently starts a session. Availability and session lifecycle
-- remain separate: both queue and active session must allow admission.
create or replace function public.join_queue_with_status_token(
  p_public_identifier text,
  p_qr_token text,
  p_student_id text,
  p_full_name text,
  p_course text,
  p_year_level text,
  p_purpose text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org public.organizations%rowtype;
  v_queue public.organization_queues%rowtype;
  v_session public.queue_sessions%rowtype;
  v_entry public.queue_entries%rowtype;
  v_next integer;
  v_status_token text;
begin
  if nullif(trim(p_student_id), '') is null
     or nullif(trim(p_full_name), '') is null
     or nullif(trim(p_course), '') is null
     or nullif(trim(p_year_level), '') is null
     or nullif(trim(p_purpose), '') is null then
    raise exception 'All queue details are required';
  end if;

  select o.* into v_org
  from public.organizations o
  join public.organization_qr_tokens t on t.organization_id = o.id
  where o.public_identifier = p_public_identifier
    and o.is_active
    and t.token = p_qr_token
    and t.is_active
    and (t.expires_at is null or t.expires_at > now())
  limit 1;
  if not found then raise exception 'Queue access is invalid or expired'; end if;

  select q.* into v_queue
  from public.organization_qr_tokens t
  join public.organization_queues q on q.id = t.queue_id and q.organization_id = t.organization_id
  join public.organization_locations l on l.id = q.location_id and l.organization_id = q.organization_id
  where t.organization_id = v_org.id
    and t.token = p_qr_token
    and t.is_active
    and (t.expires_at is null or t.expires_at > now())
    and q.is_active
    and l.is_active
  for update of q;
  if not found then raise exception 'QUEUE_CLOSED'; end if;
  if v_queue.admission_status = 'PAUSED' then raise exception 'QUEUE_PAUSED'; end if;
  if v_queue.admission_status <> 'OPEN' then raise exception 'QUEUE_CLOSED'; end if;

  select * into v_session
  from public.queue_sessions
  where organization_id = v_org.id
    and queue_id = v_queue.id
    and session_date = current_date
  for update;

  if not found then raise exception 'SESSION_NOT_STARTED'; end if;
  if not v_session.is_active then raise exception 'SESSION_ENDED'; end if;
  if v_session.admission_status = 'PAUSED' then raise exception 'QUEUE_PAUSED'; end if;
  if v_session.admission_status <> 'OPEN' then raise exception 'QUEUE_CLOSED'; end if;

  if exists (
    select 1 from public.queue_entries q
    where q.queue_session_id = v_session.id
      and q.student_id = trim(p_student_id)
      and q.status in ('WAITING', 'CALLED', 'SERVING')
  ) then
    raise exception 'You already have an active queue entry for this session';
  end if;

  update public.queue_sessions
  set next_number = next_number + 1, updated_at = now()
  where id = v_session.id
  returning next_number - 1 into v_next;

  v_status_token := encode(gen_random_bytes(32), 'hex');
  insert into public.queue_entries (
    organization_id, queue_session_id, queue_id, queue_number, student_id,
    full_name, course, year_level, purpose, status, registration_source
  ) values (
    v_org.id, v_session.id, v_queue.id,
    v_queue.queue_prefix || lpad(v_next::text, 3, '0'),
    trim(p_student_id), trim(p_full_name), trim(p_course), trim(p_year_level), trim(p_purpose), 'WAITING', 'QR'
  ) returning * into v_entry;

  insert into public.queue_status_tokens (queue_entry_id, token_hash)
  values (v_entry.id, encode(digest(convert_to(v_status_token, 'UTF8'), 'sha256'), 'hex'));
  insert into public.queue_presence (queue_entry_id, organization_id, queue_number, presence)
  values (v_entry.id, v_org.id, v_entry.queue_number, 'ONLINE');

  return jsonb_build_object('entry', to_jsonb(v_entry), 'status_token', v_status_token);
end;
$$;

create or replace function public.register_walk_in_for_queue(
  p_queue_id uuid,
  p_full_name text,
  p_reference_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.organization_queues%rowtype;
  v_session public.queue_sessions%rowtype;
  v_entry public.queue_entries%rowtype;
  v_next integer;
begin
  select * into v_queue from public.organization_queues where id = p_queue_id for update;
  if not found or not v_queue.is_active
     or not public.can_manage_organization_queue(v_queue.organization_id, v_queue.id) then
    raise exception 'Queue not found or not authorized';
  end if;
  if nullif(trim(p_full_name), '') is null then raise exception 'Patient name is required'; end if;
  if v_queue.admission_status <> 'OPEN' then raise exception 'Queue is not open for new registrations'; end if;

  select * into v_session
  from public.queue_sessions
  where organization_id = v_queue.organization_id
    and queue_id = v_queue.id
    and session_date = current_date
  for update;
  if not found then raise exception 'SESSION_NOT_STARTED'; end if;
  if not v_session.is_active then raise exception 'SESSION_ENDED'; end if;
  if v_session.admission_status <> 'OPEN' then raise exception 'Queue is not open for new registrations'; end if;

  update public.queue_sessions
  set next_number = next_number + 1, updated_at = now()
  where id = v_session.id
  returning next_number - 1 into v_next;

  insert into public.queue_entries (
    organization_id, queue_session_id, queue_id, queue_number, student_id,
    full_name, course, year_level, purpose, status, registration_source
  ) values (
    v_queue.organization_id, v_session.id, v_queue.id,
    v_queue.queue_prefix || lpad(v_next::text, 3, '0'),
    coalesce(nullif(trim(p_reference_id), ''), 'WALKIN-' || gen_random_uuid()::text),
    trim(p_full_name), 'Not provided', 'Not provided', 'Walk-in registration', 'WAITING', 'WALK_IN'
  ) returning * into v_entry;

  return jsonb_build_object('entry', to_jsonb(v_entry));
end;
$$;

revoke all on function public.start_organization_queue_session(uuid) from public;
revoke all on function public.get_organization_queue_session_states(uuid) from public;
revoke all on function public.get_public_queue_details(text, uuid) from public;
revoke all on function public.join_queue_with_status_token(text, text, text, text, text, text, text) from public;
revoke all on function public.register_walk_in_for_queue(uuid, text, text) from public;

grant execute on function public.start_organization_queue_session(uuid) to authenticated;
grant execute on function public.get_organization_queue_session_states(uuid) to authenticated;
grant execute on function public.get_public_queue_details(text, uuid) to anon, authenticated;
grant execute on function public.join_queue_with_status_token(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.register_walk_in_for_queue(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

-- Read-only post-apply checks.
select case when to_regprocedure('public.start_organization_queue_session(uuid)') is not null then 'PASS' else 'FAIL' end as start_session_rpc_exists;
select case when to_regprocedure('public.get_organization_queue_session_states(uuid)') is not null then 'PASS' else 'FAIL' end as session_state_rpc_exists;
select case when to_regprocedure('public.get_public_queue_details(text,uuid)') is not null then 'PASS' else 'FAIL' end as public_queue_details_session_state_rpc_exists;
select case
  when to_regprocedure('public.start_organization_queue_session(uuid)') is null then 'FAIL'
  when has_function_privilege('authenticated', to_regprocedure('public.start_organization_queue_session(uuid)'), 'EXECUTE')
   and not has_function_privilege('anon', to_regprocedure('public.start_organization_queue_session(uuid)'), 'EXECUTE') then 'PASS'
  else 'FAIL'
end as start_session_rpc_grants;
select case
  when to_regprocedure('public.get_organization_queue_session_states(uuid)') is null then 'FAIL'
  when has_function_privilege('authenticated', to_regprocedure('public.get_organization_queue_session_states(uuid)'), 'EXECUTE')
   and not has_function_privilege('anon', to_regprocedure('public.get_organization_queue_session_states(uuid)'), 'EXECUTE') then 'PASS'
  else 'FAIL'
end as session_state_rpc_grants;
select case when has_function_privilege('anon', 'public.join_queue_with_status_token(text,text,text,text,text,text,text)', 'EXECUTE') then 'PASS' else 'FAIL' end as public_join_rpc_preserved;

commit;
