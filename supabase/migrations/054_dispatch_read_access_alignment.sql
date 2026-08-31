-- 054_dispatch_read_access_alignment.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Makes dispatch.view mandatory for operational Dispatch reads, preserves the
-- independent PLATFORM_ADMIN read path, and reduces browser table privileges
-- to SELECT-only. Domain mutations continue exclusively through RPCs.
--
-- Live ACL audit before this migration:
--   dispatches, dispatch_guides, dispatch_incidents, guide_documents
--     anon          SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     authenticated SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   dispatch_guide_lines
--     anon          no privileges
--     authenticated SELECT only

begin;

-- ============================================================
-- 1. PRECONDITIONS / DRIFT GUARDS
-- ============================================================

do $$
declare
  v_policy record;
begin
  if to_regclass('public.dispatches') is null
     or to_regclass('public.dispatch_guides') is null
     or to_regclass('public.dispatch_guide_lines') is null
     or to_regclass('public.dispatch_incidents') is null
     or to_regclass('public.guide_documents') is null then
    raise exception 'DISPATCH_READ_ACCESS_REQUIRED_RELATION_MISSING';
  end if;

  if to_regprocedure(
    'app_private.has_project_permission(uuid,text)'
  ) is null then
    raise exception 'HAS_PROJECT_PERMISSION_SIGNATURE_MISSING';
  end if;

  if to_regprocedure(
    'app_private.can_read_document(uuid)'
  ) is null then
    raise exception 'CAN_READ_DOCUMENT_SIGNATURE_MISSING';
  end if;

  for v_policy in
    select *
    from (
      values
        ('dispatches', 'dispatches_select'),
        ('dispatch_guides', 'dispatch_guides_select'),
        ('dispatch_guide_lines', 'dispatch_guide_lines_select'),
        ('dispatch_incidents', 'dispatch_incidents_select')
    ) expected(table_name, policy_name)
  loop
    if not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = v_policy.table_name
        and p.policyname = v_policy.policy_name
        and p.cmd = 'SELECT'
        and 'authenticated'::name = any(p.roles)
    ) then
      raise exception
        'DISPATCH_READ_ACCESS_EXPECTED_POLICY_MISSING: %.%',
        v_policy.table_name,
        v_policy.policy_name;
    end if;
  end loop;

  -- Phase 6 discovery found no operational guide_documents SELECT policy.
  -- Abort on drift instead of accidentally leaving an additional permissive
  -- policy in place alongside the policy created below.
  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'guide_documents'
      and p.cmd = 'SELECT'
      and position('is_platform_admin' in coalesce(p.qual, '')) = 0
  ) then
    raise exception 'GUIDE_DOCUMENTS_OPERATIONAL_SELECT_POLICY_REQUIRES_REVIEW';
  end if;

  -- Every table must retain an independent PLATFORM_ADMIN SELECT policy.
  if exists (
    select 1
    from (
      values
        ('dispatches'),
        ('dispatch_guides'),
        ('dispatch_guide_lines'),
        ('dispatch_incidents'),
        ('guide_documents')
    ) expected(table_name)
    where not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = expected.table_name
        and p.cmd = 'SELECT'
        and position(
          'is_platform_admin' in coalesce(p.qual, '')
        ) > 0
    )
  ) then
    raise exception 'DISPATCH_PLATFORM_ADMIN_READ_POLICY_MISSING';
  end if;
end;
$$;

-- ============================================================
-- 2. OPERATIONAL DISPATCH READ POLICIES
-- ============================================================

drop policy dispatches_select
on public.dispatches;

create policy dispatches_select
on public.dispatches
for select
to authenticated
using (
  app_private.has_project_permission(
    project_id,
    'dispatch.view'
  )
);

drop policy dispatch_guides_select
on public.dispatch_guides;

create policy dispatch_guides_select
on public.dispatch_guides
for select
to authenticated
using (
  app_private.has_project_permission(
    project_id,
    'dispatch.view'
  )
);

drop policy dispatch_guide_lines_select
on public.dispatch_guide_lines;

create policy dispatch_guide_lines_select
on public.dispatch_guide_lines
for select
to authenticated
using (
  app_private.has_project_permission(
    project_id,
    'dispatch.view'
  )
);

drop policy dispatch_incidents_select
on public.dispatch_incidents;

create policy dispatch_incidents_select
on public.dispatch_incidents
for select
to authenticated
using (
  app_private.has_project_permission(
    project_id,
    'dispatch.view'
  )
);

-- ============================================================
-- 3. GUIDE DOCUMENT RELATION READ
-- ============================================================

create policy guide_documents_select
on public.guide_documents
for select
to authenticated
using (
  app_private.has_project_permission(
    project_id,
    'dispatch.view'
  )
  and app_private.can_read_document(document_id)
);

-- ============================================================
-- 4. MINIMUM TABLE-GRANT HARDENING
-- ============================================================

-- SECURITY DEFINER functions are owned by postgres and are unaffected. The
-- service role remains explicit. Browser users can only SELECT rows admitted
-- by RLS; no direct domain mutation privilege remains.
revoke all privileges
on table
  public.dispatches,
  public.dispatch_guides,
  public.dispatch_guide_lines,
  public.dispatch_incidents,
  public.guide_documents
from public, anon, authenticated;

grant select
on table
  public.dispatches,
  public.dispatch_guides,
  public.dispatch_guide_lines,
  public.dispatch_incidents,
  public.guide_documents
to authenticated;

grant all privileges
on table
  public.dispatches,
  public.dispatch_guides,
  public.dispatch_guide_lines,
  public.dispatch_incidents,
  public.guide_documents
to service_role;

-- ============================================================
-- 5. FINAL SAFETY ASSERTIONS
-- ============================================================

do $$
declare
  v_policy record;
  v_table text;
  v_privilege text;
  v_qual text;
begin
  for v_policy in
    select *
    from (
      values
        ('dispatches', 'dispatches_select'),
        ('dispatch_guides', 'dispatch_guides_select'),
        ('dispatch_guide_lines', 'dispatch_guide_lines_select'),
        ('dispatch_incidents', 'dispatch_incidents_select')
    ) expected(table_name, policy_name)
  loop
    select p.qual
    into v_qual
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = v_policy.table_name
      and p.policyname = v_policy.policy_name
      and p.cmd = 'SELECT'
      and 'authenticated'::name = any(p.roles);

    if v_qual is null
       or position('has_project_permission' in v_qual) = 0
       or position('dispatch.view' in v_qual) = 0
       or position('is_project_member' in v_qual) > 0 then
      raise exception
        'DISPATCH_READ_ACCESS_POLICY_NOT_ALIGNED: %.%',
        v_policy.table_name,
        v_policy.policy_name;
    end if;
  end loop;

  select p.qual
  into v_qual
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'guide_documents'
    and p.policyname = 'guide_documents_select'
    and p.cmd = 'SELECT'
    and 'authenticated'::name = any(p.roles);

  if v_qual is null
     or position('has_project_permission' in v_qual) = 0
     or position('dispatch.view' in v_qual) = 0
     or position('can_read_document' in v_qual) = 0
     or position('is_project_member' in v_qual) > 0 then
    raise exception 'GUIDE_DOCUMENTS_READ_POLICY_NOT_ALIGNED';
  end if;

  foreach v_table in array array[
    'dispatches',
    'dispatch_guides',
    'dispatch_guide_lines',
    'dispatch_incidents',
    'guide_documents'
  ]
  loop
    if not has_table_privilege(
      'authenticated',
      format('public.%I', v_table),
      'SELECT'
    ) then
      raise exception 'DISPATCH_AUTHENTICATED_SELECT_MISSING: %', v_table;
    end if;

    foreach v_privilege in array array[
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]
    loop
      if has_table_privilege(
        'authenticated',
        format('public.%I', v_table),
        v_privilege
      ) then
        raise exception
          'DISPATCH_AUTHENTICATED_MUTATION_PRIVILEGE_REMAINS: %.%',
          v_table,
          v_privilege;
      end if;
    end loop;

    foreach v_privilege in array array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]
    loop
      if has_table_privilege(
        'anon',
        format('public.%I', v_table),
        v_privilege
      ) then
        raise exception
          'DISPATCH_ANON_TABLE_PRIVILEGE_REMAINS: %.%',
          v_table,
          v_privilege;
      end if;
    end loop;
  end loop;

  -- RLS and independent global reads must still be present after replacement.
  if exists (
    select 1
    from (
      values
        ('dispatches'),
        ('dispatch_guides'),
        ('dispatch_guide_lines'),
        ('dispatch_incidents'),
        ('guide_documents')
    ) expected(table_name)
    where not exists (
      select 1
      from pg_class c
      join pg_namespace n
        on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = expected.table_name
        and c.relrowsecurity is true
    )
  ) then
    raise exception 'DISPATCH_READ_ACCESS_RLS_NOT_ENABLED';
  end if;

  if exists (
    select 1
    from (
      values
        ('dispatches'),
        ('dispatch_guides'),
        ('dispatch_guide_lines'),
        ('dispatch_incidents'),
        ('guide_documents')
    ) expected(table_name)
    where not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = expected.table_name
        and p.cmd = 'SELECT'
        and position(
          'is_platform_admin' in coalesce(p.qual, '')
        ) > 0
    )
  ) then
    raise exception 'DISPATCH_PLATFORM_ADMIN_READ_POLICY_LOST';
  end if;
end;
$$;

-- Intentionally unchanged:
--   * register_dispatch(...)
--   * register_dispatch_with_lines(...)
--   * their EXECUTE grants (anon remains revoked)
--   * app_private.has_project_permission(...)
--   * app_private.can_read_document(...)
--   * app_private.can_read_storage_object(...)
--   * PLATFORM_ADMIN policies
--   * roles, memberships, states, results and data
--   * incidents catalog/RPC, document upload, batches and invoices

commit;
