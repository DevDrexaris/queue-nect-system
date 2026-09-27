begin;

alter table public.queue_entries
  add column if not exists cancellation_source text
    check (cancellation_source in ('STUDENT', 'ADMIN')),
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;

create table if not exists public.queue_status_tokens (
  queue_entry_id uuid primary key references public.queue_entries(id) on delete cascade,
  token_hash text not null unique,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.queue_presence (
  queue_entry_id uuid primary key references public.queue_entries(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  queue_number text not null,
  presence text not null check (presence in ('ONLINE', 'IDLE', 'BACKGROUND', 'OFFLINE')),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists queue_presence_org_last_seen_idx
  on public.queue_presence (organization_id, last_seen_at desc);

alter table public.queue_status_tokens enable row level security;
alter table public.queue_presence enable row level security;

revoke all on public.queue_status_tokens from public, anon, authenticated;
revoke all on public.queue_presence from public, anon, authenticated;
revoke all on public.queue_entries from public, anon;
revoke insert, update, delete on public.queue_entries from authenticated;
grant select on public.queue_presence to authenticated;
grant select on public.public_queue_snapshot to anon, authenticated;
grant select on public.queue_entries to authenticated;

drop policy if exists "Public can view active queue entries for display" on public.queue_entries;
drop policy if exists "Public can join an active queue with valid clinic access" on public.queue_entries;
drop policy if exists "Org staff can manage org queue entries" on public.queue_entries;
drop policy if exists "Org staff can reset the active queue for their org" on public.queue_entries;
drop policy if exists "Org staff can view queue entries for their org" on public.queue_entries;
drop policy if exists "Org staff can delete terminal queue entries" on public.queue_entries;

create policy "Org staff can view queue entries for their org"
on public.queue_entries
for select
using (public.is_super_admin() or public.is_org_staff(organization_id));

update public.queue_entries
set cancellation_source = 'ADMIN'
where status = 'CANCELLED' and cancellation_source is null;

drop policy if exists "Org staff can manage activity log for their org" on public.activity_log;
drop policy if exists "Org staff can view activity log for their org" on public.activity_log;
create policy "Org staff can view activity log for their org"
on public.activity_log
for select
using (public.is_super_admin() or public.is_org_staff(organization_id));

drop policy if exists "Org staff can view presence for their org" on public.queue_presence;
create or replace function public.can_receive_student_queue_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.queue_status_tokens t
    join public.queue_entries q on q.id = t.queue_entry_id
    where p_topic = 'student-queue:' || t.token_hash
      and (
        (t.revoked_at is null and q.status in ('WAITING', 'CALLED', 'SERVING'))
        or q.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW')
      )
  );
$$;

revoke all on function public.can_receive_student_queue_topic(text) from public;
grant execute on function public.can_receive_student_queue_topic(text) to anon, authenticated;

drop policy if exists "Student can receive their private queue events" on realtime.messages;
create policy "Student can receive their private queue events"
on realtime.messages
for select
to anon, authenticated
using (public.can_receive_student_queue_topic(realtime.topic()));

create policy "Org staff can view presence for their org"
on public.queue_presence
for select
using (public.is_super_admin() or public.is_org_staff(organization_id));

create or replace function public.enforce_queue_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.queue_number is distinct from old.queue_number
     or new.queue_session_id is distinct from old.queue_session_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'Queue identity and number are immutable';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW') then
    raise exception 'Terminal queue states cannot be reopened';
  end if;

  if not (
    (old.status = 'WAITING' and new.status in ('CALLED', 'CANCELLED', 'NO_SHOW'))
    or (old.status = 'CALLED' and new.status in ('SERVING', 'WAITING', 'CANCELLED', 'NO_SHOW'))
    or (old.status = 'SERVING' and new.status in ('COMPLETED', 'CANCELLED'))
  ) then
    raise exception 'Invalid queue transition: % -> %', old.status, new.status;
  end if;

  if new.status = 'CALLED' then
    new.called_at := now();
  elsif new.status = 'SERVING' then
    new.started_at := now();
  elsif new.status = 'COMPLETED' then
    new.completed_at := now();
  elsif new.status = 'NO_SHOW' then
    new.no_show_at := now();
  elsif new.status = 'CANCELLED' then
    if new.cancellation_source is null or new.cancellation_source not in ('STUDENT', 'ADMIN') then
      raise exception 'Cancellation source is required';
    end if;
    new.cancelled_at := now();
    if new.cancellation_source = 'ADMIN' then
      new.cancelled_by := auth.uid();
    else
      new.cancelled_by := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists queue_entries_enforce_status_transition on public.queue_entries;
create trigger queue_entries_enforce_status_transition
before update on public.queue_entries
for each row execute function public.enforce_queue_status_transition();

drop trigger if exists queue_entries_after_insert_bump_next_number on public.queue_entries;

create or replace function public.log_queue_activity_and_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_action text;
  v_identifier text;
  v_token_hash text;
  v_source text;
begin
  if tg_op = 'INSERT' then
    v_action := 'QUEUE_JOINED';
  elsif new.status = 'WAITING' and old.status = 'CALLED' then
    v_action := 'QUEUE_RETURNED_TO_WAITING';
  elsif new.status is distinct from old.status then
    v_action := case new.status
      when 'CALLED' then 'QUEUE_CALLED'
      when 'SERVING' then 'QUEUE_SERVING'
      when 'COMPLETED' then 'QUEUE_COMPLETED'
      when 'CANCELLED' then case new.cancellation_source
        when 'STUDENT' then 'QUEUE_CANCELLED_BY_STUDENT'
        else 'QUEUE_CANCELLED_BY_ADMIN'
      end
      when 'NO_SHOW' then 'QUEUE_NO_SHOW'
      else null
    end;
  end if;

  if v_action is null then
    return new;
  end if;

  v_source := case when new.status = 'CANCELLED' then new.cancellation_source else null end;
  insert into public.activity_log (organization_id, performed_by, action, details)
  values (
    new.organization_id,
    case when v_source = 'STUDENT' then null else auth.uid() end,
    v_action,
    jsonb_build_object('queue_number', new.queue_number, 'status', new.status, 'source', v_source)
  );

  select public_identifier into v_identifier
  from public.organizations
  where id = new.organization_id;

  if v_identifier is not null then
    perform realtime.send(
      jsonb_build_object('queue_number', new.queue_number, 'status', new.status),
      'queue_changed',
      'public-queue:' || v_identifier,
      false
    );
  end if;

  select token_hash into v_token_hash
  from public.queue_status_tokens
  where queue_entry_id = new.id;

  if v_token_hash is not null then
    perform realtime.send(
      jsonb_build_object('queue_number', new.queue_number, 'status', new.status, 'cancellation_source', v_source),
      'queue_status_changed',
      'student-queue:' || v_token_hash,
      true
    );
  end if;

  if new.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW') then
    update public.queue_status_tokens
    set revoked_at = coalesce(revoked_at, now())
    where queue_entry_id = new.id;
    update public.queue_presence
    set presence = 'OFFLINE', updated_at = now()
    where queue_entry_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists queue_entries_activity_broadcast on public.queue_entries;
create trigger queue_entries_activity_broadcast
after insert or update on public.queue_entries
for each row execute function public.log_queue_activity_and_broadcast();

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
    raise exception 'This clinic queue is not open';
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

create or replace function public.get_student_queue_entry(p_status_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entry public.queue_entries%rowtype;
  v_revoked_at timestamptz;
  v_people_ahead integer;
begin
  select t.revoked_at into v_revoked_at
  from public.queue_status_tokens t
  where t.token_hash = encode(digest(convert_to(p_status_token, 'UTF8'), 'sha256'), 'hex');

  if not found then
    raise exception 'Queue access is invalid or expired';
  end if;

  select q.* into v_entry
  from public.queue_status_tokens t
  join public.queue_entries q on q.id = t.queue_entry_id
  where t.token_hash = encode(digest(convert_to(p_status_token, 'UTF8'), 'sha256'), 'hex');

  if not found then
    raise exception 'Queue access is invalid or expired';
  end if;
  if v_revoked_at is not null and v_entry.status not in ('COMPLETED', 'CANCELLED', 'NO_SHOW') then
    raise exception 'Queue access is no longer active';
  end if;

  select count(*)::integer into v_people_ahead
  from public.queue_entries q
  where q.queue_session_id = v_entry.queue_session_id
    and q.status in ('WAITING', 'CALLED', 'SERVING')
    and q.joined_at < v_entry.joined_at;

  return jsonb_build_object(
    'entry', to_jsonb(v_entry),
    'people_ahead', coalesce(v_people_ahead, 0),
    'presence', (select p.presence from public.queue_presence p where p.queue_entry_id = v_entry.id)
  );
end;
$$;

create or replace function public.exchange_legacy_queue_ticket(
  p_queue_entry_id uuid,
  p_queue_number text,
  p_public_identifier text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entry public.queue_entries%rowtype;
  v_existing_hash text;
  v_status_token text;
begin
  select q.* into v_entry
  from public.queue_entries q
  join public.organizations o on o.id = q.organization_id
  where q.id = p_queue_entry_id
    and q.queue_number = p_queue_number
    and o.public_identifier = p_public_identifier
    and q.status in ('WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'CANCELLED', 'NO_SHOW')
  for update of q;

  if not found then raise exception 'Queue access is invalid or no longer active'; end if;

  select token_hash into v_existing_hash
  from public.queue_status_tokens
  where queue_entry_id = v_entry.id
  for update;
  if v_existing_hash is not null then
    raise exception 'This queue ticket has already been upgraded; reload the ticket page';
  end if;

  v_status_token := encode(gen_random_bytes(32), 'hex');
  insert into public.queue_status_tokens (queue_entry_id, token_hash, revoked_at)
  values (
    v_entry.id,
    encode(digest(convert_to(v_status_token, 'UTF8'), 'sha256'), 'hex'),
    case when v_entry.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW') then now() else null end
  );

  insert into public.queue_presence (queue_entry_id, organization_id, queue_number, presence)
  values (
    v_entry.id, v_entry.organization_id, v_entry.queue_number,
    case when v_entry.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW') then 'OFFLINE' else 'ONLINE' end
  )
  on conflict (queue_entry_id) do nothing;

  return v_status_token;
end;
$$;

create or replace function public.cancel_student_queue(p_status_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entry public.queue_entries%rowtype;
  v_revoked_at timestamptz;
begin
  select q.* into v_entry
  from public.queue_status_tokens t
  join public.queue_entries q on q.id = t.queue_entry_id
  where t.token_hash = encode(digest(convert_to(p_status_token, 'UTF8'), 'sha256'), 'hex')
  for update of q, t;

  if not found then
    raise exception 'Queue access is invalid or no longer active';
  end if;
  select t.revoked_at into v_revoked_at
  from public.queue_status_tokens t
  where t.queue_entry_id = v_entry.id;
  if v_revoked_at is not null then
    raise exception 'Queue access is invalid or no longer active';
  end if;
  if v_entry.status not in ('WAITING', 'CALLED') then
    raise exception 'This queue can no longer be cancelled';
  end if;

  update public.queue_entries
  set status = 'CANCELLED', cancellation_source = 'STUDENT'
  where id = v_entry.id
  returning * into v_entry;

  return to_jsonb(v_entry);
end;
$$;

create or replace function public.update_student_queue_presence(p_status_token text, p_presence text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entry public.queue_entries%rowtype;
  v_old_presence text;
  v_action text;
begin
  if p_presence not in ('ONLINE', 'IDLE', 'BACKGROUND', 'OFFLINE') then
    raise exception 'Invalid presence state';
  end if;

  select q.* into v_entry
  from public.queue_status_tokens t
  join public.queue_entries q on q.id = t.queue_entry_id
  where t.token_hash = encode(digest(convert_to(p_status_token, 'UTF8'), 'sha256'), 'hex')
    and t.revoked_at is null
    and q.status in ('WAITING', 'CALLED', 'SERVING')
  for update of q;

  if not found then
    raise exception 'Queue access is invalid or no longer active';
  end if;

  select case when last_seen_at < now() - interval '90 seconds' then 'OFFLINE' else presence end
  into v_old_presence
  from public.queue_presence
  where queue_entry_id = v_entry.id
  for update;

  insert into public.queue_presence (queue_entry_id, organization_id, queue_number, presence, last_seen_at, updated_at)
  values (v_entry.id, v_entry.organization_id, v_entry.queue_number, p_presence, now(), now())
  on conflict (queue_entry_id) do update
    set presence = excluded.presence, last_seen_at = now(), updated_at = now();

  if v_old_presence is distinct from p_presence then
    v_action := case
      when p_presence = 'BACKGROUND' then 'STUDENT_BACKGROUND'
      when p_presence = 'IDLE' then 'STUDENT_IDLE'
      when p_presence = 'OFFLINE' then 'STUDENT_OFFLINE'
      when v_old_presence in ('BACKGROUND', 'IDLE', 'OFFLINE') then 'STUDENT_RETURNED'
      else 'STUDENT_ONLINE'
    end;

    insert into public.activity_log (organization_id, action, details)
    values (v_entry.organization_id, v_action,
      jsonb_build_object('queue_number', v_entry.queue_number, 'presence', p_presence));
  end if;

  return true;
end;
$$;

create or replace function public.transition_queue_entry(p_queue_entry_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.queue_entries%rowtype;
begin
  select * into v_entry
  from public.queue_entries
  where id = p_queue_entry_id
  for update;

  if not found or not (public.is_super_admin() or public.is_org_staff(v_entry.organization_id)) then
    raise exception 'Queue entry not found';
  end if;

  perform 1 from public.queue_sessions where id = v_entry.queue_session_id for update;

  if p_action = 'call' then
    if v_entry.status <> 'WAITING' then raise exception 'Only waiting entries can be called'; end if;
    if exists (select 1 from public.queue_entries q where q.organization_id = v_entry.organization_id and q.status in ('CALLED', 'SERVING') and q.id <> v_entry.id) then
      raise exception 'Finish the active call before calling another number';
    end if;
    update public.queue_entries set status = 'CALLED' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'return_to_waiting' and v_entry.status = 'CALLED' then
    update public.queue_entries set status = 'WAITING', called_at = null where id = v_entry.id returning * into v_entry;
  elsif p_action = 'serve' and v_entry.status = 'CALLED' then
    if exists (select 1 from public.queue_entries q where q.organization_id = v_entry.organization_id and q.status = 'SERVING' and q.id <> v_entry.id) then
      raise exception 'Another number is already being served';
    end if;
    update public.queue_entries set status = 'SERVING' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'complete' and v_entry.status = 'SERVING' then
    update public.queue_entries set status = 'COMPLETED' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'skip' and v_entry.status in ('WAITING', 'CALLED') then
    update public.queue_entries set status = 'NO_SHOW' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'cancel' and v_entry.status in ('WAITING', 'CALLED', 'SERVING') then
    update public.queue_entries
    set status = 'CANCELLED', cancellation_source = 'ADMIN'
    where id = v_entry.id returning * into v_entry;
  else
    raise exception 'Action is not allowed for the current queue state';
  end if;

  return to_jsonb(v_entry);
end;
$$;

create or replace function public.reset_queue_session(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.queue_sessions%rowtype;
  v_count integer;
begin
  if not (public.is_super_admin() or public.is_org_staff(p_organization_id)) then
    raise exception 'Not authorized to reset this queue';
  end if;

  select * into v_session
  from public.queue_sessions
  where organization_id = p_organization_id and session_date = current_date and is_active = true
  for update;
  if not found then raise exception 'There is no active queue session to reset'; end if;
  if exists (select 1 from public.queue_entries where queue_session_id = v_session.id and status = 'SERVING') then
    raise exception 'Finish service before resetting the queue';
  end if;

  update public.queue_entries
  set status = 'CANCELLED', cancellation_source = 'ADMIN'
  where queue_session_id = v_session.id and status in ('WAITING', 'CALLED');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.join_queue_with_status_token(text, text, text, text, text, text, text) from public;
revoke all on function public.get_student_queue_entry(text) from public;
revoke all on function public.exchange_legacy_queue_ticket(uuid, text, text) from public;
revoke all on function public.cancel_student_queue(text) from public;
revoke all on function public.update_student_queue_presence(text, text) from public;
revoke all on function public.transition_queue_entry(uuid, text) from public;
revoke all on function public.reset_queue_session(uuid) from public;
grant execute on function public.join_queue_with_status_token(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_student_queue_entry(text) to anon, authenticated;
grant execute on function public.exchange_legacy_queue_ticket(uuid, text, text) to anon, authenticated;
grant execute on function public.cancel_student_queue(text) to anon, authenticated;
grant execute on function public.update_student_queue_presence(text, text) to anon, authenticated;
grant execute on function public.transition_queue_entry(uuid, text) to authenticated;
grant execute on function public.reset_queue_session(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_entries') then
      execute 'alter publication supabase_realtime add table public.queue_entries';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_log') then
      execute 'alter publication supabase_realtime add table public.activity_log';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_presence') then
      execute 'alter publication supabase_realtime add table public.queue_presence';
    end if;
  end if;
end;
$$;

commit;