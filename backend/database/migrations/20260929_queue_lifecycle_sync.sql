-- Queue-Nect production schema sync for the current frontend.
-- Run manually in the Supabase SQL Editor after the existing migrations.
-- This file is not executed by the application.

alter type public.queue_status
  add value if not exists 'AWAITING_RETURN' after 'SERVING';

begin;

-- The join RPC owns atomic number allocation. The legacy insert trigger must not
-- increment the same session counter a second time.
drop trigger if exists queue_entries_after_insert_bump_next_number
on public.queue_entries;

-- Keep deleted terminal records available to reporting without retaining them
-- in the live queue table.
alter table public.queue_history
  add column if not exists queue_reference text;

alter table public.queue_history
  alter column queue_entry_id drop not null;

do $$
declare
  foreign_key_name text;
begin
  select conname
  into foreign_key_name
  from pg_constraint
  where conrelid = 'public.queue_history'::regclass
    and confrelid = 'public.queue_entries'::regclass
    and contype = 'f'
  limit 1;

  if foreign_key_name is not null then
    execute format('alter table public.queue_history drop constraint %I', foreign_key_name);
  end if;
end
$$;

alter table public.queue_history
  add constraint queue_history_queue_entry_id_fkey
  foreign key (queue_entry_id)
  references public.queue_entries(id)
  on delete set null;

create index if not exists queue_history_reference_idx
  on public.queue_history (queue_reference);

-- The live public snapshot contains no student PII.
drop view if exists public.public_queue_snapshot;

create view public.public_queue_snapshot as
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

revoke all on public.public_queue_snapshot from public, anon, authenticated;
grant select on public.public_queue_snapshot to anon, authenticated;

create or replace function public.reset_queue_session(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.queue_sessions%rowtype;
begin
  if not (public.is_super_admin() or public.is_org_staff(p_organization_id)) then
    raise exception 'Not authorized to reset this queue';
  end if;

  select *
  into v_session
  from public.queue_sessions
  where organization_id = p_organization_id
    and session_date = current_date
    and is_active = true
  for update;

  if not found then
    raise exception 'There is no active queue session for today to reset';
  end if;

  if exists (
    select 1
    from public.queue_entries
    where queue_session_id = v_session.id
      and status in ('WAITING', 'CALLED', 'SERVING', 'AWAITING_RETURN')
  ) then
    raise exception 'Queue cannot be reset while active customers are still in the queue';
  end if;

  update public.queue_sessions
  set next_number = 1,
      updated_at = now()
  where id = v_session.id;

  return 1;
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
  select *
  into v_entry
  from public.queue_entries
  where id = p_queue_entry_id
  for update;

  if not found then
    raise exception 'Queue entry not found';
  end if;

  if not (public.is_super_admin() or public.is_org_staff(v_entry.organization_id)) then
    raise exception 'Not authorized to delete this queue entry';
  end if;

  if v_entry.status not in ('COMPLETED', 'CANCELLED', 'NO_SHOW') then
    raise exception 'Only completed, cancelled, or no-show entries can be deleted';
  end if;

  if not exists (
    select 1
    from public.queue_history
    where queue_reference = v_entry.queue_reference
  ) then
    insert into public.queue_history (
      organization_id,
      queue_session_id,
      queue_entry_id,
      queue_reference,
      queue_number,
      student_id,
      full_name,
      course,
      year_level,
      purpose,
      status,
      joined_at,
      called_at,
      started_at,
      completed_at,
      cancelled_at,
      no_show_at
    )
    values (
      v_entry.organization_id,
      v_entry.queue_session_id,
      v_entry.id,
      v_entry.queue_reference,
      v_entry.queue_number,
      v_entry.student_id,
      v_entry.full_name,
      v_entry.course,
      v_entry.year_level,
      v_entry.purpose,
      v_entry.status,
      v_entry.joined_at,
      v_entry.called_at,
      v_entry.started_at,
      v_entry.completed_at,
      v_entry.cancelled_at,
      v_entry.no_show_at
    );
  end if;

  delete from public.queue_entries
  where id = p_queue_entry_id;

  return to_jsonb(v_entry);
end;
$$;

create or replace function public.get_organization_analytics(
  p_organization_id uuid,
  p_from date,
  p_to date
)
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
    raise exception 'Not authorized to view organization analytics';
  end if;

  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Analytics date range is invalid';
  end if;

  with selected as (
    select
      q.organization_id,
      q.queue_reference,
      q.status,
      q.purpose,
      q.joined_at,
      q.called_at,
      q.started_at,
      q.completed_at
    from public.queue_entries q
    where q.organization_id = p_organization_id
      and q.joined_at >= p_from::timestamptz
      and q.joined_at < (p_to + 1)::timestamptz

    union all

    select
      h.organization_id,
      h.queue_reference,
      h.status,
      h.purpose,
      h.joined_at,
      h.called_at,
      h.started_at,
      h.completed_at
    from public.queue_history h
    where h.organization_id = p_organization_id
      and h.joined_at >= p_from::timestamptz
      and h.joined_at < (p_to + 1)::timestamptz
      and not exists (
        select 1
        from public.queue_entries q
        where q.id = h.queue_entry_id
           or (h.queue_reference is not null and q.queue_reference = h.queue_reference)
      )
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
  )
  into v_result
  from totals;

  return v_result;
end;
$$;

revoke all on function public.reset_queue_session(uuid) from public;
revoke all on function public.delete_queue_entry(uuid) from public;
revoke all on function public.get_organization_analytics(uuid, date, date) from public;

grant execute on function public.reset_queue_session(uuid) to authenticated;
grant execute on function public.delete_queue_entry(uuid) to authenticated;
grant execute on function public.get_organization_analytics(uuid, date, date) to authenticated;

-- Ensure queue-entry changes can drive the existing admin realtime channel.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'queue_entries'
     ) then
    execute 'alter publication supabase_realtime add table public.queue_entries';
  end if;
end
$$;

commit;
