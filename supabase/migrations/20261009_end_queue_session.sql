-- Add an explicit end-session RPC so staff can close the active queue session for today
-- without silently relying on date rollover.

begin;

create or replace function public.end_organization_queue_session(p_queue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue public.organization_queues%rowtype;
  v_session public.queue_sessions%rowtype;
begin
  select * into v_queue
  from public.organization_queues
  where id = p_queue_id
  for update;

  if not found or not v_queue.is_active then
    raise exception 'Queue not found or no longer active';
  end if;

  if not public.can_manage_organization_queue(v_queue.organization_id, v_queue.id) then
    raise exception 'Queue not found or not authorized';
  end if;

  select * into v_session
  from public.queue_sessions
  where organization_id = v_queue.organization_id
    and queue_id = v_queue.id
    and session_date = current_date
    and is_active = true
  for update;

  if not found then
    return jsonb_build_object(
      'sessionId', null,
      'sessionDate', current_date,
      'sessionStatus', 'NOT_STARTED',
      'availability', v_queue.admission_status,
      'ended', false
    );
  end if;

  update public.queue_sessions
  set is_active = false,
      admission_status = v_queue.admission_status,
      updated_at = now()
  where id = v_session.id
  returning * into v_session;

  insert into public.activity_log (organization_id, queue_id, performed_by, action, details)
  values (
    v_queue.organization_id,
    v_queue.id,
    auth.uid(),
    'QUEUE_SESSION_ENDED',
    jsonb_build_object(
      'queue_id', v_queue.id,
      'session_id', v_session.id,
      'session_date', v_session.session_date,
      'ended_at', now()
    )
  );

  return jsonb_build_object(
    'sessionId', v_session.id,
    'sessionDate', v_session.session_date,
    'sessionStatus', 'ENDED',
    'availability', v_session.admission_status,
    'ended', true
  );
end;
$$;

revoke all on function public.end_organization_queue_session(uuid) from public;
grant execute on function public.end_organization_queue_session(uuid) to authenticated;

commit;
