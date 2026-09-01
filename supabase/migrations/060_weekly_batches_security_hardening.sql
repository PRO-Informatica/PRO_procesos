-- 060_weekly_batches_security_hardening.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Operational Phase 8, Migration A only.
-- Hardens Weekly Batch table grants and RPC exposure without changing any
-- weekly workflow or business rule.

begin;

-- ============================================================
-- 1. PRECONDITIONS / DRIFT GUARDS
-- ============================================================

do $$
declare
  v_signature text;
begin
  if to_regclass('public.batches') is null
     or to_regclass('public.batch_guides') is null then
    raise exception 'WEEKLY_BATCH_SECURITY_RELATION_MISSING';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'batches'
      and c.relrowsecurity
  )
  or not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'batch_guides'
      and c.relrowsecurity
  ) then
    raise exception 'WEEKLY_BATCH_SECURITY_RLS_NOT_ENABLED';
  end if;

  foreach v_signature in array array[
    'public.create_batch(uuid,text,date,date)',
    'public.add_guide_to_batch(uuid,uuid)',
    'public.remove_guide_from_batch(uuid,uuid)',
    'public.submit_batch_for_review(uuid)',
    'public.validate_batch(uuid)',
    'public.request_batch_authorization(uuid)',
    'public.authorize_batch(uuid,text)',
    'public.return_batch(uuid,text)',
    'public.reopen_batch(uuid,text)',
    'public.ensure_weekly_batch(uuid,date)',
    'public.rollover_weekly_batch(uuid)'
  ]
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'WEEKLY_BATCH_SECURITY_RPC_MISSING: %', v_signature;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'batches'
      and p.cmd = 'SELECT'
      and position('batch.view' in coalesce(p.qual, '')) > 0
  )
  or not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'batch_guides'
      and p.cmd = 'SELECT'
      and position('batch.view' in coalesce(p.qual, '')) > 0
  ) then
    raise exception 'WEEKLY_BATCH_SECURITY_OPERATIONAL_POLICY_MISSING';
  end if;

  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'batches'
      and p.cmd = 'SELECT'
      and position('is_platform_admin' in coalesce(p.qual, '')) > 0
  )
  or not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'batch_guides'
      and p.cmd = 'SELECT'
      and position('is_platform_admin' in coalesce(p.qual, '')) > 0
  ) then
    raise exception 'WEEKLY_BATCH_SECURITY_PLATFORM_ADMIN_POLICY_MISSING';
  end if;
end;
$$;

-- ============================================================
-- 2. TABLE GRANTS — AUTHENTICATED READS THROUGH RLS ONLY
-- ============================================================

revoke all privileges
on table public.batches, public.batch_guides
from public, anon, authenticated;

grant select
on table public.batches, public.batch_guides
to authenticated;

grant all privileges
on table public.batches, public.batch_guides
to service_role;

-- ============================================================
-- 3. HUMAN RPC EXPOSURE
-- ============================================================

revoke all on function public.create_batch(uuid,text,date,date)
from public, anon;
grant execute on function public.create_batch(uuid,text,date,date)
to authenticated, service_role;

revoke all on function public.add_guide_to_batch(uuid,uuid)
from public, anon;
grant execute on function public.add_guide_to_batch(uuid,uuid)
to authenticated, service_role;

revoke all on function public.remove_guide_from_batch(uuid,uuid)
from public, anon;
grant execute on function public.remove_guide_from_batch(uuid,uuid)
to authenticated, service_role;

revoke all on function public.submit_batch_for_review(uuid)
from public, anon;
grant execute on function public.submit_batch_for_review(uuid)
to authenticated, service_role;

revoke all on function public.validate_batch(uuid)
from public, anon;
grant execute on function public.validate_batch(uuid)
to authenticated, service_role;

revoke all on function public.request_batch_authorization(uuid)
from public, anon;
grant execute on function public.request_batch_authorization(uuid)
to authenticated, service_role;

revoke all on function public.authorize_batch(uuid,text)
from public, anon;
grant execute on function public.authorize_batch(uuid,text)
to authenticated, service_role;

revoke all on function public.return_batch(uuid,text)
from public, anon;
grant execute on function public.return_batch(uuid,text)
to authenticated, service_role;

revoke all on function public.reopen_batch(uuid,text)
from public, anon;
grant execute on function public.reopen_batch(uuid,text)
to authenticated, service_role;

-- ============================================================
-- 4. SYSTEM RPC EXPOSURE
-- ============================================================

revoke all on function public.ensure_weekly_batch(uuid,date)
from public, anon, authenticated;
grant execute on function public.ensure_weekly_batch(uuid,date)
to service_role;

revoke all on function public.rollover_weekly_batch(uuid)
from public, anon, authenticated;
grant execute on function public.rollover_weekly_batch(uuid)
to service_role;

-- ============================================================
-- 5. FINAL SAFETY ASSERTIONS
-- ============================================================

do $$
declare
  v_table text;
  v_privilege text;
  v_signature text;
begin
  foreach v_table in array array['batches', 'batch_guides']
  loop
    if not has_table_privilege(
      'authenticated', format('public.%I', v_table), 'SELECT'
    ) then
      raise exception 'WEEKLY_BATCH_AUTH_SELECT_MISSING: %', v_table;
    end if;

    foreach v_privilege in array array[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    loop
      if has_table_privilege(
        'authenticated', format('public.%I', v_table), v_privilege
      ) then
        raise exception 'WEEKLY_BATCH_AUTH_MUTATION_REMAINS: %.%',
          v_table, v_privilege;
      end if;
    end loop;

    foreach v_privilege in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
      'REFERENCES', 'TRIGGER'
    ]
    loop
      if has_table_privilege(
        'anon', format('public.%I', v_table), v_privilege
      ) then
        raise exception 'WEEKLY_BATCH_ANON_PRIVILEGE_REMAINS: %.%',
          v_table, v_privilege;
      end if;

      if not has_table_privilege(
        'service_role', format('public.%I', v_table), v_privilege
      ) then
        raise exception 'WEEKLY_BATCH_SERVICE_PRIVILEGE_MISSING: %.%',
          v_table, v_privilege;
      end if;
    end loop;
  end loop;

  foreach v_signature in array array[
    'create_batch(uuid,text,date,date)',
    'add_guide_to_batch(uuid,uuid)',
    'remove_guide_from_batch(uuid,uuid)',
    'submit_batch_for_review(uuid)',
    'validate_batch(uuid)',
    'request_batch_authorization(uuid)',
    'authorize_batch(uuid,text)',
    'return_batch(uuid,text)',
    'reopen_batch(uuid,text)'
  ]
  loop
    if not has_function_privilege(
      'authenticated', 'public.' || v_signature, 'EXECUTE'
    )
       or has_function_privilege(
         'anon', 'public.' || v_signature, 'EXECUTE'
       ) then
      raise exception 'WEEKLY_BATCH_HUMAN_RPC_GRANT_NOT_ALIGNED: %',
        v_signature;
    end if;
  end loop;

  foreach v_signature in array array[
    'ensure_weekly_batch(uuid,date)',
    'rollover_weekly_batch(uuid)'
  ]
  loop
    if not has_function_privilege(
      'service_role', 'public.' || v_signature, 'EXECUTE'
    )
       or has_function_privilege(
         'authenticated', 'public.' || v_signature, 'EXECUTE'
       )
       or has_function_privilege(
         'anon', 'public.' || v_signature, 'EXECUTE'
       ) then
      raise exception 'WEEKLY_BATCH_SYSTEM_RPC_GRANT_NOT_ALIGNED: %',
        v_signature;
    end if;
  end loop;
end;
$$;

commit;
