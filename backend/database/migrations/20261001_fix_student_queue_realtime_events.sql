-- Ensure every queue status transition reaches the existing student private channel.
-- In particular, AWAITING_RETURN previously had no activity action and caused
-- the trigger to return before broadcasting anything.
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
  v_event jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'QUEUE_JOINED';
  elsif new.status = 'WAITING' and old.status = 'CALLED' then
    v_action := 'QUEUE_RETURNED_TO_WAITING';
  elsif new.status is distinct from old.status then
    v_action := case new.status
      when 'CALLED' then 'QUEUE_CALLED'
      when 'SERVING' then 'QUEUE_SERVING'
      when 'AWAITING_RETURN' then 'QUEUE_AWAITING_RETURN'
      when 'COMPLETED' then 'QUEUE_COMPLETED'
      when 'CANCELLED' then case new.cancellation_source
        when 'STUDENT' then 'QUEUE_CANCELLED_BY_STUDENT'
        else 'QUEUE_CANCELLED_BY_ADMIN'
      end
      when 'NO_SHOW' then 'QUEUE_NO_SHOW'
      else null
    end;
  end if;

  v_source := case when new.status = 'CANCELLED' then new.cancellation_source else null end;

  if v_action is not null then
    insert into public.activity_log (organization_id, performed_by, action, details)
    values (
      new.organization_id,
      case when v_source = 'STUDENT' then null else auth.uid() end,
      v_action,
      jsonb_build_object(
        'queue_entry_id', new.id,
        'queue_number', new.queue_number,
        'previous_status', case when tg_op = 'UPDATE' then old.status else null end,
        'status', new.status,
        'updated_at', new.updated_at,
        'source', v_source
      )
    );
  end if;

  v_event := jsonb_build_object(
    'queue_entry_id', new.id,
    'queue_number', new.queue_number,
    'previous_status', case when tg_op = 'UPDATE' then old.status else null end,
    'status', new.status,
    'updated_at', new.updated_at,
    'called_at', new.called_at,
    'cancellation_source', v_source
  );

  select public_identifier
  into v_identifier
  from public.organizations
  where id = new.organization_id;

  if v_identifier is not null then
    perform realtime.send(
      jsonb_build_object(
        'queue_number', new.queue_number,
        'previous_status', case when tg_op = 'UPDATE' then old.status else null end,
        'status', new.status,
        'updated_at', new.updated_at
      ),
      'queue_changed',
      'public-queue:' || v_identifier,
      false
    );
  end if;

  select token_hash
  into v_token_hash
  from public.queue_status_tokens
  where queue_entry_id = new.id;

  if v_token_hash is not null then
    perform realtime.send(
      v_event,
      'queue_status_changed',
      'student-queue:' || v_token_hash,
      true
    );
  end if;

  if new.status in ('COMPLETED', 'CANCELLED', 'NO_SHOW') then
    update public.queue_status_tokens
    set revoked_at = coalesce(revoked_at, now())
    where queue_entry_id = new.id;

    update public.queue_presence
    set presence = 'OFFLINE', updated_at = now()
    where queue_entry_id = new.id;

    delete from public.student_push_subscriptions
    where queue_entry_id = new.id;
  end if;

  return new;
end;
$$;
