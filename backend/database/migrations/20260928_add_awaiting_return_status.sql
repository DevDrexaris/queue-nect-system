-- Production schema fix: queue transition and reset functions use this status.
-- Safe to run once in the Supabase SQL Editor; existing values are unchanged.
alter type public.queue_status
  add value if not exists 'AWAITING_RETURN' after 'SERVING';
