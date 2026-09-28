-- Staff-assisted walk-in entries use the same active queue session and
-- queue_sessions.next_number counter as QR registration.
begin;

-- The QR join RPC already advances next_number atomically. Remove the legacy
-- insert trigger that would increment the shared counter a second time.
drop trigger if exists queue_entries_after_insert_bump_next_number
on public.queue_entries;

alter table public.queue_entries
  add column if not exists registration_source text not null default 'QR';

update public.queue_entries
set registration_source = 'QR'
where registration_source is null;

alter table public.queue_entries
  alter column registration_source set default 'QR',
  alter column registration_source set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.queue_entries'::regclass
      and conname = 'queue_entries_registration_source_check'
  ) then
    alter table public.queue_entries
      add constraint queue_entries_registration_source_check
      check (registration_source in ('QR', 'WALK_IN'));
  end if;
end
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
  v_session public.queue_sessions%rowtype;
  v_entry public.queue_entries%rowtype;
  v_next_number integer;
  v_student_id text;
begin
  if auth.uid() is null
     or not (public.is_super_admin() or public.is_org_staff(p_organization_id)) then
    raise exception 'Not authorized to register a walk-in for this organization';
  end if;

  if nullif(trim(p_full_name), '') is null then
    raise exception 'Patient name is required';
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

  if v_session.admission_status <> 'OPEN' then
    raise exception 'Queue is not open for new registrations';
  end if;

  update public.queue_sessions
  set next_number = next_number + 1,
      updated_at = now()
  where id = v_session.id
  returning next_number - 1 into v_next_number;

  v_student_id := coalesce(
    nullif(trim(p_reference_id), ''),
    'WALKIN-' || gen_random_uuid()::text
  );

  insert into public.queue_entries (
    organization_id,
    queue_session_id,
    queue_number,
    student_id,
    full_name,
    course,
    year_level,
    purpose,
    status,
    registration_source
  )
  values (
    p_organization_id,
    v_session.id,
    v_session.queue_prefix || lpad(v_next_number::text, 3, '0'),
    v_student_id,
    trim(p_full_name),
    'Not provided',
    'Not provided',
    'Walk-in registration',
    'WAITING',
    'WALK_IN'
  )
  returning * into v_entry;

  return jsonb_build_object('entry', to_jsonb(v_entry));
end;
$$;

revoke all on function public.register_walk_in_patient(uuid, text, text) from public;
grant execute on function public.register_walk_in_patient(uuid, text, text) to authenticated;

commit;
