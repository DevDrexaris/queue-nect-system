-- Multi-queue authorization and public lookup hardening.
-- Apply after 20261004_multi_location_queues.sql. This migration changes no queue data.
begin;

-- Do not silently retain deployment-specific permissive token policies.
do $$
declare
  unexpected_policies text;
begin
  select string_agg(format('%s (%s)', policyname, cmd), ', ' order by policyname)
    into unexpected_policies
  from pg_policies
  where schemaname = 'public'
    and tablename = 'organization_qr_tokens'
    and policyname not in (
      'Public can validate active QR access tokens',
      'Public can create QR access tokens for active organizations',
      'Admins can manage QR access tokens for their org',
      'Assigned staff can view queue QR tokens',
      'Assigned staff can create queue QR tokens',
      'Assigned staff can update queue QR tokens'
    );

  if unexpected_policies is not null then
    raise exception 'Unexpected organization_qr_tokens policies require review: %', unexpected_policies;
  end if;
end
$$;

-- Public callers must prove the queue belongs to the requested organization.
-- Remove the old UUID-only RPC signatures so callers cannot bypass that check.
drop function if exists public.get_organization_queue_availability(uuid);
drop function if exists public.get_public_queue_details(uuid);

-- Existing active queues need a bearer available to the public QR routes after
-- direct anonymous token-table access is revoked below. Keep existing active
-- tokens; provision only queues that currently have none.
insert into public.organization_qr_tokens (
  organization_id, queue_id, token, is_active, expires_at
)
select q.organization_id, q.id, encode(gen_random_bytes(32), 'hex'), true, null
from public.organization_queues q
join public.organizations o on o.id = q.organization_id and o.is_active
where q.is_active
  and not exists (
    select 1 from public.organization_qr_tokens t
    where t.organization_id = q.organization_id
      and t.queue_id = q.id
      and t.is_active
      and (t.expires_at is null or t.expires_at > now())
  );

-- Newly created queues receive a public-registration bearer in the database.
-- Anonymous callers can retrieve the bearer through the scoped read RPC below,
-- but cannot create, rotate, deactivate, or directly read token rows.
create or replace function public.create_public_qr_token_for_queue()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.is_active then
    insert into public.organization_qr_tokens (
      organization_id, queue_id, token, is_active, expires_at
    ) values (
      new.organization_id, new.id, encode(gen_random_bytes(32), 'hex'), true, null
    );
  end if;
  return new;
end;
$$;

revoke all on function public.create_public_qr_token_for_queue() from public;

drop trigger if exists organization_queues_create_public_qr_token on public.organization_queues;
create trigger organization_queues_create_public_qr_token
after insert on public.organization_queues
for each row execute function public.create_public_qr_token_for_queue();

create or replace function public.get_organization_queue_availability(
  p_public_identifier text,
  p_queue_id uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select q.admission_status
    from public.organizations o
    join public.organization_queues q on q.organization_id = o.id
    join public.organization_locations l on l.id = q.location_id
    where o.public_identifier = p_public_identifier
      and o.is_active
      and q.id = p_queue_id
      and q.is_active
      and l.is_active
  ), 'CLOSED');
$$;

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
    'availability', q.admission_status
  )
  from public.organizations o
  join public.organization_queues q on q.organization_id = o.id
  join public.organization_locations l on l.id = q.location_id
  where o.public_identifier = p_public_identifier
    and o.is_active
    and q.id = p_queue_id
    and q.is_active
    and l.is_active
  limit 1;
$$;

-- Public TV/display and QR pages embed this same bearer code in the public join
-- URL. It authorizes public registration only; clients cannot list or mint token
-- rows. Keep this endpoint only while the intentionally public QR flow exists.
-- The token is returned only for the active organization/queue pair requested.
create or replace function public.get_public_queue_qr_token(
  p_public_identifier text,
  p_queue_id uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select t.token
  from public.organizations o
  join public.organization_queues q on q.organization_id = o.id
  join public.organization_locations l on l.id = q.location_id
  join public.organization_qr_tokens t
    on t.organization_id = o.id and t.queue_id = q.id
  where o.public_identifier = p_public_identifier
    and o.is_active
    and q.id = p_queue_id
    and q.is_active
    and l.is_active
    and t.is_active
    and (t.expires_at is null or t.expires_at > now())
  order by t.created_at desc
  limit 1;
$$;

create or replace function public.resolve_queue_qr_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'clinicIdentifier', o.public_identifier,
    'clinicName', o.name,
    'queueId', q.id,
    'queueName', q.name,
    'locationName', l.name,
    'availability', q.admission_status
  )
  from public.organization_qr_tokens t
  join public.organizations o on o.id = t.organization_id
  join public.organization_queues q
    on q.id = t.queue_id and q.organization_id = o.id
  join public.organization_locations l
    on l.id = q.location_id and l.organization_id = o.id
  where t.token = p_token
    and t.is_active
    and o.is_active
    and q.is_active
    and l.is_active
    and (t.expires_at is null or t.expires_at > now())
  limit 1;
$$;

-- Organization admins and super admins retain organization-wide statistics.
-- STAFF can see only queues assigned directly or through their assigned location.
create or replace function public.get_organization_location_queue_stats(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_admin_scope boolean := public.is_super_admin() or public.is_org_admin(p_organization_id);
  v_assigned_staff boolean;
begin
  if p_organization_id is null then
    raise exception 'Organization is required to view queue statistics';
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.organization_id = p_organization_id
      and p.role = 'STAFF'
      and p.is_active
      and (
        p.location_id is not null
        or p.queue_id is not null
      )
  ) into v_assigned_staff;

  if not v_admin_scope and not v_assigned_staff then
    raise exception 'Not authorized to view queue statistics for this organization';
  end if;

  with queue_stats as (
    select
      l.id as location_id,
      q.id as queue_id,
      q.name as queue_name,
      q.queue_prefix,
      q.admission_status,
      q.is_active,
      count(e.id)::integer as total,
      count(e.id) filter (where e.status = 'WAITING')::integer as waiting,
      count(e.id) filter (where e.status = 'SERVING')::integer as serving,
      count(e.id) filter (where e.status = 'AWAITING_RETURN')::integer as awaiting_return,
      count(e.id) filter (where e.status = 'COMPLETED')::integer as completed
    from public.organization_locations l
    join public.organization_queues q
      on q.location_id = l.id and q.organization_id = l.organization_id
    left join public.queue_sessions s
      on s.queue_id = q.id
      and s.organization_id = q.organization_id
      and s.session_date = current_date
      and s.is_active
    left join public.queue_entries e on e.queue_session_id = s.id
    where l.organization_id = p_organization_id
      and l.is_active
      and (
        v_admin_scope
        or public.can_manage_organization_queue(p_organization_id, q.id)
      )
    group by l.id, q.id, q.name, q.queue_prefix, q.admission_status, q.is_active
  ),
  location_stats as (
    select
      l.id as location_id,
      l.name as location_name,
      coalesce(sum(q.total), 0)::integer as total,
      coalesce(sum(q.waiting), 0)::integer as waiting,
      coalesce(sum(q.serving), 0)::integer as serving,
      coalesce(sum(q.awaiting_return), 0)::integer as awaiting_return,
      coalesce(sum(q.completed), 0)::integer as completed
    from public.organization_locations l
    left join queue_stats q on q.location_id = l.id
    where l.organization_id = p_organization_id
      and l.is_active
      and (
        v_admin_scope
        or exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.organization_id = p_organization_id
            and p.role = 'STAFF'
            and p.is_active
            and (
              p.location_id = l.id
              or p.queue_id in (
                select assigned_queue.id
                from public.organization_queues assigned_queue
                where assigned_queue.location_id = l.id
                  and assigned_queue.organization_id = p_organization_id
              )
            )
        )
      )
    group by l.id, l.name
  )
  select jsonb_build_object(
    'combined', jsonb_build_object(
      'total', coalesce(sum(total), 0)::integer,
      'waiting', coalesce(sum(waiting), 0)::integer,
      'serving', coalesce(sum(serving), 0)::integer,
      'awaitingReturn', coalesce(sum(awaiting_return), 0)::integer,
      'completed', coalesce(sum(completed), 0)::integer
    ),
    'locations', coalesce(jsonb_agg(jsonb_build_object(
      'locationId', location_id,
      'name', location_name,
      'total', total,
      'waiting', waiting,
      'serving', serving,
      'awaitingReturn', awaiting_return,
      'completed', completed,
      'queues', coalesce((
        select jsonb_agg(jsonb_build_object(
          'queueId', q.queue_id,
          'name', q.queue_name,
          'prefix', q.queue_prefix,
          'availability', q.admission_status,
          'active', q.is_active,
          'total', q.total,
          'waiting', q.waiting,
          'serving', q.serving,
          'awaitingReturn', q.awaiting_return,
          'completed', q.completed
        ) order by q.queue_name)
        from queue_stats q where q.location_id = location_stats.location_id
      ), '[]'::jsonb)
    ) order by location_name), '[]'::jsonb)
  ) into v_result
  from location_stats;

  return v_result;
end;
$$;

-- Remove direct anonymous access to bearer QR tokens. Authenticated users can
-- manage only queues authorized by the same scope helper used by queue RPCs.
alter table public.organization_qr_tokens enable row level security;
revoke all on public.organization_qr_tokens from public, anon, authenticated;
grant select, insert, update on public.organization_qr_tokens to authenticated;

drop policy if exists "Public can validate active QR access tokens" on public.organization_qr_tokens;
drop policy if exists "Public can create QR access tokens for active organizations" on public.organization_qr_tokens;
drop policy if exists "Admins can manage QR access tokens for their org" on public.organization_qr_tokens;
drop policy if exists "Assigned staff can view queue QR tokens" on public.organization_qr_tokens;
drop policy if exists "Assigned staff can create queue QR tokens" on public.organization_qr_tokens;
drop policy if exists "Assigned staff can update queue QR tokens" on public.organization_qr_tokens;

create policy "Admins can manage QR access tokens for their org"
on public.organization_qr_tokens
for all to authenticated
using (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
)
with check (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
);

create policy "Assigned staff can view queue QR tokens"
on public.organization_qr_tokens
for select to authenticated
using (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
  or public.can_manage_organization_queue(organization_id, queue_id)
);

create policy "Assigned staff can create queue QR tokens"
on public.organization_qr_tokens
for insert to authenticated
with check (
  queue_id is not null
  and exists (
    select 1
    from public.organization_queues q
    where q.id = organization_qr_tokens.queue_id
      and q.organization_id = organization_qr_tokens.organization_id
      and q.is_active
  )
  and (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or public.can_manage_organization_queue(organization_id, queue_id)
  )
);

create policy "Assigned staff can update queue QR tokens"
on public.organization_qr_tokens
for update to authenticated
using (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
  or public.can_manage_organization_queue(organization_id, queue_id)
)
with check (
  queue_id is not null
  and exists (
    select 1
    from public.organization_queues q
    where q.id = organization_qr_tokens.queue_id
      and q.organization_id = organization_qr_tokens.organization_id
      and q.is_active
  )
  and (
    public.is_super_admin()
    or public.is_org_admin(organization_id)
    or public.can_manage_organization_queue(organization_id, queue_id)
  )
);

revoke all on function public.get_organization_queue_availability(text, uuid) from public;
revoke all on function public.get_public_queue_details(text, uuid) from public;
revoke all on function public.get_public_queue_qr_token(text, uuid) from public;
revoke all on function public.resolve_queue_qr_token(text) from public;
revoke all on function public.get_organization_location_queue_stats(uuid) from public;
grant execute on function public.get_organization_queue_availability(text, uuid) to anon, authenticated;
grant execute on function public.get_public_queue_details(text, uuid) to anon, authenticated;
grant execute on function public.get_public_queue_qr_token(text, uuid) to anon, authenticated;
grant execute on function public.resolve_queue_qr_token(text) to anon, authenticated;
grant execute on function public.get_organization_location_queue_stats(uuid) to authenticated;

commit;

-- Post-apply catalog checks (these do not modify data).
with required(table_name, column_name) as (
  values
    ('organization_locations', 'organization_id'),
    ('organization_locations', 'is_active'),
    ('organization_queues', 'organization_id'),
    ('organization_queues', 'location_id'),
    ('organization_queues', 'public_identifier'),
    ('organization_queues', 'admission_status'),
    ('organization_qr_tokens', 'organization_id'),
    ('organization_qr_tokens', 'queue_id'),
    ('organization_qr_tokens', 'token'),
    ('queue_sessions', 'queue_id'),
    ('queue_sessions', 'next_number'),
    ('queue_entries', 'queue_id'),
    ('queue_entries', 'queue_session_id'),
    ('profiles', 'location_id'),
    ('profiles', 'queue_id')
)
select case when count(*) = 0 then 'PASS' else 'FAIL' end as required_multi_queue_columns,
       count(*) as missing_column_count
from required r
where not exists (
  select 1 from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = r.table_name
    and c.column_name = r.column_name
);

select case when count(*) = 0 then 'PASS' else 'FAIL' end as required_multi_queue_indexes,
       count(*) as missing_index_count
from (values
  ('organization_queues_one_default_idx'),
  ('organization_queues_location_active_idx'),
  ('queue_sessions_queue_date_uidx'),
  ('queue_entries_queue_status_joined_idx')
) as required(index_name)
where to_regclass('public.' || required.index_name) is null;

select case when count(*) = 0 then 'PASS' else 'FAIL' end as required_multi_queue_rls_enabled,
       count(*) as tables_without_rls
from (values
  ('organization_locations'),
  ('organization_queues'),
  ('organization_qr_tokens'),
  ('queue_sessions'),
  ('queue_entries'),
  ('queue_history')
) as required(table_name)
left join pg_class c on c.oid = to_regclass('public.' || required.table_name)
where c.oid is null or not c.relrowsecurity;

select case when to_regprocedure('public.get_organization_queue_availability(text,uuid)') is not null
  then 'PASS' else 'FAIL' end as org_bound_availability_rpc;
select case when to_regprocedure('public.get_public_queue_details(text,uuid)') is not null
  then 'PASS' else 'FAIL' end as org_bound_queue_details_rpc;
select case when to_regprocedure('public.get_organization_queue_availability(uuid)') is null
  then 'PASS' else 'FAIL' end as old_unscoped_availability_rpc_removed;
select case when to_regprocedure('public.get_public_queue_details(uuid)') is null
  then 'PASS' else 'FAIL' end as old_unscoped_details_rpc_removed;
select case
  when to_regprocedure('public.get_public_queue_qr_token(text,uuid)') is null then 'FAIL'
  when not has_function_privilege('anon', 'public.get_public_queue_qr_token(text,uuid)', 'EXECUTE') then 'FAIL'
  when not has_function_privilege('anon', 'public.resolve_queue_qr_token(text)', 'EXECUTE') then 'FAIL'
  when not has_function_privilege('anon', 'public.join_queue_with_status_token(text,text,text,text,text,text,text)', 'EXECUTE') then 'FAIL'
  else 'PASS'
end as public_qr_registration_rpc_grants;

select case
  when has_table_privilege('anon', 'public.organization_qr_tokens', 'SELECT') then 'FAIL'
  when has_table_privilege('anon', 'public.organization_qr_tokens', 'INSERT') then 'FAIL'
  when has_table_privilege('anon', 'public.organization_qr_tokens', 'UPDATE') then 'FAIL'
  when has_table_privilege('anon', 'public.organization_qr_tokens', 'DELETE') then 'FAIL'
  else 'PASS'
end as anonymous_qr_token_table_access_revoked;

select case when count(*) = 0 then 'PASS' else 'FAIL' end as active_queues_have_public_qr_tokens,
       count(*) as active_queues_missing_tokens
from public.organization_queues q
join public.organizations o on o.id = q.organization_id and o.is_active
where q.is_active
  and not exists (
    select 1 from public.organization_qr_tokens t
    where t.organization_id = q.organization_id
      and t.queue_id = q.id
      and t.is_active
      and (t.expires_at is null or t.expires_at > now())
  );
select case
  when not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_qr_tokens'
      and policyname in (
        'Public can validate active QR access tokens',
        'Public can create QR access tokens for active organizations'
      )
  )
  and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_qr_tokens'
      and policyname = 'Admins can manage QR access tokens for their org'
  )
  and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_qr_tokens'
      and policyname = 'Assigned staff can view queue QR tokens'
  )
  and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_qr_tokens'
      and policyname = 'Assigned staff can create queue QR tokens'
  )
  and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_qr_tokens'
      and policyname = 'Assigned staff can update queue QR tokens'
  )
  then 'PASS'
  else 'FAIL'
end as queue_qr_policy_configuration;

select case
  when not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.organization_queues'::regclass
      and tgname = 'organization_queues_create_public_qr_token'
      and not tgisinternal
  ) then 'FAIL'
  when not has_function_privilege('anon', 'public.create_public_qr_token_for_queue()', 'EXECUTE')
   and not has_function_privilege('authenticated', 'public.create_public_qr_token_for_queue()', 'EXECUTE')
    then 'PASS'
  else 'FAIL'
end as queue_qr_provisioning_trigger_is_internal;

-- Review all active policies, including any added outside this repository.
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'organization_qr_tokens'
order by policyname;

-- Verify queue/session/entry organization and queue bindings without returning patient data.
select case when count(*) = 0 then 'PASS' else 'FAIL' end as queue_session_entry_scope_integrity,
       count(*) as mismatched_entry_count
from public.queue_entries e
join public.queue_sessions s on s.id = e.queue_session_id
where e.organization_id is distinct from s.organization_id
   or e.queue_id is distinct from s.queue_id;

select case when count(*) = 0 then 'PASS' else 'FAIL' end as queue_location_organization_integrity,
     count(*) as mismatched_queue_count
from public.organization_queues q
join public.organization_locations l on l.id = q.location_id
where q.organization_id is distinct from l.organization_id;

select case when count(*) = 0 then 'PASS' else 'FAIL' end as queue_entry_organization_integrity,
     count(*) as mismatched_entry_count
from public.queue_entries e
join public.organization_queues q on q.id = e.queue_id
where e.organization_id is distinct from q.organization_id;

select case when count(*) = 0 then 'PASS' else 'FAIL' end as qr_token_organization_integrity,
     count(*) as mismatched_token_count
from public.organization_qr_tokens t
join public.organization_queues q on q.id = t.queue_id
where t.organization_id is distinct from q.organization_id;

-- If two active organizations exist, the mismatched queue must not resolve.
with mismatch as (
  select org_a.public_identifier, queue_b.id as foreign_queue_id
  from public.organizations org_a
  join public.organization_queues queue_a
    on queue_a.organization_id = org_a.id and queue_a.is_active
  join public.organizations org_b on org_b.id <> org_a.id and org_b.is_active
  join public.organization_queues queue_b
    on queue_b.organization_id = org_b.id and queue_b.is_active
  where org_a.is_active
  limit 1
)
select case
  when not exists (select 1 from mismatch) then 'NOT VERIFIED: need two active organizations with queues'
  when (select public.get_public_queue_details(public_identifier, foreign_queue_id) is null from mismatch)
   and (select public.get_organization_queue_availability(public_identifier, foreign_queue_id) = 'CLOSED' from mismatch)
    then 'PASS'
  else 'FAIL'
end as cross_organization_public_lookup_isolation;

-- Inspect per-queue active counters; queue_id is the independent numbering scope.
select s.organization_id, s.queue_id, s.session_date, s.queue_prefix, s.next_number
from public.queue_sessions s
where s.is_active and s.session_date = current_date
order by s.organization_id, s.queue_id;