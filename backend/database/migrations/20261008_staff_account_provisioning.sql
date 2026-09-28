-- Secure STAFF account provisioning and profile creation for Supabase Auth users.
-- Review and apply manually in Supabase SQL Editor; this repo intentionally does not execute production SQL automatically.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_location_id uuid;
  v_queue_id uuid;
  v_role public.user_role;
begin
  v_org_id := nullif(new.raw_user_meta_data ->> 'organization_id', '')::uuid;
  v_location_id := nullif(new.raw_user_meta_data ->> 'location_id', '')::uuid;
  v_queue_id := nullif(new.raw_user_meta_data ->> 'queue_id', '')::uuid;

  begin
    v_role := (new.raw_user_meta_data ->> 'role')::public.user_role;
  exception when invalid_text_representation then
    v_role := 'STAFF';
  end;

  if v_role not in ('ADMIN', 'ORG_ADMIN', 'STAFF') then
    v_role := 'STAFF';
  end if;

  insert into public.profiles (
    id,
    organization_id,
    full_name,
    email,
    role,
    is_active,
    location_id,
    queue_id
  ) values (
    new.id,
    v_org_id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    v_role,
    true,
    v_location_id,
    v_queue_id
  )
  on conflict (id) do update
  set organization_id = excluded.organization_id,
      full_name = excluded.full_name,
      email = excluded.email,
      role = excluded.role,
      is_active = true,
      location_id = excluded.location_id,
      queue_id = excluded.queue_id,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create policy "Org admins can insert profiles in their organization"
on public.profiles
for insert
with check (
  public.is_super_admin()
  or (
    organization_id is not null
    and public.is_org_admin(organization_id)
  )
);
