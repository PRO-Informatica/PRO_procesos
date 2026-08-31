-- 053_programming_view_rls_alignment.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Makes programming.view mandatory for operational reads across Programming.
-- Project membership alone is not a read permission. Independent
-- PLATFORM_ADMIN global-read policies remain unchanged.

begin;

-- ============================================================
-- 1. PRECONDITIONS
-- ============================================================

do $$
declare
  v_policy record;
begin
  if to_regclass('public.programming') is null
     or to_regclass('public.programming_lines') is null
     or to_regclass('public.programming_revisions') is null
     or to_regclass('public.programming_revision_lines') is null then
    raise exception 'PROGRAMMING_VIEW_RLS_REQUIRED_RELATION_MISSING';
  end if;

  if to_regprocedure(
    'app_private.has_project_permission(uuid,text)'
  ) is null then
    raise exception 'HAS_PROJECT_PERMISSION_SIGNATURE_MISSING';
  end if;

  for v_policy in
    select *
    from (
      values
        ('programming', 'programming_select'),
        ('programming_lines', 'programming_lines_select'),
        ('programming_revisions', 'programming_revisions_select'),
        ('programming_revision_lines', 'programming_revision_lines_select')
    ) expected(table_name, policy_name)
  loop
    if not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = v_policy.table_name
        and p.policyname = v_policy.policy_name
        and p.cmd = 'SELECT'
    ) then
      raise exception
        'PROGRAMMING_VIEW_RLS_EXPECTED_POLICY_MISSING: %.%',
        v_policy.table_name,
        v_policy.policy_name;
    end if;
  end loop;
end;
$$;

-- ============================================================
-- 2. PROGRAMMING
-- ============================================================

drop policy programming_select
on public.programming;

create policy programming_select
on public.programming
for select
to authenticated
using (
  app_private.has_project_permission(
    project_id,
    'programming.view'
  )
);

-- ============================================================
-- 3. PROGRAMMING LINES
-- ============================================================

drop policy programming_lines_select
on public.programming_lines;

create policy programming_lines_select
on public.programming_lines
for select
to authenticated
using (
  app_private.has_project_permission(
    project_id,
    'programming.view'
  )
);

-- ============================================================
-- 4. PROGRAMMING REVISIONS
-- ============================================================

drop policy programming_revisions_select
on public.programming_revisions;

create policy programming_revisions_select
on public.programming_revisions
for select
to authenticated
using (
  exists (
    select 1
    from public.programming p
    where p.id = programming_revisions.programming_id
      and app_private.has_project_permission(
        p.project_id,
        'programming.view'
      )
  )
);

-- ============================================================
-- 5. PROGRAMMING REVISION LINES
-- ============================================================

drop policy programming_revision_lines_select
on public.programming_revision_lines;

create policy programming_revision_lines_select
on public.programming_revision_lines
for select
to authenticated
using (
  app_private.has_project_permission(
    project_id,
    'programming.view'
  )
);

-- ============================================================
-- 6. FINAL SAFETY ASSERTIONS
-- ============================================================

do $$
declare
  v_policy record;
  v_qual text;
begin
  for v_policy in
    select *
    from (
      values
        ('programming', 'programming_select'),
        ('programming_lines', 'programming_lines_select'),
        ('programming_revisions', 'programming_revisions_select'),
        ('programming_revision_lines', 'programming_revision_lines_select')
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
       or position('programming.view' in v_qual) = 0
       or position('is_project_member' in v_qual) > 0 then
      raise exception
        'PROGRAMMING_VIEW_RLS_POLICY_NOT_ALIGNED: %.%',
        v_policy.table_name,
        v_policy.policy_name;
    end if;
  end loop;

  if exists (
    select 1
    from (
      values
        ('programming'),
        ('programming_lines'),
        ('programming_revisions'),
        ('programming_revision_lines')
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
    raise exception 'PROGRAMMING_VIEW_RLS_NOT_ENABLED';
  end if;

  -- Global platform policies must remain present and independent.
  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'programming'
      and p.policyname = 'platform_admin_read_programming'
      and position('is_platform_admin' in p.qual) > 0
  )
  or not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'programming_lines'
      and p.policyname = 'platform_admin_read_programming_lines'
      and position('is_platform_admin' in p.qual) > 0
  )
  or not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'programming_revisions'
      and p.policyname = 'platform_admin_read_programming_revisions'
      and position('is_platform_admin' in p.qual) > 0
  )
  or not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'programming_revision_lines'
      and p.policyname = 'platform_admin_read_programming_revision_lines'
      and position('is_platform_admin' in p.qual) > 0
  ) then
    raise exception 'PROGRAMMING_PLATFORM_ADMIN_READ_POLICY_MISSING';
  end if;
end;
$$;

-- Intentionally unchanged:
--   * PLATFORM_ADMIN policies
--   * roles and role_permissions
--   * project/company memberships
--   * app_private.has_project_permission(uuid, text)
--   * Programming mutation RPCs
--   * table grants and data

commit;
