-- Queue-Nect post-migration audit. READ-ONLY: no rows, schema, or settings are changed.
-- Run this after the migrations in backend/README.md. Keep the transaction read-only.
-- If the required-object test fails, stop before running data-dependent sections.
begin read only;

-- TEST 1: Required tables and columns.
-- PASS means every listed relation/column exists. FAIL lists missing columns/relations.
with required(table_name, column_name) as (
  values
    ('organizations', 'id'), ('organizations', 'public_identifier'), ('organizations', 'is_active'), ('organizations', 'queue_prefix'),
    ('profiles', 'id'), ('profiles', 'organization_id'), ('profiles', 'role'), ('profiles', 'is_active'), ('profiles', 'location_id'), ('profiles', 'queue_id'),
    ('organization_locations', 'id'), ('organization_locations', 'organization_id'), ('organization_locations', 'name'), ('organization_locations', 'is_active'), ('organization_locations', 'is_default'),
    ('organization_queues', 'id'), ('organization_queues', 'organization_id'), ('organization_queues', 'location_id'), ('organization_queues', 'public_identifier'), ('organization_queues', 'queue_prefix'), ('organization_queues', 'admission_status'), ('organization_queues', 'is_active'), ('organization_queues', 'is_default'),
    ('organization_qr_tokens', 'organization_id'), ('organization_qr_tokens', 'queue_id'), ('organization_qr_tokens', 'token'), ('organization_qr_tokens', 'is_active'), ('organization_qr_tokens', 'expires_at'),
    ('queue_sessions', 'id'), ('queue_sessions', 'organization_id'), ('queue_sessions', 'queue_id'), ('queue_sessions', 'session_date'), ('queue_sessions', 'queue_prefix'), ('queue_sessions', 'next_number'), ('queue_sessions', 'is_active'), ('queue_sessions', 'admission_status'),
    ('queue_entries', 'id'), ('queue_entries', 'organization_id'), ('queue_entries', 'queue_session_id'), ('queue_entries', 'queue_id'), ('queue_entries', 'queue_number'), ('queue_entries', 'status'), ('queue_entries', 'registration_source'),
    ('queue_history', 'organization_id'), ('queue_history', 'queue_session_id'), ('queue_history', 'queue_id'),
    ('public_queue_snapshot', 'queue_session_id'),
    ('activity_log', 'id'), ('activity_log', 'organization_id'), ('activity_log', 'queue_id'), ('activity_log', 'action'), ('activity_log', 'details'), ('activity_log', 'created_at'),
    ('queue_presence', 'queue_entry_id'), ('queue_presence', 'organization_id'), ('queue_presence', 'queue_id'), ('queue_presence', 'queue_number'), ('queue_presence', 'presence'), ('queue_presence', 'last_seen_at'),
    ('queue_status_tokens', 'queue_entry_id'), ('queue_status_tokens', 'token_hash'), ('queue_status_tokens', 'revoked_at')
), missing as (
  select r.table_name, r.column_name
  from required r
  left join information_schema.columns c
    on c.table_schema = 'public'
    and c.table_name = r.table_name
    and c.column_name = r.column_name
  where c.column_name is null
)
select 'required tables and columns' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
       coalesce(string_agg(table_name || '.' || column_name, ', '), 'none') as missing_objects
from missing;

select 'nullable legacy/history queue associations' as test,
       case
         when (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'activity_log' and column_name = 'queue_id') = 'YES'
          and (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'queue_presence' and column_name = 'queue_id') = 'YES'
           then 'PASS'
         else 'FAIL'
       end as status,
       'activity_log.queue_id and queue_presence.queue_id are expected nullable' as details;

-- TEST 1b: Expected queue/location foreign keys exist and are validated.
-- FAIL means a relationship is missing or left NOT VALID.
with required(table_name, constraint_name) as (
  values
    ('organization_queues', 'organization_queues_organization_id_location_id_fkey'),
    ('queue_sessions', 'queue_sessions_queue_id_fkey'),
    ('profiles', 'profiles_location_id_fkey'),
    ('profiles', 'profiles_queue_id_fkey'),
    ('queue_entries', 'queue_entries_queue_id_fkey'),
    ('queue_history', 'queue_history_queue_id_fkey'),
    ('organization_qr_tokens', 'organization_qr_tokens_queue_id_fkey'),
    ('activity_log', 'activity_log_queue_id_fkey'),
    ('queue_presence', 'queue_presence_queue_id_fkey')
), missing as (
  select r.table_name, r.constraint_name
  from required r
  where not exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.' || r.table_name)
      and c.conname = r.constraint_name
      and c.convalidated
  )
)
select 'validated queue foreign keys' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
       coalesce(string_agg(table_name || '.' || constraint_name, ', '), 'none') as missing_or_unvalidated
from missing;

-- TEST 2: Queue, security, and realtime indexes.
-- FAIL means the named index is absent; inspect its definition as well as its name.
with required(index_name) as (
  values
    ('organization_locations_one_default_idx'),
    ('organization_queues_one_default_idx'),
    ('organization_queues_location_active_idx'),
    ('organization_qr_tokens_org_idx'),
    ('queue_sessions_legacy_org_date_uidx'),
    ('queue_sessions_queue_date_uidx'),
    ('queue_entries_queue_status_joined_idx'),
    ('queue_presence_org_last_seen_idx'),
    ('activity_log_org_queue_created_idx'),
    ('queue_presence_org_queue_seen_idx')
), missing as (
  select r.index_name from required r
  where to_regclass('public.' || r.index_name) is null
)
select 'required indexes' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
       coalesce(string_agg(index_name, ', '), 'none') as missing_indexes
from missing;

-- TEST 3: Required RPC/helper signatures.
-- FAIL means the deployed signature differs from the frontend/migration contract.
with required(signature) as (
  values
    ('public.can_manage_organization_queue(uuid,uuid)'),
    ('public.get_default_queue_id(text)'),
    ('public.get_queue_availability(text)'),
    ('public.get_organization_queue_availability(text,uuid)'),
    ('public.get_public_queue_details(text,uuid)'),
    ('public.get_public_queue_qr_token(text,uuid)'),
    ('public.resolve_queue_qr_token(text)'),
    ('public.join_queue_with_status_token(text,text,text,text,text,text,text)'),
    ('public.register_walk_in_for_queue(uuid,text,text)'),
    ('public.register_walk_in_patient(uuid,text,text)'),
    ('public.reset_organization_queue_session(uuid)'),
    ('public.get_organization_location_queue_stats(uuid)'),
    ('public.get_organization_queue_session_states(uuid)'),
    ('public.start_organization_queue_session(uuid)'),
    ('public.get_organization_analytics(uuid,date,date,uuid)'),
    ('public.update_student_queue_presence(text,text)'),
    ('public.transition_queue_entry(uuid,text)'),
    ('public.create_organization_queue(uuid,uuid,text,text,text,text,text,time,time,text,smallint[])'),
    ('public.create_public_qr_token_for_queue()')
), missing as (
  select signature from required where to_regprocedure(signature) is null
)
select 'required function signatures' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
       coalesce(string_agg(signature, ', '), 'none') as missing_signatures
from missing;

-- TEST 4: Old unsafe public signatures must be absent; legacy organization wrappers remain.
-- FAIL means an unscoped signature remains or a backward-compatible default-queue RPC is missing.
select 'RPC signature compatibility' as test,
       case
         when to_regprocedure('public.get_public_queue_details(uuid)') is not null then 'FAIL'
         when to_regprocedure('public.get_organization_queue_availability(uuid)') is not null then 'FAIL'
         when to_regprocedure('public.get_organization_analytics(uuid,date,date)') is not null then 'FAIL'
         when to_regprocedure('public.set_queue_availability(uuid,text)') is null then 'FAIL'
         when to_regprocedure('public.reset_queue_session(uuid)') is null then 'FAIL'
         when to_regprocedure('public.register_walk_in_patient(uuid,text,text)') is null then 'FAIL'
         else 'PASS'
       end as status,
       'organization-level compatibility wrappers present; UUID-only public lookups absent' as details;

select 'queue session lifecycle RPC privileges' as test,
       case
         when to_regprocedure('public.start_organization_queue_session(uuid)') is null then 'FAIL'
         when to_regprocedure('public.get_organization_queue_session_states(uuid)') is null then 'FAIL'
         when not has_function_privilege('authenticated', to_regprocedure('public.start_organization_queue_session(uuid)'), 'EXECUTE') then 'FAIL'
         when has_function_privilege('anon', to_regprocedure('public.start_organization_queue_session(uuid)'), 'EXECUTE') then 'FAIL'
         when not has_function_privilege('authenticated', to_regprocedure('public.get_organization_queue_session_states(uuid)'), 'EXECUTE') then 'FAIL'
         when has_function_privilege('anon', to_regprocedure('public.get_organization_queue_session_states(uuid)'), 'EXECUTE') then 'FAIL'
         else 'PASS'
       end as status,
       'start/state management is authenticated; public state is only in organization-bound queue details' as details;

-- TEST 5: Required triggers.
-- FAIL means an expected lifecycle, queue-scope, QR-provisioning, or timestamp trigger is absent.
with required(table_name, trigger_name) as (
  values
    ('organizations', 'organizations_create_default_queue'),
    ('profiles', 'profiles_enforce_queue_assignment'),
    ('queue_entries', 'queue_entries_enforce_session_scope'),
    ('queue_entries', 'queue_entries_activity_broadcast'),
    ('organization_queues', 'organization_queues_create_public_qr_token'),
    ('activity_log', 'activity_log_assign_queue_scope'),
    ('queue_presence', 'queue_presence_enforce_queue_scope'),
    ('organization_qr_tokens', 'organization_qr_tokens_set_updated_at')
), missing as (
  select r.table_name, r.trigger_name
  from required r
  where not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = r.table_name
      and t.tgname = r.trigger_name
      and not t.tgisinternal
  )
)
select 'required triggers' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
       coalesce(string_agg(table_name || '.' || trigger_name, ', '), 'none') as missing_triggers
from missing;

-- TEST 6: RLS is enabled on protected tables.
-- FAIL means a table is missing or row-level security is disabled.
with required(table_name) as (
  values
    ('organizations'), ('profiles'), ('organization_locations'), ('organization_queues'),
    ('organization_qr_tokens'), ('queue_sessions'), ('queue_entries'), ('queue_history'),
    ('activity_log'), ('queue_presence'), ('queue_status_tokens')
), unprotected as (
  select r.table_name
  from required r
  left join pg_class c on c.oid = to_regclass('public.' || r.table_name)
  where c.oid is null or not c.relrowsecurity
)
select 'RLS enabled on protected tables' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
       coalesce(string_agg(table_name, ', '), 'none') as missing_or_rls_disabled
from unprotected;

-- TEST 7: Required role-scoped policies exist.
-- This checks catalog presence, not runtime behavior; runtime checks are listed below.
with required(table_name, policy_name) as (
  values
    ('organizations', 'Super admins can manage organizations'),
    ('organizations', 'Admin can update their organization'),
    ('profiles', 'Users can view their own profile'),
    ('profiles', 'Admins and super admins can view org profiles'),
    ('profiles', 'Users can update their own profile'),
    ('organization_locations', 'Assigned staff can view organization locations'),
    ('organization_queues', 'Assigned staff can view organization queues'),
    ('queue_sessions', 'Assigned staff can view queue sessions'),
    ('queue_entries', 'Assigned staff can view queue entries'),
    ('queue_history', 'Assigned staff can view queue history'),
    ('organization_qr_tokens', 'Admins can manage QR access tokens for their org'),
    ('organization_qr_tokens', 'Assigned staff can view queue QR tokens'),
    ('organization_qr_tokens', 'Assigned staff can create queue QR tokens'),
    ('organization_qr_tokens', 'Assigned staff can update queue QR tokens'),
    ('activity_log', 'Staff can view scoped activity log'),
    ('queue_presence', 'Staff can view scoped queue presence')
), missing as (
  select r.table_name, r.policy_name
  from required r
  where not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = r.table_name
      and p.policyname = r.policy_name
  )
)
select 'required RLS policies exist' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
       coalesce(string_agg(table_name || '.' || policy_name, ', '), 'none') as missing_policies
from missing;

-- TEST 7b: No unreviewed policies exist on protected tables.
-- NEEDS MANUAL TEST means inspect every returned policy; unexpected permissive
-- policies may broaden access even when the expected scoped policy is present.
with expected(table_name, policy_name) as (
  values
    ('organizations', 'Public can view active organizations'),
    ('organizations', 'Super admins can manage organizations'),
    ('organizations', 'Admin can update their organization'),
    ('profiles', 'Users can view their own profile'),
    ('profiles', 'Admins and super admins can view org profiles'),
    ('profiles', 'Users can update their own profile'),
    ('profiles', 'Super admins manage all profiles'),
    ('organization_locations', 'Assigned staff can view organization locations'),
    ('organization_queues', 'Assigned staff can view organization queues'),
    ('organization_qr_tokens', 'Admins can manage QR access tokens for their org'),
    ('organization_qr_tokens', 'Assigned staff can view queue QR tokens'),
    ('organization_qr_tokens', 'Assigned staff can create queue QR tokens'),
    ('organization_qr_tokens', 'Assigned staff can update queue QR tokens'),
    ('queue_sessions', 'Assigned staff can view queue sessions'),
    ('queue_entries', 'Assigned staff can view queue entries'),
    ('queue_history', 'Assigned staff can view queue history'),
    ('activity_log', 'Staff can view scoped activity log'),
    ('queue_presence', 'Staff can view scoped queue presence')
), unexpected as (
  select p.tablename, p.policyname, p.cmd, p.permissive, p.roles, p.qual, p.with_check
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in (
      'organizations','profiles','organization_locations','organization_queues',
      'organization_qr_tokens','queue_sessions','queue_entries','queue_history',
      'activity_log','queue_presence','queue_status_tokens'
    )
    and not exists (
      select 1 from expected e
      where e.table_name = p.tablename and e.policy_name = p.policyname
    )
)
select 'unreviewed protected-table policies' as test,
       case when count(*) = 0 then 'PASS' else 'NEEDS MANUAL TEST' end as status,
       coalesce(string_agg(format('%s.%s (%s, %s)', tablename, policyname, cmd, permissive), '; '), 'none') as policies_to_review
from unexpected;

-- TEST 8: Broad legacy STAFF policies and direct public QR-table policies are absent.
-- FAIL means an old broad policy survived and can OR with the scoped policy.
select 'broad legacy policies removed' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
       coalesce(string_agg(tablename || '.' || policyname, ', '), 'none') as unexpected_broad_policies
from pg_policies
where schemaname = 'public'
  and (
    (tablename = 'organization_qr_tokens' and policyname in (
      'Public can validate active QR access tokens',
      'Public can create QR access tokens for active organizations'
    ))
    or (tablename = 'activity_log' and policyname in (
      'Org staff can manage activity log for their org',
      'Org staff can view activity log for their org'
    ))
    or (tablename = 'queue_presence' and policyname = 'Org staff can view presence for their org')
    or (tablename = 'queue_sessions' and policyname = 'Staff can view queue sessions for their org')
    or (tablename = 'queue_entries' and policyname = 'Org staff can view queue entries for their org')
    or (tablename = 'queue_history' and policyname = 'Org staff can view history for their org')
  );

-- TEST 9: Queue policies reference role helpers and STAFF assignment helper.
-- FAIL means queue data policy predicates do not express the expected boundary.
with checks(test_name, passed) as (
  select 'queue entries policy has admin and assigned-queue checks', exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'queue_entries'
      and p.policyname = 'Assigned staff can view queue entries'
      and p.roles @> array['authenticated']::name[]
      and position('is_super_admin' in coalesce(p.qual, '')) > 0
      and position('is_org_admin' in coalesce(p.qual, '')) > 0
      and position('can_manage_organization_queue' in coalesce(p.qual, '')) > 0
  )
  union all
  select 'activity policy excludes NULL queue history for STAFF', exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'activity_log'
      and p.policyname = 'Staff can view scoped activity log'
      and p.roles @> array['authenticated']::name[]
      and position('queue_id IS NOT NULL' in upper(coalesce(p.qual, ''))) > 0
      and position('can_manage_organization_queue' in coalesce(p.qual, '')) > 0
      and position('is_org_admin' in coalesce(p.qual, '')) > 0
      and position('is_super_admin' in coalesce(p.qual, '')) > 0
  )
  union all
  select 'presence policy validates linked entry and assigned queue', exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'queue_presence'
      and p.policyname = 'Staff can view scoped queue presence'
      and p.roles @> array['authenticated']::name[]
      and position('queue_entry_id' in coalesce(p.qual, '')) > 0
      and position('queue_id' in coalesce(p.qual, '')) > 0
      and position('can_manage_organization_queue' in coalesce(p.qual, '')) > 0
      and position('is_org_admin' in coalesce(p.qual, '')) > 0
      and position('is_super_admin' in coalesce(p.qual, '')) > 0
  )
)
select test_name as test,
       case when passed then 'PASS' else 'FAIL' end as status,
       case when passed then 'expected predicate fragments found' else 'policy is missing or predicate is broader/different than expected' end as details
from checks;

-- TEST 10: Role helper definitions are present and security-definer search_path is pinned.
-- FAIL means helper role checks or safe function configuration are missing.
with helper_checks(test_name, passed) as (
  select 'SUPER_ADMIN helper checks active SUPER_ADMIN profile',
    coalesce(position('SUPER_ADMIN' in pg_get_functiondef(to_regprocedure('public.is_super_admin()'))) > 0
      and position('is_active' in pg_get_functiondef(to_regprocedure('public.is_super_admin()'))) > 0, false)
  union all
  select 'ORG_ADMIN helper checks organization and ADMIN/ORG_ADMIN roles',
    coalesce(position('p_org_id' in pg_get_functiondef(to_regprocedure('public.is_org_admin(uuid)'))) > 0
      and position('ORG_ADMIN' in pg_get_functiondef(to_regprocedure('public.is_org_admin(uuid)'))) > 0
      and position('ADMIN' in pg_get_functiondef(to_regprocedure('public.is_org_admin(uuid)'))) > 0, false)
  union all
  select 'queue helper checks active STAFF assignment to queue/location',
    coalesce(position('STAFF' in pg_get_functiondef(to_regprocedure('public.can_manage_organization_queue(uuid,uuid)'))) > 0
      and position('is_active' in pg_get_functiondef(to_regprocedure('public.can_manage_organization_queue(uuid,uuid)'))) > 0
      and position('p.queue_id = q.id' in pg_get_functiondef(to_regprocedure('public.can_manage_organization_queue(uuid,uuid)'))) > 0
      and position('p.location_id = q.location_id' in pg_get_functiondef(to_regprocedure('public.can_manage_organization_queue(uuid,uuid)'))) > 0, false)
)
select test_name as test,
       case when passed then 'PASS' else 'FAIL' end as status,
       case when passed then 'expected helper semantics found' else 'helper missing or its body differs from the repository contract' end as details
from helper_checks;

-- TEST 10b: Public lookups bind both organization identifier and queue ID.
-- FAIL means a function is missing or its checked-in query contract is absent.
with functions(signature, body) as (
  select 'get_organization_queue_availability',
    pg_get_functiondef(to_regprocedure('public.get_organization_queue_availability(text,uuid)'))
  union all
  select 'get_public_queue_details',
    pg_get_functiondef(to_regprocedure('public.get_public_queue_details(text,uuid)'))
  union all
  select 'get_public_queue_qr_token',
    pg_get_functiondef(to_regprocedure('public.get_public_queue_qr_token(text,uuid)'))
), checks as (
  select signature,
    body is not null
    and position('p_public_identifier' in body) > 0
    and position('p_queue_id' in body) > 0
    and position('o.public_identifier' in body) > 0
    and position('q.id = p_queue_id' in body) > 0 as passed
  from functions
)
select 'organization-bound public lookup: ' || signature as test,
  case when passed then 'PASS' else 'FAIL' end as status,
  'function predicate must bind organization identifier and queue ID' as details
from checks;

-- TEST 11: Security-definer API functions have a pinned search_path.
-- FAIL means a listed privileged function is missing, not SECURITY DEFINER, or lacks search_path config.
with required(signature) as (
  values
    ('public.get_organization_queue_availability(text,uuid)'),
    ('public.get_public_queue_details(text,uuid)'),
    ('public.get_public_queue_qr_token(text,uuid)'),
    ('public.resolve_queue_qr_token(text)'),
    ('public.get_organization_location_queue_stats(uuid)'),
    ('public.get_organization_analytics(uuid,date,date,uuid)'),
    ('public.join_queue_with_status_token(text,text,text,text,text,text,text)'),
    ('public.register_walk_in_for_queue(uuid,text,text)'),
    ('public.update_student_queue_presence(text,text)'),
    ('public.log_queue_activity_and_broadcast()')
), config as (
  select r.signature, p.prosecdef, p.proconfig
  from required r
  left join pg_proc p on p.oid = to_regprocedure(r.signature)
)
select 'security-definer search_path: ' || signature as test,
       case when prosecdef and exists (
         select 1 from unnest(coalesce(proconfig, array[]::text[])) setting
         where setting like 'search_path=public%'
       ) then 'PASS' else 'FAIL' end as status,
       'prosecdef=' || coalesce(prosecdef::text, 'missing') || '; proconfig=' || coalesce(proconfig::text, 'missing') as details
from config;

-- TEST 12: Anonymous direct table grants and intentional public grants.
-- Expected: anon has no protected-table privileges; anon can read only the public snapshot/active organization surface and execute intended public RPCs.
with protected(table_name) as (
  values
    ('profiles'), ('organization_locations'), ('organization_queues'), ('organization_qr_tokens'),
    ('queue_sessions'), ('queue_entries'), ('queue_history'), ('activity_log'),
    ('queue_presence'), ('queue_status_tokens')
), privs as (
  select table_name,
         has_table_privilege('anon', to_regclass('public.' || table_name), 'SELECT') as can_select,
         has_table_privilege('anon', to_regclass('public.' || table_name), 'INSERT') as can_insert,
         has_table_privilege('anon', to_regclass('public.' || table_name), 'UPDATE') as can_update,
         has_table_privilege('anon', to_regclass('public.' || table_name), 'DELETE') as can_delete
  from protected
)
select 'anonymous protected table access: ' || table_name as test,
       case when not can_select and not can_insert and not can_update and not can_delete then 'PASS' else 'FAIL' end as status,
       format('SELECT=%s INSERT=%s UPDATE=%s DELETE=%s', can_select, can_insert, can_update, can_delete) as details
from privs;

select 'public queue snapshot read grant' as test,
       case when has_table_privilege('anon', 'public.public_queue_snapshot', 'SELECT') then 'PASS' else 'FAIL' end as status,
       'public display snapshot is intentionally readable' as details;

with public_functions(signature) as (
  values
    ('public.get_default_queue_id(text)'),
    ('public.get_queue_availability(text)'),
    ('public.get_organization_queue_availability(text,uuid)'),
    ('public.get_public_queue_details(text,uuid)'),
    ('public.get_public_queue_qr_token(text,uuid)'),
    ('public.resolve_queue_qr_token(text)'),
    ('public.join_queue_with_status_token(text,text,text,text,text,text,text)'),
    ('public.update_student_queue_presence(text,text)'),
    ('public.can_receive_student_queue_topic(text)')
)
select 'anonymous intended public RPC: ' || signature as test,
       case when to_regprocedure(signature) is not null
              and has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE') then 'PASS' else 'FAIL' end as status,
       'public registration/display capability' as details
from public_functions;

with private_functions(signature) as (
  values
    ('public.get_organization_location_queue_stats(uuid)'),
    ('public.get_organization_analytics(uuid,date,date,uuid)'),
    ('public.create_organization_location(uuid,text,text,text,text,text)'),
    ('public.update_organization_location(uuid,text,text,text,text,text,boolean)'),
    ('public.create_organization_queue(uuid,uuid,text,text,text,text,text,time,time,text,smallint[])'),
    ('public.update_organization_queue(uuid,uuid,text,text,text,text,boolean,time,time,text,smallint[],text)'),
    ('public.archive_organization_location(uuid)'),
    ('public.archive_organization_queue(uuid)'),
    ('public.assign_profile_to_queue(uuid,uuid,uuid)'),
    ('public.set_organization_queue_availability(uuid,text)'),
    ('public.set_queue_availability(uuid,text)'),
    ('public.reset_organization_queue_session(uuid)'),
    ('public.register_walk_in_for_queue(uuid,text,text)'),
    ('public.register_walk_in_patient(uuid,text,text)'),
    ('public.reset_queue_session(uuid)'),
    ('public.transition_queue_entry(uuid,text)'),
    ('public.delete_queue_entry(uuid)'),
    ('public.create_public_qr_token_for_queue()')
)
select 'anonymous privileged RPC denied: ' || signature as test,
       case when to_regprocedure(signature) is not null
              and not has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE') then 'PASS' else 'FAIL' end as status,
       'must require authenticated authorization' as details
from private_functions;

-- TEST 13: Queue/location/session/entry/token ownership consistency.
-- FAIL means cross-organization references or mismatched sessions exist.
with mismatches(test_name, row_id) as (
  select 'queue-location organization mismatch', q.id::text
  from public.organization_queues q
  left join public.organization_locations l on l.id = q.location_id
  where l.id is null or q.organization_id is distinct from l.organization_id
  union all
  select 'session queue organization mismatch', s.id::text
  from public.queue_sessions s
  join public.organization_queues q on q.id = s.queue_id
  where s.organization_id is distinct from q.organization_id
  union all
  select 'entry session/queue scope mismatch', e.id::text
  from public.queue_entries e
  left join public.queue_sessions s on s.id = e.queue_session_id
  left join public.organization_queues q on q.id = e.queue_id
  where s.id is null
     or e.organization_id is distinct from s.organization_id
      or e.queue_id is distinct from s.queue_id
      or (e.queue_id is not null and (q.id is null or e.organization_id is distinct from q.organization_id))
  union all
  select 'QR token queue organization mismatch', t.id::text
  from public.organization_qr_tokens t
  left join public.organization_queues q on q.id = t.queue_id
  where t.queue_id is not null and (q.id is null or t.organization_id is distinct from q.organization_id)
), expected_checks(test_name) as (
  values
    ('queue-location organization mismatch'),
    ('session queue organization mismatch'),
    ('entry session/queue scope mismatch'),
    ('QR token queue organization mismatch')
), counts as (
  select test_name, count(*) as mismatched_rows
  from mismatches
  group by test_name
)
select e.test_name as test,
       case when coalesce(c.mismatched_rows, 0) = 0 then 'PASS' else 'FAIL' end as status,
       coalesce(c.mismatched_rows, 0) as mismatched_rows
from expected_checks e
left join counts c using (test_name)
order by e.test_name;

-- TEST 14: Activity and presence queue association consistency.
-- Unknown historical activity remains NULL; this check only rejects contradictory known associations.
select 'presence matches linked entry and organization' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
       count(*) as bad_rows
from public.queue_presence p
left join public.queue_entries e on e.id = p.queue_entry_id
where e.id is null
   or p.organization_id is distinct from e.organization_id
   or p.queue_id is distinct from e.queue_id;

select 'known activity JSON queue IDs match activity queue_id' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
       count(*) as bad_rows
from public.activity_log a
left join public.organization_queues q
  on q.organization_id = a.organization_id
 and q.id = case
   when a.details->>'queue_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     then (a.details->>'queue_id')::uuid
   else null
 end
where a.details->>'queue_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (q.id is null or a.queue_id is distinct from q.id);

-- TEST 15: Public QR lookup returns only intended public registration fields.
-- The token is used internally for resolution but is never selected or displayed by this audit.
with sample_queue as (
  select o.public_identifier, q.id as queue_id
  from public.organizations o
  join public.organization_queues q on q.organization_id = o.id
  join public.organization_locations l on l.id = q.location_id
  where o.is_active and q.is_active and l.is_active
  order by o.public_identifier, q.id
  limit 1
), detail as (
  select public.get_public_queue_details(public_identifier, queue_id) as payload
  from sample_queue
)
select 'public queue details response shape' as test,
       case
         when not exists (select 1 from sample_queue) then 'NEEDS MANUAL TEST'
         when (select payload is null from detail) then 'FAIL'
         when exists (
           select 1 from detail d cross join lateral jsonb_object_keys(d.payload) k(key)
           where k.key not in ('queueId','queueName','locationName','queuePrefix','serviceArea','availability','sessionDate','sessionId','sessionStatus')
         ) then 'FAIL'
         when not (select payload ?& array['queueId','queueName','locationName','queuePrefix','serviceArea','availability','sessionDate','sessionId','sessionStatus'] from detail) then 'FAIL'
         else 'PASS'
       end as status,
       'no patient/private columns are expected in this RPC response' as details;

with sample_token as (
  select t.token, o.public_identifier, q.id as queue_id
  from public.organization_qr_tokens t
  join public.organizations o on o.id = t.organization_id
  join public.organization_queues q on q.id = t.queue_id and q.organization_id = o.id
  join public.organization_locations l on l.id = q.location_id
  where o.is_active and q.is_active and l.is_active and t.is_active
    and (t.expires_at is null or t.expires_at > now())
  order by t.created_at desc
  limit 1
), resolved as (
  select public.resolve_queue_qr_token(token) as payload, public_identifier, queue_id
  from sample_token
)
select 'active QR token resolves to its bound organization/queue' as test,
       case
         when not exists (select 1 from sample_token) then 'NEEDS MANUAL TEST'
         when exists (select 1 from resolved where payload is null or payload->>'clinicIdentifier' is distinct from public_identifier or payload->>'queueId' is distinct from queue_id::text) then 'FAIL'
         when exists (
           select 1 from resolved r cross join lateral jsonb_object_keys(r.payload) k(key)
           where k.key not in ('clinicIdentifier','clinicName','queueId','queueName','locationName','availability')
         ) then 'FAIL'
         else 'PASS'
       end as status,
       'QR token value is not included in result' as details;

with cross_org_pair as (
  select org_a.public_identifier as requested_identifier, q_b.id as foreign_queue_id
  from public.organizations org_a
  join public.organization_queues q_a on q_a.organization_id = org_a.id and q_a.is_active
  join public.organizations org_b on org_b.id <> org_a.id and org_b.is_active
  join public.organization_queues q_b on q_b.organization_id = org_b.id and q_b.is_active
  where org_a.is_active
  limit 1
), result as (
  select public.get_public_queue_details(requested_identifier, foreign_queue_id) as details,
         public.get_organization_queue_availability(requested_identifier, foreign_queue_id) as availability
  from cross_org_pair
)
select 'public queue lookup rejects cross-organization queue IDs' as test,
       case
         when not exists (select 1 from cross_org_pair) then 'NEEDS MANUAL TEST'
         when exists (select 1 from result where details is not null or availability <> 'CLOSED') then 'FAIL'
         else 'PASS'
       end as status,
       'requires two active organizations with queues to test' as details;

-- TEST 16: Active queues have a usable QR token without revealing token text.
select 'active queues have active public QR bearers' as test,
       case
         when not exists (select 1 from public.organizations where is_active) then 'NEEDS MANUAL TEST'
         when exists (
           select 1 from public.organization_queues q
           join public.organizations o on o.id = q.organization_id and o.is_active
           where q.is_active
             and public.get_public_queue_qr_token(o.public_identifier, q.id) is null
         ) then 'FAIL'
         else 'PASS'
       end as status,
       'bearer token values are not displayed' as details;

-- TEST 17: Backend availability and scoped analytics logic are present in the deployed function bodies.
-- This is a source-contract check; exercise the denial/success behavior with real authenticated sessions below.
with function_defs as (
  select
    pg_get_functiondef(to_regprocedure('public.join_queue_with_status_token(text,text,text,text,text,text,text)')) as join_def,
    pg_get_functiondef(to_regprocedure('public.register_walk_in_for_queue(uuid,text,text)')) as walk_in_def,
    pg_get_functiondef(to_regprocedure('public.get_organization_analytics(uuid,date,date,uuid)')) as analytics_def
)
select 'join RPC checks queue availability and queue-bound token' as test,
       case when position('QUEUE_PAUSED' in join_def) > 0
                  and position('QUEUE_CLOSED' in join_def) > 0
                  and position('queue_id' in join_def) > 0
                  and position('SESSION_NOT_STARTED' in join_def) > 0
                  and position('SESSION_ENDED' in join_def) > 0
                  and position('SESSION_NOT_STARTED' in walk_in_def) > 0
                  and position('SESSION_ENDED' in walk_in_def) > 0
            then 'PASS' else 'FAIL' end as status,
       'QR and walk-in RPCs require an active session; runtime denial still needs staging test' as details
from function_defs;

select 'active session availability matches queue availability' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
       count(*) as inconsistent_active_sessions
from public.queue_sessions s
join public.organization_queues q on q.id = s.queue_id and q.organization_id = s.organization_id
where s.session_date = current_date
  and s.is_active
  and s.admission_status is distinct from q.admission_status;

select 'no duplicate current-day queue sessions' as test,
       case when exists (
         select 1 from public.queue_sessions
         where session_date = current_date and queue_id is not null
         group by organization_id, queue_id, session_date
         having count(*) > 1
       ) then 'FAIL' else 'PASS' end as status,
       'the unique queue/date index should enforce this invariant' as details;

select 'session date basis and configured queue zones' as test,
       'NEEDS MANUAL TEST' as status,
       format('database_timezone=%s; database_current_date=%s; configured_queue_time_zones=%s',
         current_setting('TimeZone'),
         current_date,
         coalesce((select string_agg(distinct time_zone, ', ' order by time_zone)
                   from public.organization_queues where nullif(time_zone, '') is not null), 'none')) as details;

with details_def as (
  select pg_get_functiondef(to_regprocedure('public.get_public_queue_details(text,uuid)')) as body
)
select 'public queue details reports independent session state' as test,
       case when position('NOT_STARTED' in body) > 0
                  and position('ACTIVE' in body) > 0
                  and position('ENDED' in body) > 0
                  and position('sessionStatus' in body) > 0
            then 'PASS' else 'FAIL' end as status,
       'session state is returned separately from queue availability' as details
from details_def;

with join_def as (
  select pg_get_functiondef(to_regprocedure('public.join_queue_with_status_token(text,text,text,text,text,text,text)')) as body
)
select 'QR registration requires pre-started active session' as test,
       case when position('SESSION_NOT_STARTED' in body) > 0
                  and position('SESSION_ENDED' in body) > 0
                  and position('insert into public.queue_sessions' in lower(body)) = 0
            then 'PASS' else 'FAIL' end as status,
       'registration must not silently create a session' as details
from join_def;

with definition as (
  select pg_get_functiondef(to_regprocedure('public.get_organization_analytics(uuid,date,date,uuid)')) as body
)
select 'analytics enforces staff queue and organization scope' as test,
       case when position('STAFF analytics require an assigned queue' in body) > 0
                  and position('can_manage_organization_queue' in body) > 0
                  and position('Supplied organization does not match the requested queue' in body) > 0
                  and position('is_org_admin' in body) > 0
                  and position('is_super_admin' in body) > 0
            then 'PASS' else 'FAIL' end as status,
       'authorization path is present; account-specific result still needs manual testing' as details
from definition;

-- TEST 18: Legacy single-queue organizations keep one active default queue and wrappers.
-- FAIL means an active organization has no unique active default queue.
with active_orgs as (
  select o.id, count(q.id) filter (where q.is_active and q.is_default) as active_defaults
  from public.organizations o
  left join public.organization_queues q on q.organization_id = o.id
  where o.is_active
  group by o.id
)
select 'one active default queue per active organization' as test,
       case
         when not exists (select 1 from active_orgs) then 'NEEDS MANUAL TEST'
         when bool_and(active_defaults = 1) then 'PASS'
         else 'FAIL'
       end as status,
       count(*) filter (where active_defaults <> 1) as organizations_with_wrong_default_count
from active_orgs;

select 'legacy default-queue wrappers present' as test,
       case when to_regprocedure('public.get_default_queue_id(text)') is not null
                  and to_regprocedure('public.set_queue_availability(uuid,text)') is not null
                  and to_regprocedure('public.reset_queue_session(uuid)') is not null
                  and to_regprocedure('public.register_walk_in_patient(uuid,text,text)') is not null
            then 'PASS' else 'FAIL' end as status,
       'wrappers resolve the organization default queue' as details;

-- TEST 19: Queue sessions do not have duplicate numbering scopes.
-- This checks stored data; the independent increment behavior still needs a controlled test queue.
select 'no duplicate organization/queue/date sessions' as test,
       case when exists (
         select 1 from public.queue_sessions
         group by organization_id, queue_id, session_date
         having count(*) > 1
       ) then 'FAIL' else 'PASS' end as status,
       'queue_sessions_queue_date_uidx must also be PASS in TEST 2' as details;

with number_functions as (
  select
    pg_get_functiondef(to_regprocedure('public.join_queue_with_status_token(text,text,text,text,text,text,text)')) as qr_join,
    pg_get_functiondef(to_regprocedure('public.register_walk_in_for_queue(uuid,text,text)')) as walk_in
)
select 'registration counters are keyed by queue session' as test,
       case when position('queue_id = v_queue.id' in qr_join) > 0
                  and position('queue_id = v_queue.id' in walk_in) > 0
                  and position('next_number = next_number + 1' in qr_join) > 0
                  and position('next_number = next_number + 1' in walk_in) > 0
            then 'PASS' else 'FAIL' end as status,
       'this verifies function source, not a live increment test' as details
from number_functions;

-- TEST 20: Realtime publication contains the queue/activity/presence sources.
-- FAIL means Postgres Changes cannot emit one or more expected table events.
with required(table_name) as (
  values ('queue_entries'), ('activity_log'), ('queue_presence')
), missing as (
  select r.table_name
  from required r
  where not exists (
    select 1 from pg_publication_tables p
    where p.pubname = 'supabase_realtime'
      and p.schemaname = 'public'
      and p.tablename = r.table_name
  )
)
select 'Realtime publication membership' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
       coalesce(string_agg(table_name, ', '), 'none') as missing_tables
from missing;

-- TEST 21: Profile role boundaries (important existing-schema check).
-- A FAIL indicates authenticated users can update their own role without an inspected role-immutability trigger.
select 'self-service profile role escalation guard' as test,
       case
         when not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') then 'PASS'
         when not exists (
           select 1 from pg_policies p
           where p.schemaname = 'public' and p.tablename = 'profiles'
             and p.policyname = 'Users can update their own profile'
         ) then 'PASS'
         when exists (
           select 1
           from pg_trigger t
           join pg_proc f on f.oid = t.tgfoid
           where t.tgrelid = 'public.profiles'::regclass
             and not t.tgisinternal
             and position('new.role' in lower(pg_get_functiondef(f.oid))) > 0
             and position('old.role' in lower(pg_get_functiondef(f.oid))) > 0
             and position('new.role is distinct from old.role' in lower(pg_get_functiondef(f.oid))) > 0
             and position('raise exception' in lower(pg_get_functiondef(f.oid))) > 0
         ) then 'PASS'
         else 'FAIL'
       end as status,
       'checked column UPDATE grant, own-profile UPDATE policy, and role-change trigger source' as details;

-- TEST 22: Profile-directory scope is broader than queue scope in the checked-in base schema.
-- FAIL here means STAFF can read organization profiles through is_org_staff(); review whether this is intended.
select 'STAFF profile directory scope' as test,
       case
         when exists (
           select 1 from pg_policies p
           where p.schemaname = 'public' and p.tablename = 'profiles'
             and p.policyname = 'Admins and super admins can view org profiles'
             and position('is_org_staff' in coalesce(p.qual, '')) > 0
         )
         and position('STAFF' in pg_get_functiondef(to_regprocedure('public.is_org_staff(uuid)'))) > 0
           then 'FAIL'
         else 'PASS'
       end as status,
       'this is not queue-entry access, but can expose other staff profile data across the organization' as details;

-- MANUAL TESTS: Run from separate authenticated sessions using existing accounts and known IDs.
-- Do not create users, queues, or queue entries in production solely for this audit.
-- Each denial query should be run separately because the expected error aborts its statement.
--
-- STAFF assigned queue A, same organization:
-- select public.can_manage_organization_queue('<ORG_UUID>'::uuid, '<ASSIGNED_QUEUE_A_UUID>'::uuid); -- expected true
-- select public.can_manage_organization_queue('<ORG_UUID>'::uuid, '<UNASSIGNED_QUEUE_B_UUID>'::uuid); -- expected false
-- select public.get_organization_analytics('<ORG_UUID>'::uuid, current_date - 7, current_date, '<ASSIGNED_QUEUE_A_UUID>'::uuid); -- expected queue A aggregate
-- select public.get_organization_analytics('<ORG_UUID>'::uuid, current_date - 7, current_date, '<UNASSIGNED_QUEUE_B_UUID>'::uuid); -- expected authorization exception
-- select public.get_organization_analytics('<ORG_UUID>'::uuid, current_date - 7, current_date, null); -- expected STAFF queue-required exception
-- select count(*) from public.queue_entries where queue_id = '<UNASSIGNED_QUEUE_B_UUID>'::uuid; -- expected 0 under RLS
-- select count(*) from public.activity_log where queue_id = '<UNASSIGNED_QUEUE_B_UUID>'::uuid or queue_id is null; -- expected 0 under RLS
-- select count(*) from public.queue_presence where queue_id = '<UNASSIGNED_QUEUE_B_UUID>'::uuid; -- expected 0 under RLS
-- select public.get_organization_location_queue_stats('<OWN_ORG_UUID>'::uuid); -- expected assigned locations/queues only
-- select public.get_organization_location_queue_stats('<OTHER_ORG_UUID>'::uuid); -- expected authorization exception
--
-- ORG_ADMIN:
-- select count(*) from public.organization_queues where organization_id = '<OWN_ORG_UUID>'::uuid; -- expected all own queues
-- select public.get_organization_analytics('<OWN_ORG_UUID>'::uuid, current_date - 7, current_date, null); -- expected organization-wide aggregate
-- select public.get_organization_location_queue_stats('<OWN_ORG_UUID>'::uuid); -- expected all own locations/queues
--
-- SUPER_ADMIN:
-- select count(*) from public.organization_queues where organization_id = '<KNOWN_ORG_UUID>'::uuid; -- expected authorized organization queues
-- select public.get_organization_analytics('<KNOWN_ORG_UUID>'::uuid, current_date - 7, current_date, null); -- expected selected-organization aggregate
-- select public.get_organization_location_queue_stats('<KNOWN_ORG_UUID>'::uuid); -- expected all queues in that organization
--
-- Session start/resume: in staging, call public.start_organization_queue_session('<QUEUE_UUID>'::uuid)
-- as an authorized admin/staff; expect ACTIVE and a sessionId. Call again; expect the same
-- sessionId and no counter reset. As anon or unassigned STAFF, expect permission denial.
--
-- Realtime: sign in as STAFF A, then trigger test events in queue A and queue B in
-- staging. STAFF A should receive A only. Repeat as ORG_ADMIN; both queues in the
-- organization should update. The SQL catalog cannot prove client subscription behavior.
--
-- Independent numbering/runtime admission requires a controlled non-production queue test:
-- submit two registrations to different queues and verify each begins at its own prefix/001;
-- separately verify a paused/closed queue rejects QR and walk-in admission without an inserted entry.
select 'STAFF assigned/unassigned queue authorization' as test,
       'NEEDS MANUAL TEST' as status,
       'Run the STAFF A SQL snippets above in that authenticated session; assigned must succeed, unassigned/missing queue must be denied' as expected_and_failure_meaning
union all
select 'ORG_ADMIN organization-wide access',
       'NEEDS MANUAL TEST',
       'Run the ORG_ADMIN snippets above; all own queues should be visible and another organization should remain hidden'
union all
select 'SUPER_ADMIN authorized organization access',
       'NEEDS MANUAL TEST',
       'Run the SUPER_ADMIN snippets above for two known organizations; the requested organization scope should be returned'
union all
select 'staff/admin Realtime delivery scope',
       'NEEDS MANUAL TEST',
       'Use staging events: STAFF gets assigned queue only; ORG_ADMIN gets all queues in the organization'
union all
select 'independent numbering and availability rejection',
       'NEEDS MANUAL TEST',
       'Use controlled non-production queues; separate counters start at each queue prefix/001, paused/closed admission inserts no entry';

rollback;
