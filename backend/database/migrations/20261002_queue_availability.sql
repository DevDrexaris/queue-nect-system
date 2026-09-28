-- Queue availability is scoped to the current active organization session.
-- Existing current-day active sessions remain OPEN; historical/inactive sessions
-- default to CLOSED. This migration does not create or delete queue sessions.
begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'queue_sessions'
      and column_name = 'admission_status'
  ) then
    alter table public.queue_sessions
      add column admission_status text not null default 'CLOSED';

    update public.queue_sessions
    set admission_status = 'OPEN'
    where is_active = true
      and session_date = current_date;
  end if;
end
$$;

alter table public.queue_sessions
  alter column admission_status set default 'CLOSED';

update public.queue_sessions
set admission_status = 'CLOSED'
where admission_status is null;

alter table public.queue_sessions
  alter column admission_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.queue_sessions'::regclass
      and conname = 'queue_sessions_admission_status_check'
  ) then
    alter table public.queue_sessions
      add constraint queue_sessions_admission_status_check
      check (admission_status in ('OPEN', 'PAUSED', 'CLOSED'));
  end if;
end
$$;

create or replace view public.public_queue_snapshot as
select
  o.public_identifier,
  o.name as organization_name,
  q.queue_number,
  q.status,
  q.joined_at,
  q.called_at,
  q.started_at,
  q.completed_at,
  q.updated_at
from public.queue_entries q
join public.organizations o on o.id = q.organization_id
where q.status in ('WAITING', 'CALLED', 'SERVING', 'AWAITING_RETURN')
  and o.is_active = true;

create or replace function public.get_queue_availability(p_public_identifier text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select qs.admission_status
    from public.organizations o
    join public.queue_sessions qs on qs.organization_id = o.id
    where o.public_identifier = p_public_identifier
      and o.is_active = true
      and qs.session_date = current_date
      and qs.is_active = true
    limit 1
  ), 'CLOSED');
$$;

revoke all on function public.get_queue_availability(text) from public;
grant execute on function public.get_queue_availability(text) to anon, authenticated;

create or replace function public.set_queue_availability(
  p_organization_id uuid,
  p_admission_status text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.queue_sessions%rowtype;
  v_previous_status text;
  v_action text;
  v_identifier text;
begin
  if p_admission_status is null or p_admission_status not in ('OPEN', 'PAUSED', 'CLOSED') then
    raise exception 'Invalid queue availability state';
  end if;

  if not (public.is_super_admin() or public.is_org_staff(p_organization_id)) then
    raise exception 'Not authorized to manage this queue';
  end if;

  select *
  into v_session
  from public.queue_sessions
  where organization_id = p_organization_id
    and session_date = current_date
    and is_active = true
  for update;

  if not found then
    raise exception 'No active queue session exists for today';
  end if;

  v_previous_status := v_session.admission_status;
  if v_previous_status = p_admission_status then
    return v_session.admission_status;
  end if;

  update public.queue_sessions
  set admission_status = p_admission_status,
      updated_at = now()
  where id = v_session.id;

  v_action := case p_admission_status
    when 'OPEN' then 'QUEUE_AVAILABILITY_OPENED'
    when 'PAUSED' then 'QUEUE_AVAILABILITY_PAUSED'
    when 'CLOSED' then 'QUEUE_AVAILABILITY_CLOSED'
  end;

  insert into public.activity_log (organization_id, performed_by, action, details)
  values (
    p_organization_id,
    auth.uid(),
    v_action,
    jsonb_build_object(
      'previous_state', v_previous_status,
      'new_state', p_admission_status,
      'queue_session_id', v_session.id
    )
  );

  select public_identifier
  into v_identifier
  from public.organizations
  where id = p_organization_id;

  if v_identifier is not null then
    perform realtime.send(
      jsonb_build_object(
        'event_type', 'queue_availability_changed',
        'availability', p_admission_status,
        'updated_at', now()
      ),
      'queue_changed',
      'public-queue:' || v_identifier,
      false
    );
  end if;

  return p_admission_status;
end;
$$;

revoke all on function public.set_queue_availability(uuid, text) from public;
grant execute on function public.set_queue_availability(uuid, text) to authenticated;

-- Preserve the existing secure QR join flow. The row lock serializes admission
-- against set_queue_availability: either the join commits before the state change,
-- or it observes PAUSED/CLOSED and is rejected without a partial entry.
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
  v_session public.queue_sessions%rowtype;
  v_entry public.queue_entries%rowtype;
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
    and o.is_active = true
    and t.token = p_qr_token
    and t.is_active = true
    and (t.expires_at is null or t.expires_at > now())
  limit 1;

  if not found then
    raise exception 'Queue access is invalid or expired';
  end if;

  select * into v_session
  from public.queue_sessions
  where organization_id = v_org.id
    and session_date = current_date
    and is_active = true
  for update;

  if not found then
    raise exception 'QUEUE_CLOSED';
  end if;

  if v_session.admission_status = 'PAUSED' then
    raise exception 'QUEUE_PAUSED';
  elsif v_session.admission_status <> 'OPEN' then
    raise exception 'QUEUE_CLOSED';
  end if;

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
  returning * into v_session;

  v_status_token := encode(gen_random_bytes(32), 'hex');

  insert into public.queue_entries (
    organization_id, queue_session_id, queue_number, student_id, full_name,
    course, year_level, purpose, status
  ) values (
    v_org.id, v_session.id,
    v_session.queue_prefix || lpad((v_session.next_number - 1)::text, 3, '0'),
    trim(p_student_id), trim(p_full_name), trim(p_course), trim(p_year_level), trim(p_purpose), 'WAITING'
  ) returning * into v_entry;

  insert into public.queue_status_tokens (queue_entry_id, token_hash)
  values (v_entry.id, encode(digest(convert_to(v_status_token, 'UTF8'), 'sha256'), 'hex'));

  insert into public.queue_presence (queue_entry_id, organization_id, queue_number, presence)
  values (v_entry.id, v_org.id, v_entry.queue_number, 'ONLINE');

  return jsonb_build_object('entry', to_jsonb(v_entry), 'status_token', v_status_token);
end;
$$;

revoke all on function public.join_queue_with_status_token(text, text, text, text, text, text, text) from public;
grant execute on function public.join_queue_with_status_token(text, text, text, text, text, text, text) to anon, authenticated;

commit;
