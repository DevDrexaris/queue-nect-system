-- Queue-Nect Supabase SQL schema
-- Run this in the Supabase SQL Editor.

create extension if not exists pgcrypto;

create type public.user_role as enum ('ADMIN', 'ORG_ADMIN', 'STAFF', 'SUPER_ADMIN');
create type public.queue_status as enum ('WAITING', 'CALLED', 'SERVING', 'AWAITING_RETURN', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
create type public.organization_status as enum ('active', 'disabled');

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organization_type text not null default 'clinic',
  address text,
  contact_information text,
  queue_prefix text not null default 'A' check (length(queue_prefix) between 1 and 5),
  public_identifier text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  full_name text not null,
  email text not null unique,
  role public.user_role not null default 'STAFF',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token text not null unique,
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organization_qr_tokens_org_idx
  on public.organization_qr_tokens (organization_id, is_active, created_at desc);

create trigger organization_qr_tokens_set_updated_at
before update on public.organization_qr_tokens
for each row execute function public.set_updated_at();

create table if not exists public.queue_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_date date not null,
  queue_prefix text not null default 'A',
  next_number integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, session_date)
);

create table if not exists public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  queue_session_id uuid not null references public.queue_sessions(id) on delete cascade,
  queue_reference text not null unique default gen_random_uuid()::text,
  queue_number text not null,
  student_id text not null,
  full_name text not null,
  course text not null,
  year_level text not null,
  purpose text not null,
  status public.queue_status not null default 'WAITING',
  joined_at timestamptz not null default now(),
  called_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  no_show_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, queue_session_id, queue_number)
);

create table if not exists public.queue_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  queue_session_id uuid not null references public.queue_sessions(id) on delete cascade,
  queue_entry_id uuid not null references public.queue_entries(id) on delete cascade,
  queue_number text not null,
  student_id text not null,
  full_name text not null,
  course text not null,
  year_level text not null,
  purpose text not null,
  status public.queue_status not null,
  joined_at timestamptz not null,
  called_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  no_show_at timestamptz,
  archived_at timestamptz not null default now()
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  performed_by uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists organizations_public_identifier_idx
  on public.organizations (public_identifier);

create index if not exists organizations_active_idx
  on public.organizations (is_active);

create index if not exists profiles_org_role_idx
  on public.profiles (organization_id, role, is_active);

create index if not exists queue_sessions_org_date_idx
  on public.queue_sessions (organization_id, session_date);

create index if not exists queue_entries_org_status_idx
  on public.queue_entries (organization_id, status, joined_at desc);

create index if not exists queue_entries_session_idx
  on public.queue_entries (queue_session_id, status, joined_at asc);

create index if not exists queue_entries_reference_idx
  on public.queue_entries (queue_reference);

create index if not exists queue_history_org_status_idx
  on public.queue_history (organization_id, status, archived_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger queue_sessions_set_updated_at
before update on public.queue_sessions
for each row execute function public.set_updated_at();

create trigger queue_entries_set_updated_at
before update on public.queue_entries
for each row execute function public.set_updated_at();

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'SUPER_ADMIN'
      and p.is_active = true
  );
$$;

create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.organization_id = p_org_id
      and p.is_active = true
      and p.role in ('ADMIN', 'ORG_ADMIN')
  );
$$;

create or replace function public.is_org_staff(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.organization_id = p_org_id
      and p.is_active = true
      and p.role in ('ADMIN', 'ORG_ADMIN', 'STAFF')
  );
$$;

alter table public.organizations enable row level security;
alter table public.organization_qr_tokens enable row level security;
alter table public.profiles enable row level security;
alter table public.queue_sessions enable row level security;
alter table public.queue_entries enable row level security;
alter table public.queue_history enable row level security;
alter table public.activity_log enable row level security;

create policy "Public can view active organizations"
on public.organizations
for select
using (is_active = true);

create policy "Public can validate active QR access tokens"
on public.organization_qr_tokens
for select
using (is_active = true);

create policy "Public can create QR access tokens for active organizations"
on public.organization_qr_tokens
for insert
with check (
  exists (
    select 1
    from public.organizations o
    where o.id = organization_id
      and o.is_active = true
  )
);

create policy "Admins can manage QR access tokens for their org"
on public.organization_qr_tokens
for all
using (public.is_super_admin() or public.is_org_admin(organization_id))
with check (public.is_super_admin() or public.is_org_admin(organization_id));

create policy "Super admins can manage organizations"
on public.organizations
for all
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Admin can update their organization"
on public.organizations
for update
using (public.is_org_admin(id))
with check (public.is_org_admin(id));

create policy "Users can view their own profile"
on public.profiles
for select
using (auth.uid() = id);

create policy "Admins and super admins can view org profiles"
on public.profiles
for select
using (
  public.is_super_admin()
  or (organization_id is not null and public.is_org_staff(organization_id))
);

create policy "Users can update their own profile"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Super admins manage all profiles"
on public.profiles
for all
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Public can read active queue sessions for active organizations"
on public.queue_sessions
for select
using (
  is_active = true
  and exists (
    select 1
    from public.organizations o
    where o.id = organization_id
      and o.is_active = true
  )
);

create policy "Staff can view queue sessions for their org"
on public.queue_sessions
for select
using (
  public.is_super_admin() or public.is_org_staff(organization_id)
);

create policy "Staff can insert queue sessions for their org"
on public.queue_sessions
for insert
with check (
  public.is_super_admin() or public.is_org_admin(organization_id)
);

create policy "Staff can update queue sessions for their org"
on public.queue_sessions
for update
using (
  public.is_super_admin() or public.is_org_staff(organization_id)
)
with check (
  public.is_super_admin() or public.is_org_staff(organization_id)
);

create or replace function public.bump_queue_session_next_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.queue_sessions
  set next_number = next_number + 1,
      updated_at = now()
  where id = NEW.queue_session_id
    and organization_id = NEW.organization_id;

  return NEW;
end;
$$;

create trigger queue_entries_after_insert_bump_next_number
after insert on public.queue_entries
for each row
execute function public.bump_queue_session_next_number();

create policy "Public can view active queue entries for display"
on public.queue_entries
for select
using (
  status in ('WAITING', 'CALLED', 'SERVING')
  and organization_id in (
    select id from public.organizations where is_active = true
  )
);

create policy "Public can join an active queue with valid clinic access"
on public.queue_entries
for insert
with check (
  exists (
    select 1
    from public.organizations o
    where o.id = organization_id
      and o.is_active = true
  )
  and exists (
    select 1
    from public.queue_sessions qs
    where qs.id = queue_session_id
      and qs.organization_id = organization_id
      and qs.is_active = true
      and qs.session_date = current_date
  )
);

create policy "Public can create active queue sessions for clinics"
on public.queue_sessions
for insert
with check (
  exists (
    select 1
    from public.organizations o
    where o.id = organization_id
      and o.is_active = true
  )
  or public.is_super_admin()
  or public.is_org_admin(organization_id)
);

create policy "Org staff can manage org queue entries"
on public.queue_entries
for all
using (
  public.is_super_admin() or public.is_org_staff(organization_id)
)
with check (
  public.is_super_admin() or public.is_org_staff(organization_id)
);

create policy "Org staff can reset the active queue for their org"
on public.queue_entries
for delete
using (
  public.is_super_admin() or public.is_org_staff(organization_id)
);

create policy "Org staff can reset queue sessions for their org"
on public.queue_sessions
for update
using (
  public.is_super_admin() or public.is_org_staff(organization_id)
)
with check (
  public.is_super_admin() or public.is_org_staff(organization_id)
);

create policy "Org staff can view history for their org"
on public.queue_history
for select
using (
  public.is_super_admin() or public.is_org_staff(organization_id)
);

create policy "Org staff can insert history for their org"
on public.queue_history
for insert
with check (
  public.is_super_admin() or public.is_org_staff(organization_id)
);

create policy "Org staff can manage activity log for their org"
on public.activity_log
for all
using (
  public.is_super_admin() or public.is_org_staff(organization_id)
)
with check (
  public.is_super_admin() or public.is_org_staff(organization_id)
);

create or replace view public.public_queue_snapshot as
select
  q.id,
  q.organization_id,
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

create index if not exists public_queue_snapshot_org_status_idx
  on public.queue_entries (organization_id, status, joined_at asc);

-- Recommended queue-number generation pattern:
-- create a queue session per organization/day and assign queue_number = queue_prefix || LPAD(next_number::text, 3, '0')
-- then increment next_number safely from the app or via a transactional Postgres function.

-- Example helper for generating the next number in a session:
create or replace function public.next_queue_number(p_org_id uuid, p_session_date date)
returns text
language plpgsql
as $$
declare
  v_prefix text;
  v_next integer;
  v_session_id uuid;
begin
  select id, queue_prefix into v_session_id, v_prefix
  from public.queue_sessions
  where organization_id = p_org_id and session_date = p_session_date and is_active = true
  limit 1;

  if v_session_id is null then
    raise exception 'No active queue session found for this organization/date';
  end if;

  update public.queue_sessions
  set next_number = next_number + 1,
      updated_at = now()
  where id = v_session_id
  returning next_number - 1 into v_next;

  return v_prefix || lpad(v_next::text, 3, '0');
end;
$$;
