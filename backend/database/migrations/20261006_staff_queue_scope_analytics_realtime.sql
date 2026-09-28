-- Queue-scope STAFF analytics, activity logs, and presence.
-- Apply after 20261005_multi_queue_scope_hardening.sql. Existing history is preserved.
begin;

-- Fail safely if this deployment has untracked policies on the protected tables.
do $$
declare
  unexpected_policies text;
begin
  select string_agg(format('%s.%s: %s', tablename, policyname, cmd), ', ' order by tablename, policyname)
    into unexpected_policies
  from pg_policies
  where schemaname = 'public'
    and (
      (tablename = 'activity_log' and policyname not in (
        'Org staff can manage activity log for their org',
        'Org staff can view activity log for their org',
        'Staff can view scoped activity log'
      ))
      or (tablename = 'queue_presence' and policyname not in (
        'Org staff can view presence for their org',
        'Staff can view scoped queue presence'
      ))
    );

  if unexpected_policies is not null then
    raise exception 'Unexpected activity_log/queue_presence policies require review: %', unexpected_policies;
  end if;
end
$$;

-- 1. Add nullable queue links. Historical records without a reliable queue
-- association remain NULL and remain visible to organization admins.
alter table public.activity_log
  add column if not exists queue_id uuid;

alter table public.queue_presence
  add column if not exists queue_id uuid;

update public.activity_log al
set queue_id = q.id
from public.organization_queues q
where al.queue_id is null
  and q.organization_id = al.organization_id
  and q.id = case
    when al.details->>'queue_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (al.details->>'queue_id')::uuid
    else null
  end;

update public.activity_log al
set queue_id = e.queue_id
from public.queue_entries e
where al.queue_id is null
  and e.organization_id = al.organization_id
  and e.id = case
    when al.details->>'queue_entry_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (al.details->>'queue_entry_id')::uuid
    else null
  end
  and e.queue_id is not null;

update public.queue_presence p
set queue_id = e.queue_id
from public.queue_entries e
where p.queue_id is null
  and e.id = p.queue_entry_id
  and e.organization_id = p.organization_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.activity_log'::regclass
      and conname = 'activity_log_queue_id_fkey'
  ) then
    alter table public.activity_log
      add constraint activity_log_queue_id_fkey
      foreign key (queue_id) references public.organization_queues(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.queue_presence'::regclass
      and conname = 'queue_presence_queue_id_fkey'
  ) then
    alter table public.queue_presence
      add constraint queue_presence_queue_id_fkey
      foreign key (queue_id) references public.organization_queues(id)
      on delete set null;
  end if;
end
$$;

create index if not exists activity_log_org_queue_created_idx
  on public.activity_log (organization_id, queue_id, created_at desc);

create index if not exists queue_presence_org_queue_seen_idx
  on public.queue_presence (organization_id, queue_id, last_seen_at desc);

-- Associate future queue activity written by existing RPCs from their validated
-- queue_id or queue_entry_id details. Location/system events stay unscoped.
create or replace function public.assign_activity_log_queue_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_queue_id uuid;
  v_entry_id uuid;
begin
  if new.queue_id is null and new.details->>'queue_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_queue_id := (new.details->>'queue_id')::uuid;
  elsif new.queue_id is null and new.details->>'queue_entry_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_entry_id := (new.details->>'queue_entry_id')::uuid;
    select e.queue_id into v_queue_id
    from public.queue_entries e
    where e.id = v_entry_id and e.organization_id = new.organization_id;
  end if;

  if new.queue_id is null then
    new.queue_id := v_queue_id;
  end if;

  if new.queue_id is not null and not exists (
    select 1 from public.organization_queues q
    where q.id = new.queue_id and q.organization_id = new.organization_id
  ) then
    raise exception 'Activity queue must belong to the activity organization';
  end if;

  return new;
end;
$$;

drop trigger if exists activity_log_assign_queue_scope on public.activity_log;
create trigger activity_log_assign_queue_scope
before insert or update on public.activity_log
for each row execute function public.assign_activity_log_queue_scope();

-- Presence is denormalized only for efficient RLS and Realtime filtering. The
-- trigger always verifies its queue against the linked entry and organization.
create or replace function public.enforce_queue_presence_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_entry_organization_id uuid;
  v_entry_queue_id uuid;
begin
  select e.organization_id, e.queue_id
    into v_entry_organization_id, v_entry_queue_id
  from public.queue_entries e
  where e.id = new.queue_entry_id;

  if not found or v_entry_organization_id is distinct from new.organization_id then
    raise exception 'Presence entry does not belong to this organization';
  end if;
  if new.queue_id is not null and new.queue_id is distinct from v_entry_queue_id then
    raise exception 'Presence queue does not match its queue entry';
  end if;

  new.queue_id := v_entry_queue_id;
  return new;
end;
$$;

drop trigger if exists queue_presence_enforce_queue_scope on public.queue_presence;
create trigger queue_presence_enforce_queue_scope
before insert or update on public.queue_presence
for each row execute function public.enforce_queue_presence_scope();

-- 2. Queue lifecycle events now have a first-class queue_id. Keep existing
-- public organization broadcasts and private student broadcasts unchanged.
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
  v_event jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'QUEUE_JOINED';
  elsif new.status = 'WAITING' and old.status = 'CALLED' then
    v_action := 'QUEUE_RETURNED_TO_WAITING';
  elsif new.status is distinct from old.status then
    v_action := case new.status
      when 'CALLED' then 'QUEUE_CALLED'
      when 'SERVING' then 'QUEUE_SERVING'
      when 'AWAITING_RETURN' then 'QUEUE_AWAITING_RETURN'
      when 'COMPLETED' then 'QUEUE_COMPLETED'
      when 'CANCELLED' then case new.cancellation_source
        when 'STUDENT' then 'QUEUE_CANCELLED_BY_STUDENT'
        else 'QUEUE_CANCELLED_BY_ADMIN'
      end
      when 'NO_SHOW' then 'QUEUE_NO_SHOW'
      else null
    end;
  end if;

  v_source := case when new.status = 'CANCELLED' then new.cancellation_source else null end;

  if v_action is not null then
    insert into public.activity_log (organization_id, queue_id, performed_by, action, details)
    values (
      new.organization_id,
      new.queue_id,
      case when v_source = 'STUDENT' then null else auth.uid() end,
      v_action,
      jsonb_build_object(
        'queue_id', new.queue_id,
        'queue_entry_id', new.id,
        'queue_number', new.queue_number,
        'previous_status', case when tg_op = 'UPDATE' then old.status else null end,
        'status', new.status,
        'updated_at', new.updated_at,
        'source', v_source
      )
    );
  end if;

  v_event := jsonb_build_object(
    'queue_entry_id', new.id,
    'queue_number', new.queue_number,
    'previous_status', case when tg_op = 'UPDATE' then old.status else null end,
    'status', new.status,
    'updated_at', new.updated_at,
    'called_at', new.called_at,
    'cancellation_source', v_source
  );

  select public_identifier into v_identifier
  from public.organizations where id = new.organization_id;

  if v_identifier is not null then
    perform realtime.send(
      jsonb_build_object(
        'queue_number', new.queue_number,
        'previous_status', case when tg_op = 'UPDATE' then old.status else null end,
        'status', new.status,
        'updated_at', new.updated_at
      ),
      'queue_changed',
      'public-queue:' || v_identifier,
      false
    );
  end if;

  select token_hash into v_token_hash
  from public.queue_status_tokens where queue_entry_id = new.id;

  if v_token_hash is not null then
    perform realtime.send(v_event, 'queue_status_changed', 'student-queue:' || v_token_hash, true);
  end if;

  if new.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW') then
    update public.queue_status_tokens
    set revoked_at = coalesce(revoked_at, now())
    where queue_entry_id = new.id;

    update public.queue_presence
    set presence = 'OFFLINE', updated_at = now()
    where queue_entry_id = new.id;

    delete from public.student_push_subscriptions
    where queue_entry_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists queue_entries_activity_broadcast on public.queue_entries;
create trigger queue_entries_activity_broadcast
after insert or update on public.queue_entries
for each row execute function public.log_queue_activity_and_broadcast();

-- Preserve the existing status-token validation and presence upsert while
-- associating presence-transition activity with its validated queue entry.
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

    insert into public.activity_log (organization_id, queue_id, action, details)
    values (
      v_entry.organization_id,
      v_entry.queue_id,
      v_action,
      jsonb_build_object(
        'queue_id', v_entry.queue_id,
        'queue_entry_id', v_entry.id,
        'queue_number', v_entry.queue_number,
        'presence', p_presence
      )
    );
  end if;

  return true;
end;
$$;

revoke all on function public.update_student_queue_presence(text, text) from public;
grant execute on function public.update_student_queue_presence(text, text) to anon, authenticated;

-- 3. Analytics remains a single RPC. Admins may omit p_queue_id for the
-- organization-wide result; STAFF must request an authorized queue. STAFF
-- organization scope is derived from the queue row, not the supplied org ID.
drop function if exists public.get_organization_analytics(uuid, date, date);

create or replace function public.get_organization_analytics(
  p_organization_id uuid,
  p_from date,
  p_to date,
  p_queue_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_scope_organization_id uuid;
  v_org_admin boolean := public.is_super_admin() or public.is_org_admin(p_organization_id);
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Analytics date range is invalid';
  end if;

  if v_org_admin then
    v_scope_organization_id := p_organization_id;
    if v_scope_organization_id is null then
      raise exception 'Organization is required for organization analytics';
    end if;
    if not exists (
      select 1 from public.organizations o where o.id = v_scope_organization_id
    ) then
      raise exception 'Organization not found for analytics';
    end if;
    if p_queue_id is not null and not exists (
      select 1 from public.organization_queues q
      where q.id = p_queue_id and q.organization_id = v_scope_organization_id
    ) then
      raise exception 'Queue does not belong to the requested organization';
    end if;
  else
    if p_queue_id is null then
      raise exception 'STAFF analytics require an assigned queue';
    end if;
    select q.organization_id into v_scope_organization_id
    from public.organization_queues q
    where q.id = p_queue_id;
    if not found then
      raise exception 'Queue not found or not authorized for analytics';
    end if;
    if p_organization_id is not null and p_organization_id is distinct from v_scope_organization_id then
      raise exception 'Supplied organization does not match the requested queue';
    end if;
    if not public.can_manage_organization_queue(v_scope_organization_id, p_queue_id) then
      raise exception 'Queue not found or not authorized for analytics';
    end if;
  end if;

  with selected as (
    select q.*
    from public.queue_entries q
    where q.organization_id = v_scope_organization_id
      and (p_queue_id is null or q.queue_id = p_queue_id)
      and q.joined_at >= p_from::timestamptz
      and q.joined_at < (p_to + 1)::timestamptz
  ),
  totals as (
    select
      count(*)::integer as total,
      count(*) filter (where status = 'COMPLETED')::integer as completed,
      count(*) filter (where status = 'CANCELLED')::integer as cancelled,
      count(*) filter (where status = 'NO_SHOW')::integer as no_show,
      count(*) filter (where status = 'WAITING')::integer as waiting,
      count(*) filter (where status = 'SERVING')::integer as serving,
      count(*) filter (where status = 'AWAITING_RETURN')::integer as awaiting_return,
      round(avg(extract(epoch from (coalesce(called_at, started_at) - joined_at)) / 60.0)
        filter (where coalesce(called_at, started_at) is not null)::numeric, 1) as average_wait,
      round(avg(extract(epoch from (completed_at - started_at)) / 60.0)
        filter (where status = 'COMPLETED' and completed_at is not null and started_at is not null)::numeric, 1) as average_service
    from selected
  ),
  hourly as (
    select extract(hour from joined_at)::integer as hour, count(*)::integer as total
    from selected group by 1 order by 1
  ),
  daily as (
    select joined_at::date as day, count(*)::integer as total
    from selected group by 1 order by 1
  ),
  purposes as (
    select purpose, count(*)::integer as total
    from selected group by purpose order by total desc
  )
  select jsonb_build_object(
    'total', totals.total,
    'completed', totals.completed,
    'cancelled', totals.cancelled,
    'noShow', totals.no_show,
    'waiting', totals.waiting,
    'serving', totals.serving,
    'awaitingReturn', totals.awaiting_return,
    'averageWaitMinutes', totals.average_wait,
    'averageServiceMinutes', totals.average_service,
    'hourly', coalesce((select jsonb_agg(jsonb_build_object('hour', hour, 'value', total) order by hour) from hourly), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('date', day, 'value', total) order by day) from daily), '[]'::jsonb),
    'purposes', coalesce((select jsonb_agg(jsonb_build_object('label', purpose, 'count', total, 'percent', round(total * 100.0 / nullif(totals.total, 0), 1)) order by total desc) from purposes), '[]'::jsonb)
  ) into v_result from totals;

  return v_result;
end;
$$;

revoke all on function public.get_organization_analytics(uuid, date, date, uuid) from public, anon;
grant execute on function public.get_organization_analytics(uuid, date, date, uuid) to authenticated;

-- 4. Queue-aware RLS applies to both PostgREST reads and Realtime delivery.
alter table public.activity_log enable row level security;
alter table public.queue_presence enable row level security;
revoke all on public.activity_log from public, anon;
revoke all on public.activity_log from authenticated;
grant select on public.activity_log to authenticated;
revoke all on public.queue_presence from public, anon, authenticated;
grant select on public.queue_presence to authenticated;

drop policy if exists "Org staff can manage activity log for their org" on public.activity_log;
drop policy if exists "Org staff can view activity log for their org" on public.activity_log;
drop policy if exists "Staff can view scoped activity log" on public.activity_log;
create policy "Staff can view scoped activity log"
on public.activity_log
for select to authenticated
using (
  public.is_super_admin()
  or (organization_id is not null and public.is_org_admin(organization_id))
  or (
    queue_id is not null
    and organization_id is not null
    and exists (
      select 1 from public.organization_queues q
      where q.id = activity_log.queue_id
        and q.organization_id = activity_log.organization_id
        and public.can_manage_organization_queue(activity_log.organization_id, q.id)
    )
  )
);

drop policy if exists "Org staff can view presence for their org" on public.queue_presence;
drop policy if exists "Staff can view scoped queue presence" on public.queue_presence;
create policy "Staff can view scoped queue presence"
on public.queue_presence
for select to authenticated
using (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
  or (
    queue_id is not null
    and exists (
      select 1
      from public.queue_entries e
      where e.id = queue_presence.queue_entry_id
        and e.organization_id = queue_presence.organization_id
        and e.queue_id = queue_presence.queue_id
        and public.can_manage_organization_queue(queue_presence.organization_id, e.queue_id)
    )
  )
);

commit;

notify pgrst, 'reload schema';

-- Read-only catalog and integrity checks for post-apply review.
select case when exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'activity_log' and column_name = 'queue_id'
) then 'PASS' else 'FAIL' end as activity_log_queue_column_exists;

select case when exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'queue_presence' and column_name = 'queue_id'
) then 'PASS' else 'FAIL' end as queue_presence_queue_column_exists;

select case when count(*) = 0 then 'PASS' else 'FAIL' end as staff_scope_indexes_exist,
       count(*) as missing_index_count
from (values
  ('activity_log_org_queue_created_idx'),
  ('queue_presence_org_queue_seen_idx')
) as required(index_name)
where to_regclass('public.' || required.index_name) is null;

select case when count(*) = 0 then 'PASS' else 'FAIL' end as activity_presence_rls_enabled,
       count(*) as tables_without_rls
from (values ('activity_log'), ('queue_presence')) as required(table_name)
left join pg_class c on c.oid = to_regclass('public.' || required.table_name)
where c.oid is null or not c.relrowsecurity;

select case
  when not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.activity_log'::regclass
      and tgname = 'activity_log_assign_queue_scope'
      and not tgisinternal
  ) then 'FAIL'
  when not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.queue_presence'::regclass
      and tgname = 'queue_presence_enforce_queue_scope'
      and not tgisinternal
  ) then 'FAIL'
  when not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.queue_entries'::regclass
      and tgname = 'queue_entries_activity_broadcast'
      and not tgisinternal
  ) then 'FAIL'
  else 'PASS'
end as queue_scope_triggers_exist;

select case when count(*) = 0 then 'PASS' else 'FAIL' end as presence_entry_scope_integrity
from public.queue_presence p
left join public.queue_entries e on e.id = p.queue_entry_id
where e.id is null
  or p.organization_id is distinct from e.organization_id
   or p.queue_id is distinct from e.queue_id;

select case when count(*) = 0 then 'PASS' else 'FAIL' end as activity_queue_organization_integrity
from public.activity_log a
join public.organization_queues q on q.id = a.queue_id
where a.organization_id is distinct from q.organization_id;

select case when count(*) = 0 then 'PASS' else 'FAIL' end as activity_details_queue_association_integrity
from public.activity_log a
left join public.organization_queues q
  on q.organization_id = a.organization_id
 and q.id = case
   when a.details->>'queue_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     then (a.details->>'queue_id')::uuid
   else null
 end
where a.details->>'queue_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (q.id is null or a.queue_id is distinct from q.id);

select case
  when exists (
    select 1 from pg_trigger
    where tgrelid = 'public.queue_entries'::regclass
      and tgname = 'queue_entries_activity_broadcast'
      and not tgisinternal
  )
  and position('realtime.send' in pg_get_functiondef('public.log_queue_activity_and_broadcast()'::regprocedure)) > 0
  and position('queue_status_changed' in pg_get_functiondef('public.log_queue_activity_and_broadcast()'::regprocedure)) > 0
    then 'PASS'
  else 'FAIL'
end as lifecycle_realtime_broadcast_preserved;

select case
  when to_regprocedure('public.get_organization_analytics(uuid,date,date,uuid)') is null then 'FAIL'
  when to_regprocedure('public.get_organization_analytics(uuid,date,date)') is not null then 'FAIL'
  when not has_function_privilege('authenticated', 'public.get_organization_analytics(uuid,date,date,uuid)', 'EXECUTE') then 'FAIL'
  when has_function_privilege('anon', 'public.get_organization_analytics(uuid,date,date,uuid)', 'EXECUTE') then 'FAIL'
  else 'PASS'
end as analytics_rpc_signature_and_grants;

select case
  when to_regprocedure('public.update_student_queue_presence(text,text)') is null then 'FAIL'
  when position('queue_id' in pg_get_functiondef('public.update_student_queue_presence(text,text)'::regprocedure)) = 0 then 'FAIL'
  when not has_function_privilege('anon', 'public.update_student_queue_presence(text,text)', 'EXECUTE') then 'FAIL'
  else 'PASS'
end as student_presence_rpc_preserves_public_token_flow_and_queue_scope;

select case
  when has_function_privilege('anon', 'public.get_public_queue_qr_token(text,uuid)', 'EXECUTE')
   and not has_table_privilege('anon', 'public.organization_qr_tokens', 'SELECT')
   and not has_table_privilege('anon', 'public.organization_qr_tokens', 'INSERT')
    then 'PASS'
  else 'FAIL'
end as public_qr_token_access_is_rpc_only;

select case
  when not coalesce(bool_or(policyname = 'Staff can view scoped activity log'), false) then 'FAIL'
  when coalesce(bool_or(policyname in (
    'Org staff can manage activity log for their org',
    'Org staff can view activity log for their org'
  )), false) then 'FAIL'
  else 'PASS'
end as activity_log_queue_scope_policy
from pg_policies
where schemaname = 'public' and tablename = 'activity_log';

select case
  when not coalesce(bool_or(policyname = 'Staff can view scoped queue presence'), false) then 'FAIL'
  when coalesce(bool_or(policyname = 'Org staff can view presence for their org'), false) then 'FAIL'
  else 'PASS'
end as queue_presence_queue_scope_policy
from pg_policies
where schemaname = 'public' and tablename = 'queue_presence';

-- Manual authorization checks require three real authenticated sessions; do not
-- create test users or mutate production queue data for these checks.
-- STAFF A: request analytics for an assigned queue (pass), then a different
-- unassigned queue or no queue (must raise); query activity_log/queue_presence
-- and confirm rows from other queues and NULL-queue history are absent.
-- ORG_ADMIN: request organization-wide analytics and reads (all own queues pass;
-- another organization's rows remain absent).
-- SUPER_ADMIN: request authorized organization analytics and reads, then verify
-- only the explicitly requested organization is returned by these RPCs.