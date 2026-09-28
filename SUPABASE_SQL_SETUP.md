# Queue-Nect Supabase SQL Setup

This document describes the current Supabase/Postgres setup used by Queue-Nect and the exact SQL that is already part of the project architecture.

## 1. Existing database setup already in use

The project is already configured around the following live schema and migration files:

- backend/database/schema.sql
- backend/database/migrations/20261004_multi_location_queues.sql
- backend/database/migrations/20261008_staff_account_provisioning.sql

The current trusted architecture is:

- Supabase Auth creates the auth user.
- The secure trigger `public.handle_new_user()` creates a default STAFF profile row for that auth user.
- The secure `provision-account` Edge Function is the authoritative server-side implementation for role, organization, location, and queue assignment.
- The trigger does not trust `raw_user_meta_data` for privileged values.
- The trigger uses a default assignment pattern and keeps the profile row from being overwritten via untrusted metadata.

## 2. Existing STAFF provisioning trigger

The current trigger is intentionally conservative and should remain in place:

```sql
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
```

This trigger is intentionally not the authority for privileged role/organization assignment. It only bootstraps a default user profile and keeps the row consistent.

## 3. No new migration required

No new database migration is required for the currently implemented secure provisioning flow.

This is because:

- the safer trigger is already in the project design and is preserved
- the secure Edge Function remains the authoritative server-side assignment layer
- the frontend does not bypass RLS or trust metadata
- no production database change is being executed here

## 4. Required manual Supabase Dashboard configuration

The following still must be configured manually in the Supabase Dashboard before staging invitation email workflows can be validated:

- Project secrets for the Edge Function:
  - SUPABASE_URL
  - SUPABASE_ANON_KEY
  - SUPABASE_SERVICE_ROLE_KEY
- Authentication → Site URL
- Authentication → Redirect URLs
- Authentication → Email provider / SMTP / Resend configuration
- Invitation redirect target for the staging frontend

Example redirect values should point to the actual deployed staging URL and callback route used by the app, such as:

- https://<your-staging-frontend-domain>/auth/callback
- https://<your-staging-frontend-domain>/auth/setup-password

Do not expose or commit secret values in source control.

## 5. Verification steps (manual)

Before staging invitation testing, verify the following in Supabase:

1. The project has a working email provider enabled.
2. The correct site URL and redirect URLs are configured.
3. The Edge Function secrets are present and valid.
4. The function `provision-account` is deployed to the same Supabase project.
5. The project is using the correct auth redirect and callback route.
6. A new invitation email gets sent successfully.
7. The invite link lands on the app and the callback is accepted.
8. The user can complete password setup and sign in.

## 6. Rollback considerations

Because no migration is being added, rollback is limited to:

- removing or changing the function secrets in Supabase
- changing redirect configuration in Supabase Auth
- disabling the email provider
- removing or adjusting the `provision-account` Edge Function deployment

No schema or policy rollback is required for the current implementation.

## 7. Important note

The invitation flow is code-complete only up to the server-side invitation creation and the frontend callback routes. Email delivery and end-to-end staging acceptance still require live Supabase Dashboard configuration and actual staging verification.
