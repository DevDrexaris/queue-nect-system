-- Multi-location / multi-queue foundation with legacy single-queue backfill.
-- Review and apply manually after 20261002_queue_availability.sql and
-- 20261003_walk_in_registration.sql. No queue records are deleted.
begin;

create table if not exists public.organization_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  location_type text not null default 'Other'
    check (location_type in ('Building', 'Clinic', 'Branch', 'Department', 'Other')),
  description text,
  address_or_floor text,
  contact_information text,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index if not exists organization_locations_one_default_idx
  on public.organization_locations (organization_id)
  where is_default;

create table if not exists public.organization_queues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.organization_locations(id) on delete restrict,
  name text not null,
  queue_prefix text not null default 'A' check (length(queue_prefix) between 1 and 5),
  public_identifier text not null unique,
  description text,
  service_area text,
  admission_status text not null default 'OPEN'
    check (admission_status in ('OPEN', 'PAUSED', 'CLOSED')),
  opening_time time,
  closing_time time,
  time_zone text,
  operating_days smallint[] check (operating_days is null or operating_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, location_id)
    references public.organization_locations(organization_id, id)
    on delete restrict
);

create unique index if not exists organization_queues_one_default_idx
  on public.organization_queues (organization_id)
  where is_default;

create index if not exists organization_queues_location_active_idx
  on public.organization_queues (organization_id, location_id, is_active, name);

create or replace function public.create_default_queue_for_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location_id uuid;
  v_queue_id uuid;
begin
  insert into public.organization_locations (
    organization_id, name, location_type, description, is_default
  ) values (
    new.id, 'Main Location', 'Other', 'Default location for this organization.', true
  ) returning id into v_location_id;

  insert into public.organization_queues (
    organization_id, location_id, name, queue_prefix, public_identifier,
    description, service_area, admission_status, is_default
  ) values (
    new.id, v_location_id, 'Main Queue', new.queue_prefix,
    new.public_identifier || '-main', 'Default queue for this organization.',
    'the service desk', 'OPEN', true
  ) returning id into v_queue_id;

  insert into public.queue_sessions (
    organization_id, queue_id, session_date, queue_prefix, next_number, is_active, admission_status
  ) values (
    new.id, v_queue_id, current_date, new.queue_prefix, 1, true, 'OPEN'
  );

  return new;
end;
$$;

drop trigger if exists organizations_create_default_queue on public.organizations;
create trigger organizations_create_default_queue
after insert on public.organizations
for each row execute function public.create_default_queue_for_organization();

alter table public.queue_sessions
  add column if not exists queue_id uuid;

alter table public.queue_entries
  add column if not exists queue_id uuid,
  add column if not exists registration_source text not null default 'QR';

alter table public.queue_history
  add column if not exists queue_id uuid;

alter table public.organization_qr_tokens
  add column if not exists queue_id uuid;

alter table public.profiles
  add column if not exists location_id uuid,
  add column if not exists queue_id uuid;

-- Preserve current organizations and all queue data by attaching existing rows
-- to one default location and queue, once per organization.
insert into public.organization_locations (
  organization_id, name, location_type, description, is_default
)
select o.id, 'Main Location', 'Other', 'Default location migrated from the existing organization queue.', true
from public.organizations o
where not exists (
  select 1 from public.organization_locations l
  where l.organization_id = o.id and l.is_default
);

insert into public.organization_queues (
  organization_id, location_id, name, queue_prefix, public_identifier, description,
  service_area, is_default
)
select
  o.id,
  l.id,
  'Main Queue',
  o.queue_prefix,
  o.public_identifier || '-main',
  'Default queue migrated from the existing organization queue.',
  coalesce(o.announcement_service_area, 'the service desk'),
  true
from public.organizations o
join public.organization_locations l on l.organization_id = o.id and l.is_default
where not exists (
  select 1 from public.organization_queues q
  where q.organization_id = o.id and q.is_default
);

update public.queue_sessions s
set queue_id = q.id
from public.organization_queues q
where q.organization_id = s.organization_id
  and q.is_default
  and s.queue_id is null;

update public.organization_queues q
set admission_status = s.admission_status
from public.queue_sessions s
where s.queue_id = q.id
  and s.session_date = current_date;

update public.queue_entries e
set queue_id = s.queue_id
from public.queue_sessions s
where s.id = e.queue_session_id
  and e.queue_id is null;

update public.queue_history h
set queue_id = s.queue_id
from public.queue_sessions s
where s.id = h.queue_session_id
  and h.queue_id is null;

update public.organization_qr_tokens t
set queue_id = q.id
from public.organization_queues q
where q.organization_id = t.organization_id
  and q.is_default
  and t.queue_id is null;

update public.profiles p
set location_id = l.id
from public.organization_locations l
where l.organization_id = p.organization_id
  and l.is_default
  and p.location_id is null;

update public.profiles p
set queue_id = q.id
from public.organization_queues q
where q.organization_id = p.organization_id
  and q.is_default
  and p.queue_id is null;

update public.queue_entries e
set registration_source = 'QR'
where e.registration_source is null;

do $$
declare
  v_spec record;
  v_actual pg_constraint%rowtype;
  v_source_columns smallint[];
  v_target_columns smallint[];
  v_source_names text;
  v_target_names text;
begin
  for v_spec in
    select * from (values
      (
        'public.queue_sessions'::regclass,
        'queue_sessions_queue_id_fkey'::text,
        'public.organization_queues'::regclass,
        array['organization_id', 'queue_id']::text[],
        array['organization_id', 'id']::text[],
        'r'::"char"
      ),
      (
        'public.profiles'::regclass,
        'profiles_location_id_fkey'::text,
        'public.organization_locations'::regclass,
        array['location_id']::text[],
        array['id']::text[],
        'n'::"char"
      ),
      (
        'public.profiles'::regclass,
        'profiles_queue_id_fkey'::text,
        'public.organization_queues'::regclass,
        array['queue_id']::text[],
        array['id']::text[],
        'n'::"char"
      ),
      (
        'public.queue_entries'::regclass,
        'queue_entries_queue_id_fkey'::text,
        'public.organization_queues'::regclass,
        array['organization_id', 'queue_id']::text[],
        array['organization_id', 'id']::text[],
        'r'::"char"
      ),
      (
        'public.queue_history'::regclass,
        'queue_history_queue_id_fkey'::text,
        'public.organization_queues'::regclass,
        array['organization_id', 'queue_id']::text[],
        array['organization_id', 'id']::text[],
        'r'::"char"
      ),
      (
        'public.organization_qr_tokens'::regclass,
        'organization_qr_tokens_queue_id_fkey'::text,
        'public.organization_queues'::regclass,
        array['organization_id', 'queue_id']::text[],
        array['organization_id', 'id']::text[],
        'r'::"char"
      )
    ) as expected(source_table, constraint_name, target_table, source_names, target_names, delete_action)
  loop
    select array_agg(a.attnum::smallint order by names.ordinality)
      into v_source_columns
    from unnest(v_spec.source_names) with ordinality as names(column_name, ordinality)
    join pg_attribute a
      on a.attrelid = v_spec.source_table
      and a.attname = names.column_name
      and not a.attisdropped;

    select array_agg(a.attnum::smallint order by names.ordinality)
      into v_target_columns
    from unnest(v_spec.target_names) with ordinality as names(column_name, ordinality)
    join pg_attribute a
      on a.attrelid = v_spec.target_table
      and a.attname = names.column_name
      and not a.attisdropped;

    if v_source_columns is null or v_target_columns is null then
      raise exception 'Required columns missing for constraint %', v_spec.constraint_name;
    end if;

    select * into v_actual
    from pg_constraint c
    where c.conrelid = v_spec.source_table
      and c.conname = v_spec.constraint_name;

    if found then
      if v_actual.contype <> 'f'
         or v_actual.confrelid <> v_spec.target_table
         or v_actual.conkey is distinct from v_source_columns
         or v_actual.confkey is distinct from v_target_columns
         or v_actual.confdeltype <> v_spec.delete_action
         or not v_actual.convalidated then
        raise exception 'Existing constraint % has a different or unvalidated definition', v_spec.constraint_name;
      end if;
    else
      if exists (
        select 1 from pg_constraint c
        where c.conrelid = v_spec.source_table
          and c.contype = 'f'
          and c.confrelid = v_spec.target_table
          and c.conkey = v_source_columns
          and c.confkey = v_target_columns
          and c.confdeltype = v_spec.delete_action
          and c.convalidated
      ) then
        continue;
      end if;

      select string_agg(format('%I', column_name), ', ' order by ordinality)
        into v_source_names
      from unnest(v_spec.source_names) with ordinality as names(column_name, ordinality);

      select string_agg(format('%I', column_name), ', ' order by ordinality)
        into v_target_names
      from unnest(v_spec.target_names) with ordinality as names(column_name, ordinality);

      execute format(
        'alter table %s add constraint %I foreign key (%s) references %s (%s) on delete %s',
        v_spec.source_table,
        v_spec.constraint_name,
        v_source_names,
        v_spec.target_table,
        v_target_names,
        case v_spec.delete_action when 'n'::"char" then 'set null' else 'restrict' end
      );
    end if;
  end loop;
end
$$;

create or replace function public.enforce_profile_queue_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     and new.role = 'STAFF'
     and new.organization_id is not null
     and new.location_id is null
     and new.queue_id is null then
    select id, location_id into new.queue_id, new.location_id
    from public.organization_queues
    where organization_id = new.organization_id and is_default and is_active
    limit 1;
  end if;

  if tg_op = 'UPDATE'
     and new.organization_id is distinct from old.organization_id
     and not public.is_super_admin() then
    raise exception 'Only a system administrator can move a profile between organizations';
  end if;

  if tg_op = 'UPDATE'
     and (new.location_id is distinct from old.location_id or new.queue_id is distinct from old.queue_id)
     and not (public.is_super_admin() or public.is_org_admin(old.organization_id)) then
    raise exception 'Only organization administrators can assign staff to locations or queues';
  end if;

  if new.location_id is not null and not exists (
    select 1 from public.organization_locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'Staff location must belong to the same organization';
  end if;

  if new.queue_id is not null and not exists (
    select 1 from public.organization_queues q
    where q.id = new.queue_id and q.organization_id = new.organization_id
      and (new.location_id is null or q.location_id = new.location_id)
  ) then
    raise exception 'Staff queue must belong to the same organization and assigned location';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_enforce_queue_assignment on public.profiles;
create trigger profiles_enforce_queue_assignment
before insert or update on public.profiles
for each row execute function public.enforce_profile_queue_assignment();

create or replace function public.can_manage_organization_queue(
  p_organization_id uuid,
  p_queue_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or public.is_org_admin(p_organization_id)
    or exists (
      select 1
      from public.profiles p
      join public.organization_queues q on q.id = p_queue_id
      where p.id = auth.uid()
        and p.organization_id = p_organization_id
        and p.role = 'STAFF'
        and p.is_active
        and q.organization_id = p_organization_id
        and (p.queue_id = q.id or p.location_id = q.location_id)
    );
$$;

revoke all on function public.can_manage_organization_queue(uuid, uuid) from public;
grant execute on function public.can_manage_organization_queue(uuid, uuid) to authenticated;

-- Session uniqueness becomes queue-scoped while retaining a single legacy slot.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.queue_sessions'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, session_date)'
  loop
    execute format('alter table public.queue_sessions drop constraint %I', constraint_name);
  end loop;
end
$$;

create unique index if not exists queue_sessions_legacy_org_date_uidx
  on public.queue_sessions (organization_id, session_date)
  where queue_id is null;

create unique index if not exists queue_sessions_queue_date_uidx
  on public.queue_sessions (organization_id, queue_id, session_date)
  where queue_id is not null;

create index if not exists queue_entries_queue_status_joined_idx
  on public.queue_entries (organization_id, queue_id, status, joined_at);

create or replace function public.enforce_queue_entry_session_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_session public.queue_sessions%rowtype;
begin
  select * into v_session from public.queue_sessions where id = new.queue_session_id;
  if not found or v_session.organization_id <> new.organization_id then
    raise exception 'Queue entry session does not belong to this organization';
  end if;

  if new.queue_id is null then
    new.queue_id := v_session.queue_id;
  elsif new.queue_id is distinct from v_session.queue_id then
    raise exception 'Queue entry queue does not match its session';
  end if;

  if tg_op = 'UPDATE' and new.queue_id is distinct from old.queue_id then
    raise exception 'Queue entry queue is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists queue_entries_enforce_session_scope on public.queue_entries;
create trigger queue_entries_enforce_session_scope
before insert or update on public.queue_entries
for each row execute function public.enforce_queue_entry_session_scope();

drop view if exists public.public_queue_snapshot;
create view public.public_queue_snapshot as
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
  q.updated_at
from public.queue_entries q
join public.organizations o on o.id = q.organization_id
left join public.organization_queues oq on oq.id = q.queue_id
left join public.organization_locations l on l.id = oq.location_id
where q.status in ('WAITING', 'CALLED', 'SERVING', 'AWAITING_RETURN')
  and o.is_active = true
  and (oq.id is null or oq.is_active = true);

revoke all on public.public_queue_snapshot from public, anon, authenticated;
grant select on public.public_queue_snapshot to anon, authenticated;

alter table public.organization_locations enable row level security;
alter table public.organization_queues enable row level security;
alter table public.queue_entries enable row level security;
alter table public.queue_history enable row level security;

revoke all on public.organization_locations from public, anon, authenticated;
revoke all on public.organization_queues from public, anon, authenticated;
grant select on public.organization_locations to authenticated;
grant select on public.organization_queues to authenticated;

drop policy if exists "Org staff can view organization locations" on public.organization_locations;
drop policy if exists "Assigned staff can view organization locations" on public.organization_locations;
create policy "Assigned staff can view organization locations"
on public.organization_locations
for select to authenticated
using (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.organization_id = organization_locations.organization_id
      and p.role = 'STAFF' and p.is_active
      and (p.location_id = organization_locations.id or p.queue_id in (
        select q.id from public.organization_queues q where q.location_id = organization_locations.id
      ))
  )
);

drop policy if exists "Org staff can view organization queues" on public.organization_queues;
drop policy if exists "Assigned staff can view organization queues" on public.organization_queues;
create policy "Assigned staff can view organization queues"
on public.organization_queues
for select to authenticated
using (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
  or public.can_manage_organization_queue(organization_id, id)
);

drop policy if exists "Public can read active queue sessions for active organizations" on public.queue_sessions;
drop policy if exists "Staff can view queue sessions for their org" on public.queue_sessions;
drop policy if exists "Staff can insert queue sessions for their org" on public.queue_sessions;
drop policy if exists "Staff can update queue sessions for their org" on public.queue_sessions;
drop policy if exists "Assigned staff can view queue sessions" on public.queue_sessions;
create policy "Assigned staff can view queue sessions"
on public.queue_sessions
for select to authenticated
using (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
  or public.can_manage_organization_queue(organization_id, queue_id)
);

revoke all on public.queue_sessions from public, anon;
revoke insert, update, delete on public.queue_sessions from authenticated;
grant select on public.queue_sessions to authenticated;

drop policy if exists "Org staff can view queue entries for their org" on public.queue_entries;
drop policy if exists "Assigned staff can view queue entries" on public.queue_entries;
create policy "Assigned staff can view queue entries"
on public.queue_entries
for select to authenticated
using (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
  or public.can_manage_organization_queue(organization_id, queue_id)
);

drop policy if exists "Org staff can view history for their org" on public.queue_history;
drop policy if exists "Assigned staff can view queue history" on public.queue_history;
create policy "Assigned staff can view queue history"
on public.queue_history
for select to authenticated
using (
  public.is_super_admin()
  or public.is_org_admin(organization_id)
  or public.can_manage_organization_queue(organization_id, queue_id)
);

create or replace function public.create_organization_location(
  p_organization_id uuid,
  p_name text,
  p_location_type text,
  p_description text default null,
  p_address_or_floor text default null,
  p_contact_information text default null
)
returns public.organization_locations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location public.organization_locations%rowtype;
begin
  if not (public.is_super_admin() or public.is_org_admin(p_organization_id)) then
    raise exception 'Not authorized to manage locations for this organization';
  end if;
  if nullif(trim(p_name), '') is null then raise exception 'Location name is required'; end if;
  if p_location_type not in ('Building', 'Clinic', 'Branch', 'Department', 'Other') then
    raise exception 'Invalid location type';
  end if;

  insert into public.organization_locations (
    organization_id, name, location_type, description, address_or_floor, contact_information
  ) values (
    p_organization_id, trim(p_name), p_location_type,
    nullif(trim(p_description), ''), nullif(trim(p_address_or_floor), ''),
    nullif(trim(p_contact_information), '')
  ) returning * into v_location;

  insert into public.activity_log (organization_id, performed_by, action, details)
  values (p_organization_id, auth.uid(), 'LOCATION_CREATED',
    jsonb_build_object('location_id', v_location.id, 'name', v_location.name, 'location_type', v_location.location_type));

  return v_location;
end;
$$;

create or replace function public.update_organization_location(
  p_location_id uuid,
  p_name text,
  p_location_type text,
  p_description text,
  p_address_or_floor text,
  p_contact_information text,
  p_is_active boolean
)
returns public.organization_locations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location public.organization_locations%rowtype;
begin
  select * into v_location from public.organization_locations where id = p_location_id for update;
  if not found or not (public.is_super_admin() or public.is_org_admin(v_location.organization_id)) then
    raise exception 'Location not found or not authorized';
  end if;
  if v_location.is_default and not p_is_active then
    raise exception 'The default location cannot be deactivated';
  end if;
  if nullif(trim(p_name), '') is null then raise exception 'Location name is required'; end if;

  update public.organization_locations
  set name = trim(p_name), location_type = p_location_type,
      description = nullif(trim(p_description), ''),
      address_or_floor = nullif(trim(p_address_or_floor), ''),
      contact_information = nullif(trim(p_contact_information), ''),
      is_active = p_is_active, updated_at = now()
  where id = p_location_id
  returning * into v_location;
  insert into public.activity_log (organization_id, performed_by, action, details)
  values (v_location.organization_id, auth.uid(), 'LOCATION_UPDATED',
    jsonb_build_object('location_id', v_location.id, 'name', v_location.name, 'is_active', v_location.is_active));

  if not p_is_active then
    update public.organization_queues
    set is_active = false, admission_status = 'CLOSED', updated_at = now()
    where location_id = p_location_id;
    update public.queue_sessions
    set admission_status = 'CLOSED', updated_at = now()
    where queue_id in (select id from public.organization_queues where location_id = p_location_id)
      and session_date = current_date and is_active;
  end if;
  return v_location;
end;
$$;

create or replace function public.create_organization_queue(
  p_organization_id uuid,
  p_location_id uuid,
  p_name text,
  p_queue_prefix text,
  p_description text default null,
  p_service_area text default null,
  p_admission_status text default 'OPEN',
  p_opening_time time default null,
  p_closing_time time default null,
  p_time_zone text default null,
  p_operating_days smallint[] default null
)
returns public.organization_queues
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.organization_queues%rowtype;
  v_org public.organizations%rowtype;
  v_slug text;
begin
  if not (public.is_super_admin() or public.is_org_admin(p_organization_id)) then
    raise exception 'Not authorized to manage queues for this organization';
  end if;
  if nullif(trim(p_name), '') is null then raise exception 'Queue name is required'; end if;
  if nullif(trim(p_queue_prefix), '') is null or length(trim(p_queue_prefix)) > 5 then
    raise exception 'Queue prefix must contain between 1 and 5 characters';
  end if;
  if p_admission_status not in ('OPEN', 'PAUSED', 'CLOSED') then
    raise exception 'Invalid queue availability';
  end if;
  if not exists (
    select 1 from public.organization_locations
    where id = p_location_id and organization_id = p_organization_id and is_active
  ) then
    raise exception 'Select an active location belonging to this organization';
  end if;

  select * into v_org from public.organizations where id = p_organization_id;
  v_slug := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));

  insert into public.organization_queues (
    organization_id, location_id, name, queue_prefix, public_identifier,
    description, service_area, admission_status, opening_time, closing_time, time_zone, operating_days
  ) values (
    p_organization_id, p_location_id, trim(p_name), upper(trim(p_queue_prefix)),
    v_org.public_identifier || '-' || coalesce(nullif(v_slug, ''), 'queue') || '-' || substr(gen_random_uuid()::text, 1, 8),
    nullif(trim(p_description), ''), nullif(trim(p_service_area), ''), p_admission_status,
    p_opening_time, p_closing_time, nullif(trim(p_time_zone), ''), p_operating_days
  ) returning * into v_queue;

  insert into public.queue_sessions (
    organization_id, queue_id, session_date, queue_prefix, next_number, is_active, admission_status
  ) values (
    p_organization_id, v_queue.id, current_date, v_queue.queue_prefix, 1, true, p_admission_status
  );

  insert into public.activity_log (organization_id, performed_by, action, details)
  values (p_organization_id, auth.uid(), 'QUEUE_CREATED',
    jsonb_build_object('queue_id', v_queue.id, 'location_id', p_location_id, 'name', v_queue.name));

  return v_queue;
end;
$$;

create or replace function public.update_organization_queue(
  p_queue_id uuid,
  p_location_id uuid,
  p_name text,
  p_queue_prefix text,
  p_description text,
  p_service_area text,
  p_is_active boolean,
  p_opening_time time default null,
  p_closing_time time default null,
  p_time_zone text default null,
  p_operating_days smallint[] default null,
  p_admission_status text default null
)
returns public.organization_queues
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.organization_queues%rowtype;
  v_previous_admission text;
begin
  select * into v_queue from public.organization_queues where id = p_queue_id for update;
  if not found or not (public.is_super_admin() or public.is_org_admin(v_queue.organization_id)) then
    raise exception 'Queue not found or not authorized';
  end if;
  if v_queue.is_default and not p_is_active then
    raise exception 'The default queue cannot be deactivated';
  end if;
  v_previous_admission := v_queue.admission_status;
  if not exists (
    select 1 from public.organization_locations
    where id = p_location_id and organization_id = v_queue.organization_id and is_active
  ) then
    raise exception 'Select an active location belonging to this organization';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_queue_prefix), '') is null then
    raise exception 'Queue name and prefix are required';
  end if;
  if p_admission_status is not null and p_admission_status not in ('OPEN', 'PAUSED', 'CLOSED') then
    raise exception 'Invalid queue availability';
  end if;

  update public.organization_queues
  set location_id = p_location_id, name = trim(p_name),
      queue_prefix = upper(trim(p_queue_prefix)),
      description = nullif(trim(p_description), ''),
      service_area = nullif(trim(p_service_area), ''),
      is_active = p_is_active, opening_time = p_opening_time,
      closing_time = p_closing_time, time_zone = nullif(trim(p_time_zone), ''),
      admission_status = case when p_is_active then coalesce(p_admission_status, admission_status) else 'CLOSED' end,
      operating_days = p_operating_days, updated_at = now()
  where id = p_queue_id
  returning * into v_queue;

  if not p_is_active then
    update public.queue_sessions
    set admission_status = 'CLOSED', updated_at = now()
    where queue_id = p_queue_id and session_date = current_date and is_active;
  elsif p_admission_status is not null then
    update public.queue_sessions
    set admission_status = p_admission_status, updated_at = now()
    where queue_id = p_queue_id and session_date = current_date and is_active;
  end if;
  insert into public.activity_log (organization_id, performed_by, action, details)
  values (v_queue.organization_id, auth.uid(), 'QUEUE_UPDATED',
    jsonb_build_object('queue_id', v_queue.id, 'location_id', v_queue.location_id, 'name', v_queue.name, 'is_active', v_queue.is_active));
  if v_previous_admission is distinct from v_queue.admission_status then
    insert into public.activity_log (organization_id, performed_by, action, details)
    values (
      v_queue.organization_id,
      auth.uid(),
      case v_queue.admission_status
        when 'OPEN' then 'QUEUE_AVAILABILITY_OPENED'
        when 'PAUSED' then 'QUEUE_AVAILABILITY_PAUSED'
        else 'QUEUE_AVAILABILITY_CLOSED'
      end,
      jsonb_build_object('queue_id', v_queue.id, 'location_id', v_queue.location_id,
        'previous_state', v_previous_admission, 'new_state', v_queue.admission_status)
    );
    perform realtime.send(
      jsonb_build_object('event_type', 'queue_availability_changed', 'queue_id', v_queue.id,
        'availability', v_queue.admission_status, 'updated_at', now()),
      'queue_changed',
      (select public_identifier from public.organizations where id = v_queue.organization_id),
      false
    );
  end if;
  return v_queue;
end;
$$;

create or replace function public.archive_organization_location(p_location_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location public.organization_locations%rowtype;
begin
  select * into v_location from public.organization_locations where id = p_location_id for update;
  if not found or not (public.is_super_admin() or public.is_org_admin(v_location.organization_id)) then
    raise exception 'Location not found or not authorized';
  end if;
  if v_location.is_default then raise exception 'The default location cannot be archived'; end if;
  if exists (
    select 1
    from public.organization_queues q
    join public.queue_sessions s on s.queue_id = q.id and s.organization_id = q.organization_id
      and s.session_date = current_date and s.is_active
    join public.queue_entries e on e.queue_session_id = s.id
    where q.location_id = p_location_id
      and e.status in ('WAITING', 'CALLED', 'SERVING', 'AWAITING_RETURN')
  ) then
    raise exception 'Finish active queue entries before archiving this location';
  end if;

  update public.organization_locations set is_active = false, updated_at = now() where id = p_location_id;
  update public.organization_queues set is_active = false, admission_status = 'CLOSED', updated_at = now() where location_id = p_location_id;
  update public.queue_sessions set admission_status = 'CLOSED', updated_at = now()
    where queue_id in (select id from public.organization_queues where location_id = p_location_id)
      and session_date = current_date and is_active;
  insert into public.activity_log (organization_id, performed_by, action, details)
  values (v_location.organization_id, auth.uid(), 'LOCATION_ARCHIVED',
    jsonb_build_object('location_id', v_location.id, 'name', v_location.name));
  return true;
end;
$$;

create or replace function public.archive_organization_queue(p_queue_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.organization_queues%rowtype;
begin
  select * into v_queue from public.organization_queues where id = p_queue_id for update;
  if not found or not (public.is_super_admin() or public.is_org_admin(v_queue.organization_id)) then
    raise exception 'Queue not found or not authorized';
  end if;
  if v_queue.is_default then raise exception 'The default queue cannot be archived'; end if;
  if exists (
    select 1
    from public.queue_sessions s
    join public.queue_entries e on e.queue_session_id = s.id
    where s.queue_id = p_queue_id and s.session_date = current_date and s.is_active
      and e.status in ('WAITING', 'CALLED', 'SERVING', 'AWAITING_RETURN')
  ) then
    raise exception 'Finish active queue entries before archiving this queue';
  end if;

  update public.organization_queues set is_active = false, admission_status = 'CLOSED', updated_at = now() where id = p_queue_id;
  update public.queue_sessions set admission_status = 'CLOSED', updated_at = now()
    where queue_id = p_queue_id and session_date = current_date and is_active;
  insert into public.activity_log (organization_id, performed_by, action, details)
  values (v_queue.organization_id, auth.uid(), 'QUEUE_ARCHIVED',
    jsonb_build_object('queue_id', v_queue.id, 'location_id', v_queue.location_id, 'name', v_queue.name));
  return true;
end;
$$;

create or replace function public.assign_profile_to_queue(
  p_profile_id uuid,
  p_location_id uuid,
  p_queue_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found or not (public.is_super_admin() or public.is_org_admin(v_profile.organization_id)) then
    raise exception 'Profile not found or not authorized';
  end if;
  if p_location_id is not null and not exists (
    select 1 from public.organization_locations
    where id = p_location_id and organization_id = v_profile.organization_id
  ) then raise exception 'Location does not belong to this organization'; end if;
  if p_queue_id is not null and not exists (
    select 1 from public.organization_queues
    where id = p_queue_id and organization_id = v_profile.organization_id
      and (p_location_id is null or location_id = p_location_id)
  ) then raise exception 'Queue does not belong to this organization/location'; end if;

  update public.profiles
  set location_id = p_location_id, queue_id = p_queue_id, updated_at = now()
  where id = p_profile_id;
  return true;
end;
$$;

create or replace function public.set_organization_queue_availability(
  p_queue_id uuid,
  p_admission_status text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.organization_queues%rowtype;
  v_session public.queue_sessions%rowtype;
  v_previous text;
  v_action text;
  v_has_session boolean;
begin
  if p_admission_status is null or p_admission_status not in ('OPEN', 'PAUSED', 'CLOSED') then
    raise exception 'Invalid queue availability';
  end if;

  select * into v_queue from public.organization_queues where id = p_queue_id for update;
  if not found or not public.can_manage_organization_queue(v_queue.organization_id, v_queue.id) then
    raise exception 'Queue not found or not authorized';
  end if;
  if not v_queue.is_active and p_admission_status = 'OPEN' then
    raise exception 'Archived queues cannot be opened';
  end if;

  select * into v_session
  from public.queue_sessions
  where organization_id = v_queue.organization_id
    and queue_id = v_queue.id
    and session_date = current_date
    and is_active = true
  for update;
  v_has_session := found;

  v_previous := v_queue.admission_status;
  if v_previous = p_admission_status then return v_previous; end if;

  update public.organization_queues
  set admission_status = p_admission_status, updated_at = now()
  where id = p_queue_id;
  if v_has_session then
    update public.queue_sessions
    set admission_status = p_admission_status, updated_at = now()
    where id = v_session.id;
  end if;

  v_action := case p_admission_status
    when 'OPEN' then 'QUEUE_AVAILABILITY_OPENED'
    when 'PAUSED' then 'QUEUE_AVAILABILITY_PAUSED'
    when 'CLOSED' then 'QUEUE_AVAILABILITY_CLOSED'
  end;
  insert into public.activity_log (organization_id, performed_by, action, details)
  values (v_queue.organization_id, auth.uid(), v_action,
    jsonb_build_object('queue_id', v_queue.id, 'location_id', v_queue.location_id,
      'previous_state', v_previous, 'new_state', p_admission_status));

  perform realtime.send(
    jsonb_build_object('event_type', 'queue_availability_changed', 'queue_id', v_queue.id,
      'availability', p_admission_status, 'updated_at', now()),
    'queue_changed',
    'public-queue:' || (select public_identifier from public.organizations where id = v_queue.organization_id),
    false
  );
  return p_admission_status;
end;
$$;

create or replace function public.get_organization_queue_availability(p_queue_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select q.admission_status
    from public.organization_queues q
    join public.organizations o on o.id = q.organization_id
    where q.id = p_queue_id and q.is_active and o.is_active
  ), 'CLOSED');
$$;

create or replace function public.get_queue_availability(p_public_identifier text)
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
    where o.public_identifier = p_public_identifier and q.is_default and q.is_active and o.is_active
    limit 1
  ), 'CLOSED');
$$;

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
  v_queue_id uuid;
begin
  select id into v_queue_id from public.organization_queues
  where organization_id = p_organization_id and is_default and is_active;
  if not found then raise exception 'No active default queue exists for this organization'; end if;
  return public.set_organization_queue_availability(v_queue_id, p_admission_status);
end;
$$;

create or replace function public.reset_queue_session(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue_id uuid;
begin
  select id into v_queue_id from public.organization_queues
  where organization_id = p_organization_id and is_default and is_active;
  if not found then raise exception 'No active default queue exists for this organization'; end if;
  return public.reset_organization_queue_session(v_queue_id);
end;
$$;

create or replace function public.get_default_queue_id(p_public_identifier text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select q.id
  from public.organizations o
  join public.organization_queues q on q.organization_id = o.id
  where o.public_identifier = p_public_identifier
    and o.is_active and q.is_active and q.is_default
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
  join public.organization_queues q on q.id = t.queue_id and q.organization_id = o.id
  join public.organization_locations l on l.id = q.location_id
  where t.token = p_token and t.is_active and o.is_active and q.is_active
    and (t.expires_at is null or t.expires_at > now())
  limit 1;
$$;

create or replace function public.get_public_queue_details(p_queue_id uuid)
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
  from public.organization_queues q
  join public.organizations o on o.id = q.organization_id
  join public.organization_locations l on l.id = q.location_id
  where q.id = p_queue_id and q.is_active and o.is_active and l.is_active
  limit 1;
$$;

-- New secure QR join path. The token binds the request to one queue, and the
-- queue row lock serializes admission with staff availability changes.
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
  v_queue_id uuid;
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
  where o.public_identifier = p_public_identifier and o.is_active
    and t.token = p_qr_token and t.is_active
    and (t.expires_at is null or t.expires_at > now())
  limit 1;
  if not found then raise exception 'Queue access is invalid or expired'; end if;

  select t.queue_id into v_queue_id
  from public.organization_qr_tokens t
  where t.organization_id = v_org.id and t.token = p_qr_token and t.is_active
    and (t.expires_at is null or t.expires_at > now())
  limit 1;

  select * into v_queue
  from public.organization_queues
  where id = v_queue_id and organization_id = v_org.id and is_active
  for update;
  if not found then raise exception 'QUEUE_CLOSED'; end if;
  if v_queue.admission_status = 'PAUSED' then raise exception 'QUEUE_PAUSED'; end if;
  if v_queue.admission_status <> 'OPEN' then raise exception 'QUEUE_CLOSED'; end if;

  select * into v_session
  from public.queue_sessions
  where organization_id = v_org.id and queue_id = v_queue.id
    and session_date = current_date and is_active
  for update;

  if not found then
    insert into public.queue_sessions (
      organization_id, queue_id, session_date, queue_prefix, next_number, is_active, admission_status
    ) values (
      v_org.id, v_queue.id, current_date, v_queue.queue_prefix, 1, true, v_queue.admission_status
    ) returning * into v_session;
  end if;

  if v_session.admission_status <> 'OPEN' then
    raise exception '%', case when v_session.admission_status = 'PAUSED' then 'QUEUE_PAUSED' else 'QUEUE_CLOSED' end;
  end if;

  if exists (
    select 1 from public.queue_entries q
    where q.queue_session_id = v_session.id and q.student_id = trim(p_student_id)
      and q.status in ('WAITING', 'CALLED', 'SERVING')
  ) then
    raise exception 'You already have an active queue entry for this session';
  end if;

  update public.queue_sessions
  set next_number = next_number + 1, updated_at = now()
  where id = v_session.id returning next_number - 1 into v_next;

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
  where organization_id = v_queue.organization_id and queue_id = v_queue.id
    and session_date = current_date and is_active
  for update;
  if not found then
    insert into public.queue_sessions (
      organization_id, queue_id, session_date, queue_prefix, next_number, is_active, admission_status
    ) values (
      v_queue.organization_id, v_queue.id, current_date, v_queue.queue_prefix, 1, true, v_queue.admission_status
    ) returning * into v_session;
  end if;
  if v_session.admission_status <> 'OPEN' then raise exception 'Queue is not open for new registrations'; end if;

  update public.queue_sessions
  set next_number = next_number + 1, updated_at = now()
  where id = v_session.id returning next_number - 1 into v_next;

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

create or replace function public.reset_organization_queue_session(p_queue_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.organization_queues%rowtype;
  v_session public.queue_sessions%rowtype;
begin
  select * into v_queue from public.organization_queues where id = p_queue_id for update;
  if not found or not public.can_manage_organization_queue(v_queue.organization_id, v_queue.id) then
    raise exception 'Queue not found or not authorized';
  end if;

  select * into v_session
  from public.queue_sessions
  where organization_id = v_queue.organization_id and queue_id = p_queue_id
    and session_date = current_date and is_active
  for update;
  if not found then raise exception 'There is no active queue session for today to reset'; end if;
  if exists (
    select 1 from public.queue_entries
    where queue_session_id = v_session.id
      and status in ('WAITING', 'CALLED', 'SERVING', 'AWAITING_RETURN')
  ) then
    raise exception 'Queue cannot be reset while active customers are still in the queue';
  end if;

  update public.queue_sessions set next_number = 1, updated_at = now() where id = v_session.id;
  return 1;
end;
$$;

create or replace function public.register_walk_in_patient(
  p_organization_id uuid,
  p_full_name text,
  p_reference_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue_id uuid;
begin
  select id into v_queue_id
  from public.organization_queues
  where organization_id = p_organization_id and is_default and is_active;
  if not found then raise exception 'No active default queue exists for this organization'; end if;
  return public.register_walk_in_for_queue(v_queue_id, p_full_name, p_reference_id);
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
  select * into v_entry from public.queue_entries where id = p_queue_entry_id for update;
  if not found or not public.can_manage_organization_queue(v_entry.organization_id, v_entry.queue_id) then
    raise exception 'Queue entry not found or not authorized';
  end if;
  perform 1 from public.queue_sessions where id = v_entry.queue_session_id for update;

  if p_action = 'call' and v_entry.status = 'WAITING' then
    if exists (
      select 1 from public.queue_entries q
      where q.queue_session_id = v_entry.queue_session_id
        and q.status in ('CALLED', 'SERVING') and q.id <> v_entry.id
    ) then raise exception 'Finish the active call before calling another number'; end if;
    update public.queue_entries set status = 'CALLED' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'return_to_waiting' and v_entry.status = 'CALLED' then
    update public.queue_entries set status = 'WAITING', called_at = null where id = v_entry.id returning * into v_entry;
  elsif p_action = 'serve' and v_entry.status = 'CALLED' then
    if exists (
      select 1 from public.queue_entries q
      where q.queue_session_id = v_entry.queue_session_id
        and q.status = 'SERVING' and q.id <> v_entry.id
    ) then raise exception 'Another number is already being served'; end if;
    update public.queue_entries set status = 'SERVING' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'awaiting_return' and v_entry.status in ('SERVING', 'CALLED') then
    update public.queue_entries set status = 'AWAITING_RETURN' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'call_again' and v_entry.status = 'AWAITING_RETURN' then
    if exists (
      select 1 from public.queue_entries q
      where q.queue_session_id = v_entry.queue_session_id
        and q.status in ('CALLED', 'SERVING') and q.id <> v_entry.id
    ) then raise exception 'Finish the active call before calling another number'; end if;
    update public.queue_entries set status = 'CALLED' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'complete' and v_entry.status = 'SERVING' then
    update public.queue_entries set status = 'COMPLETED' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'skip' and v_entry.status in ('WAITING', 'CALLED', 'AWAITING_RETURN') then
    update public.queue_entries set status = 'NO_SHOW' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'cancel' and v_entry.status in ('WAITING', 'CALLED', 'SERVING', 'AWAITING_RETURN') then
    update public.queue_entries
    set status = 'CANCELLED', cancellation_source = 'ADMIN'
    where id = v_entry.id returning * into v_entry;
  else
    raise exception 'Action is not allowed for the current queue state';
  end if;

  return to_jsonb(v_entry);
end;
$$;

create or replace function public.delete_queue_entry(p_queue_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.queue_entries%rowtype;
begin
  select * into v_entry from public.queue_entries where id = p_queue_entry_id for update;
  if not found or not public.can_manage_organization_queue(v_entry.organization_id, v_entry.queue_id) then
    raise exception 'Queue entry not found or not authorized';
  end if;
  if v_entry.status not in ('COMPLETED', 'CANCELLED', 'NO_SHOW') then
    raise exception 'Only completed, cancelled, or no-show entries can be deleted';
  end if;

  insert into public.queue_history (
    organization_id, queue_session_id, queue_entry_id, queue_id, queue_reference,
    queue_number, student_id, full_name, course, year_level, purpose, status,
    joined_at, called_at, started_at, completed_at, cancelled_at, no_show_at
  ) values (
    v_entry.organization_id, v_entry.queue_session_id, v_entry.id, v_entry.queue_id,
    v_entry.queue_reference, v_entry.queue_number, v_entry.student_id, v_entry.full_name,
    v_entry.course, v_entry.year_level, v_entry.purpose, v_entry.status,
    v_entry.joined_at, v_entry.called_at, v_entry.started_at, v_entry.completed_at,
    v_entry.cancelled_at, v_entry.no_show_at
  );

  delete from public.queue_entries where id = p_queue_entry_id;
  return to_jsonb(v_entry);
end;
$$;

create or replace function public.get_organization_location_queue_stats(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not (public.is_super_admin() or public.is_org_staff(p_organization_id)) then
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
    join public.organization_queues q on q.location_id = l.id and q.organization_id = l.organization_id
    left join public.queue_sessions s on s.queue_id = q.id
      and s.organization_id = q.organization_id and s.session_date = current_date and s.is_active
    left join public.queue_entries e on e.queue_session_id = s.id
    where l.organization_id = p_organization_id and l.is_active
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
    where l.organization_id = p_organization_id and l.is_active
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

revoke all on function public.create_organization_location(uuid, text, text, text, text, text) from public;
revoke all on function public.update_organization_location(uuid, text, text, text, text, text, boolean) from public;
revoke all on function public.create_organization_queue(uuid, uuid, text, text, text, text, text, time, time, text, smallint[]) from public;
revoke all on function public.update_organization_queue(uuid, uuid, text, text, text, text, boolean, time, time, text, smallint[], text) from public;
revoke all on function public.archive_organization_location(uuid) from public;
revoke all on function public.archive_organization_queue(uuid) from public;
revoke all on function public.assign_profile_to_queue(uuid, uuid, uuid) from public;
revoke all on function public.set_organization_queue_availability(uuid, text) from public;
revoke all on function public.reset_organization_queue_session(uuid) from public;
revoke all on function public.register_walk_in_for_queue(uuid, text, text) from public;
revoke all on function public.register_walk_in_patient(uuid, text, text) from public;
revoke all on function public.join_queue_with_status_token(text, text, text, text, text, text, text) from public;
revoke all on function public.get_default_queue_id(text) from public;
revoke all on function public.resolve_queue_qr_token(text) from public;
revoke all on function public.get_public_queue_details(uuid) from public;
revoke all on function public.get_organization_queue_availability(uuid) from public;
revoke all on function public.get_organization_location_queue_stats(uuid) from public;
revoke all on function public.get_queue_availability(text) from public;
revoke all on function public.set_queue_availability(uuid, text) from public;
revoke all on function public.reset_queue_session(uuid) from public;
revoke all on function public.transition_queue_entry(uuid, text) from public;
revoke all on function public.delete_queue_entry(uuid) from public;

grant execute on function public.create_organization_location(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.update_organization_location(uuid, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.create_organization_queue(uuid, uuid, text, text, text, text, text, time, time, text, smallint[]) to authenticated;
grant execute on function public.update_organization_queue(uuid, uuid, text, text, text, text, boolean, time, time, text, smallint[], text) to authenticated;
grant execute on function public.archive_organization_location(uuid) to authenticated;
grant execute on function public.archive_organization_queue(uuid) to authenticated;
grant execute on function public.assign_profile_to_queue(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_organization_queue_availability(uuid, text) to authenticated;
grant execute on function public.reset_organization_queue_session(uuid) to authenticated;
grant execute on function public.register_walk_in_for_queue(uuid, text, text) to authenticated;
grant execute on function public.register_walk_in_patient(uuid, text, text) to authenticated;
grant execute on function public.join_queue_with_status_token(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_default_queue_id(text) to anon, authenticated;
grant execute on function public.resolve_queue_qr_token(text) to anon, authenticated;
grant execute on function public.get_public_queue_details(uuid) to anon, authenticated;
grant execute on function public.get_organization_queue_availability(uuid) to anon, authenticated;
grant execute on function public.get_organization_location_queue_stats(uuid) to authenticated;
grant execute on function public.get_queue_availability(text) to anon, authenticated;
grant execute on function public.set_queue_availability(uuid, text) to authenticated;
grant execute on function public.reset_queue_session(uuid) to authenticated;
grant execute on function public.transition_queue_entry(uuid, text) to authenticated;
grant execute on function public.delete_queue_entry(uuid) to authenticated;

commit;
