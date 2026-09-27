begin;

alter table public.organizations
  add column if not exists announcements_enabled boolean not null default true,
  add column if not exists announcement_use_custom boolean not null default false,
  add column if not exists announcement_template text not null default 'Queue {queue_number}, please proceed to {service_area}.',
  add column if not exists announcement_service_area text not null default 'the service desk',
  add column if not exists announcement_voice text not null default '',
  add column if not exists announcement_rate numeric(3, 2) not null default 0.95 check (announcement_rate between 0.5 and 1.5),
  add column if not exists announcement_volume numeric(3, 2) not null default 1 check (announcement_volume between 0 and 1);

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
where q.status in ('WAITING', 'CALLED', 'SERVING')
  and o.is_active = true;

revoke all on public.public_queue_snapshot from public, anon, authenticated;
grant select on public.public_queue_snapshot to anon, authenticated;

create table if not exists public.student_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  queue_entry_id uuid not null references public.queue_entries(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.student_push_subscriptions enable row level security;
revoke all on public.student_push_subscriptions from public, anon, authenticated;

create or replace function public.save_student_push_subscription(
  p_status_token text,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_queue_entry_id uuid;
begin
  select q.id into v_queue_entry_id
  from public.queue_status_tokens t
  join public.queue_entries q on q.id = t.queue_entry_id
  where t.token_hash = encode(digest(convert_to(p_status_token, 'UTF8'), 'sha256'), 'hex')
    and t.revoked_at is null
    and q.status in ('WAITING', 'CALLED', 'SERVING');

  if not found then raise exception 'Queue access is no longer active'; end if;
  if p_endpoint = '' or p_p256dh = '' or p_auth = '' then raise exception 'Push subscription is incomplete'; end if;

  insert into public.student_push_subscriptions (queue_entry_id, endpoint, p256dh, auth)
  values (v_queue_entry_id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set queue_entry_id = excluded.queue_entry_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        updated_at = now();

  return true;
end;
$$;

revoke all on function public.save_student_push_subscription(text, text, text, text) from public;
grant execute on function public.save_student_push_subscription(text, text, text, text) to anon, authenticated;

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

  if v_action is null then return new; end if;
  v_source := case when new.status = 'CANCELLED' then new.cancellation_source else null end;

  insert into public.activity_log (organization_id, performed_by, action, details)
  values (
    new.organization_id,
    case when v_source = 'STUDENT' then null else auth.uid() end,
    v_action,
    jsonb_build_object('queue_entry_id', new.id, 'queue_number', new.queue_number, 'status', new.status, 'source', v_source)
  );

  select public_identifier into v_identifier from public.organizations where id = new.organization_id;
  if v_identifier is not null then
    perform realtime.send(jsonb_build_object('queue_number', new.queue_number, 'status', new.status), 'queue_changed', 'public-queue:' || v_identifier, false);
  end if;

  select token_hash into v_token_hash from public.queue_status_tokens where queue_entry_id = new.id;
  if v_token_hash is not null then
    perform realtime.send(
      jsonb_build_object('queue_number', new.queue_number, 'status', new.status, 'cancellation_source', v_source),
      'queue_status_changed', 'student-queue:' || v_token_hash, true
    );
  end if;

  if new.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW') then
    update public.queue_status_tokens set revoked_at = coalesce(revoked_at, now()) where queue_entry_id = new.id;
    update public.queue_presence set presence = 'OFFLINE', updated_at = now() where queue_entry_id = new.id;
    delete from public.student_push_subscriptions where queue_entry_id = new.id;
  end if;

  return new;
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
  if not found or not (public.is_super_admin() or public.is_org_staff(v_entry.organization_id)) then
    raise exception 'Queue entry not found';
  end if;
  perform 1 from public.queue_sessions where id = v_entry.queue_session_id for update;

  if p_action = 'call' and v_entry.status = 'WAITING' then
    if exists (select 1 from public.queue_entries q where q.queue_session_id = v_entry.queue_session_id and q.status in ('CALLED', 'SERVING') and q.id <> v_entry.id) then
      raise exception 'Finish the active call before calling another number';
    end if;
    update public.queue_entries set status = 'CALLED' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'return_to_waiting' and v_entry.status = 'CALLED' then
    update public.queue_entries set status = 'WAITING', called_at = null where id = v_entry.id returning * into v_entry;
  elsif p_action = 'serve' and v_entry.status = 'CALLED' then
    if exists (select 1 from public.queue_entries q where q.queue_session_id = v_entry.queue_session_id and q.status = 'SERVING' and q.id <> v_entry.id) then
      raise exception 'Another number is already being served';
    end if;
    update public.queue_entries set status = 'SERVING' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'complete' and v_entry.status = 'SERVING' then
    update public.queue_entries set status = 'COMPLETED' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'skip' and v_entry.status in ('WAITING', 'CALLED') then
    update public.queue_entries set status = 'NO_SHOW' where id = v_entry.id returning * into v_entry;
  elsif p_action = 'cancel' and v_entry.status in ('WAITING', 'CALLED', 'SERVING') then
    update public.queue_entries set status = 'CANCELLED', cancellation_source = 'ADMIN' where id = v_entry.id returning * into v_entry;
  else
    raise exception 'Action is not allowed for the current queue state';
  end if;

  return to_jsonb(v_entry);
end;
$$;

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
  if new.status = old.status then return new; end if;
  if old.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW') then
    raise exception 'Terminal queue states cannot be reopened';
  end if;
  if not (
    (old.status = 'WAITING' and new.status in ('CALLED', 'AWAITING_RETURN', 'CANCELLED', 'NO_SHOW'))
    or (old.status = 'CALLED' and new.status in ('SERVING', 'AWAITING_RETURN', 'WAITING', 'CANCELLED', 'NO_SHOW'))
    or (old.status = 'AWAITING_RETURN' and new.status in ('CALLED', 'WAITING', 'CANCELLED', 'NO_SHOW'))
    or (old.status = 'SERVING' and new.status in ('AWAITING_RETURN', 'COMPLETED', 'CANCELLED'))
  ) then
    raise exception 'Invalid queue transition: % -> %', old.status, new.status;
  end if;

  if new.status = 'CALLED' then new.called_at := now();
  elsif new.status = 'WAITING' and old.status = 'CALLED' then new.called_at := null;
  elsif new.status = 'SERVING' then new.started_at := now();
  elsif new.status = 'COMPLETED' then new.completed_at := now();
  elsif new.status = 'NO_SHOW' then new.no_show_at := now();
  elsif new.status = 'CANCELLED' then
    if new.cancellation_source is null or new.cancellation_source not in ('STUDENT', 'ADMIN') then
      raise exception 'Cancellation source is required';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := case when new.cancellation_source = 'ADMIN' then auth.uid() else null end;
  end if;
  new.updated_at := now();
  return new;
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
    select q.* from public.queue_entries q
    where q.organization_id = p_organization_id
      and q.joined_at >= p_from::timestamptz
      and q.joined_at < (p_to + 1)::timestamptz
  ),
  totals as (
    select
      count(*)::integer as total,
      count(*) filter (where status in ('COMPLETED', 'SERVED'))::integer as completed,
      count(*) filter (where status = 'CANCELLED')::integer as cancelled,
      count(*) filter (where status = 'NO_SHOW')::integer as no_show,
      count(*) filter (where status = 'WAITING')::integer as waiting,
      count(*) filter (where status = 'SERVING')::integer as serving,
      round(avg(extract(epoch from (coalesce(called_at, started_at) - joined_at)) / 60.0)
        filter (where coalesce(called_at, started_at) is not null)::numeric, 1) as average_wait,
      round(avg(extract(epoch from (completed_at - started_at)) / 60.0)
        filter (where status in ('COMPLETED', 'SERVED') and completed_at is not null and started_at is not null)::numeric, 1) as average_service
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
    'averageWaitMinutes', totals.average_wait,
    'averageServiceMinutes', totals.average_service,
    'hourly', coalesce((select jsonb_agg(jsonb_build_object('hour', hour, 'value', total) order by hour) from hourly), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('date', day, 'value', total) order by day) from daily), '[]'::jsonb),
    'purposes', coalesce((select jsonb_agg(jsonb_build_object('label', purpose, 'count', total, 'percent', round(total * 100.0 / nullif(totals.total, 0), 1)) order by total desc) from purposes), '[]'::jsonb)
  ) into v_result from totals;

  return v_result;
end;
$$;

revoke all on function public.get_organization_analytics(uuid, date, date) from public;
grant execute on function public.get_organization_analytics(uuid, date, date) to authenticated;

commit;