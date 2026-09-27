-- Restore the complete queue lifecycle after the analytics migration replaced
-- transition_queue_entry without the awaiting_return/call_again branches.
create or replace function public.transition_queue_entry(
  p_queue_entry_id uuid,
  p_action text
)
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

  if not found
     or not (public.is_super_admin() or public.is_org_staff(v_entry.organization_id)) then
    raise exception 'Queue entry not found';
  end if;

  perform 1
  from public.queue_sessions
  where id = v_entry.queue_session_id
  for update;

  if p_action = 'call' and v_entry.status = 'WAITING' then
    if exists (
      select 1
      from public.queue_entries q
      where q.queue_session_id = v_entry.queue_session_id
        and q.status in ('CALLED', 'SERVING')
        and q.id <> v_entry.id
    ) then
      raise exception 'Finish the active call before calling another number';
    end if;

    update public.queue_entries
    set status = 'CALLED'
    where id = v_entry.id
    returning * into v_entry;

  elsif p_action = 'return_to_waiting' and v_entry.status = 'CALLED' then
    update public.queue_entries
    set status = 'WAITING', called_at = null
    where id = v_entry.id
    returning * into v_entry;

  elsif p_action = 'serve' and v_entry.status = 'CALLED' then
    if exists (
      select 1
      from public.queue_entries q
      where q.queue_session_id = v_entry.queue_session_id
        and q.status = 'SERVING'
        and q.id <> v_entry.id
    ) then
      raise exception 'Another number is already being served';
    end if;

    update public.queue_entries
    set status = 'SERVING'
    where id = v_entry.id
    returning * into v_entry;

  elsif p_action = 'awaiting_return'
        and v_entry.status in ('SERVING', 'CALLED') then
    update public.queue_entries
    set status = 'AWAITING_RETURN'
    where id = v_entry.id
    returning * into v_entry;

  elsif p_action = 'call_again'
        and v_entry.status = 'AWAITING_RETURN' then
    if exists (
      select 1
      from public.queue_entries q
      where q.queue_session_id = v_entry.queue_session_id
        and q.status in ('CALLED', 'SERVING')
        and q.id <> v_entry.id
    ) then
      raise exception 'Finish the active call before calling another number';
    end if;

    update public.queue_entries
    set status = 'CALLED'
    where id = v_entry.id
    returning * into v_entry;

  elsif p_action = 'complete' and v_entry.status = 'SERVING' then
    update public.queue_entries
    set status = 'COMPLETED'
    where id = v_entry.id
    returning * into v_entry;

  elsif p_action = 'skip'
        and v_entry.status in ('WAITING', 'CALLED', 'AWAITING_RETURN') then
    update public.queue_entries
    set status = 'NO_SHOW'
    where id = v_entry.id
    returning * into v_entry;

  elsif p_action = 'cancel'
        and v_entry.status in ('WAITING', 'CALLED', 'SERVING', 'AWAITING_RETURN') then
    update public.queue_entries
    set status = 'CANCELLED', cancellation_source = 'ADMIN'
    where id = v_entry.id
    returning * into v_entry;

  else
    raise exception 'Action is not allowed for the current queue state';
  end if;

  return to_jsonb(v_entry);
end;
$$;

revoke all on function public.transition_queue_entry(uuid, text) from public;
grant execute on function public.transition_queue_entry(uuid, text) to authenticated;
