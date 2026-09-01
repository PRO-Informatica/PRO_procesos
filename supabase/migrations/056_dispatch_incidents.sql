-- 056_dispatch_incidents.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Operational Phase 7, Migration B only.
-- Adds company-scoped operational incident-type reads and a transactional RPC
-- for reporting Dispatch incidents. Browser clients remain SELECT-only.
--
-- Intentionally excluded:
--   * documents, document versions, upload and storage policies
--   * incident documents
--   * guide/result correction and guide revisions
--   * automatic charge, invoice or reconciliation behavior

begin;

-- ============================================================
-- 1. PRECONDITIONS / DRIFT GUARDS
-- ============================================================

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'incident_types',
    'dispatch_incidents',
    'dispatches',
    'projects',
    'profiles',
    'audit_events'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'DISPATCH_INCIDENT_REQUIRED_RELATION_MISSING: %', v_table;
    end if;
  end loop;

  if to_regtype('public.responsibility_type') is null then
    raise exception 'DISPATCH_INCIDENT_RESPONSIBILITY_TYPE_MISSING';
  end if;

  if to_regtype('public.charge_applicability') is null then
    raise exception 'DISPATCH_INCIDENT_CHARGE_APPLICABILITY_TYPE_MISSING';
  end if;

  if to_regprocedure(
    'app_private.has_project_permission(uuid,text)'
  ) is null then
    raise exception 'HAS_PROJECT_PERMISSION_SIGNATURE_MISSING';
  end if;

  if to_regprocedure(
    'app_private.can_read_incident_type_company(uuid)'
  ) is not null then
    raise exception 'INCIDENT_TYPE_READ_HELPER_ALREADY_EXISTS';
  end if;

  if to_regprocedure(
    'public.register_dispatch_incident(uuid,uuid,public.responsibility_type,public.charge_applicability,text)'
  ) is not null then
    raise exception 'REGISTER_DISPATCH_INCIDENT_ALREADY_EXISTS';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'dispatch_incidents'
      and p.policyname = 'dispatch_incidents_select'
      and p.cmd = 'SELECT'
      and 'authenticated'::name = any(p.roles)
      and position('has_project_permission' in coalesce(p.qual, '')) > 0
      and position('dispatch.view' in coalesce(p.qual, '')) > 0
      and position('is_project_member' in coalesce(p.qual, '')) = 0
  ) then
    raise exception 'DISPATCH_INCIDENT_SELECT_POLICY_NOT_ALIGNED';
  end if;

  -- Discovery found no operational incident_types SELECT policy. Abort on
  -- drift instead of layering another permissive policy accidentally.
  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'incident_types'
      and p.cmd = 'SELECT'
      and position('is_platform_admin' in coalesce(p.qual, '')) = 0
  ) then
    raise exception 'INCIDENT_TYPES_OPERATIONAL_SELECT_POLICY_REQUIRES_REVIEW';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'incident_types'
      and p.cmd = 'SELECT'
      and position('is_platform_admin' in coalesce(p.qual, '')) > 0
  )
  or not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'dispatch_incidents'
      and p.cmd = 'SELECT'
      and position('is_platform_admin' in coalesce(p.qual, '')) > 0
  ) then
    raise exception 'DISPATCH_INCIDENT_PLATFORM_ADMIN_READ_POLICY_MISSING';
  end if;

  if exists (
    select 1
    from (
      values
        ('incident_types'),
        ('dispatch_incidents')
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
    raise exception 'DISPATCH_INCIDENT_RLS_NOT_ENABLED';
  end if;
end;
$$;

-- ============================================================
-- 2. COMPANY-SCOPED OPERATIONAL INCIDENT-TYPE READ
-- ============================================================

create function app_private.can_read_incident_type_company(
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select exists (
    select 1
    from public.projects p
    where p.company_id = p_company_id
      and p.status = 'ACTIVE'
      and app_private.has_project_permission(
        p.id,
        'dispatch.view'
      )
  );
$$;

alter function app_private.can_read_incident_type_company(uuid)
owner to postgres;

revoke all
on function app_private.can_read_incident_type_company(uuid)
from public, anon;

grant execute
on function app_private.can_read_incident_type_company(uuid)
to authenticated, service_role;

create policy incident_types_select_dispatch_access
on public.incident_types
for select
to authenticated
using (
  active = true
  and app_private.can_read_incident_type_company(company_id)
);

-- ============================================================
-- 3. TRANSACTIONAL INCIDENT REGISTRATION RPC
-- ============================================================

create function public.register_dispatch_incident(
  p_dispatch_id uuid,
  p_incident_type_id uuid,
  p_responsibility public.responsibility_type,
  p_charge_applicability public.charge_applicability,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_project_id uuid;
  v_company_id uuid;
  v_incident_type_company_id uuid;
  v_incident_type_active boolean;
  v_incident_id uuid;
  v_notes text := nullif(btrim(p_notes), '');
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select
    d.project_id,
    p.company_id
  into
    v_project_id,
    v_company_id
  from public.dispatches d
  join public.projects p
    on p.id = d.project_id
  where d.id = p_dispatch_id;

  if not found then
    raise exception 'DISPATCH_NOT_FOUND';
  end if;

  if not app_private.has_project_permission(
    v_project_id,
    'dispatch.register_incident'
  ) then
    raise exception 'DISPATCH_INCIDENT_PERMISSION_DENIED';
  end if;

  select
    it.company_id,
    it.active
  into
    v_incident_type_company_id,
    v_incident_type_active
  from public.incident_types it
  where it.id = p_incident_type_id;

  if not found then
    raise exception 'DISPATCH_INCIDENT_TYPE_INVALID';
  end if;

  if not v_incident_type_active then
    raise exception 'DISPATCH_INCIDENT_TYPE_INACTIVE';
  end if;

  if v_incident_type_company_id <> v_company_id then
    raise exception 'DISPATCH_INCIDENT_TYPE_COMPANY_MISMATCH';
  end if;

  -- The enum types constrain the accepted values. Explicit null checks keep
  -- RPC errors deterministic when a caller omits either required selection.
  if p_responsibility is null then
    raise exception 'DISPATCH_INCIDENT_RESPONSIBILITY_REQUIRED';
  end if;

  if p_charge_applicability is null then
    raise exception 'DISPATCH_INCIDENT_CHARGE_APPLICABILITY_REQUIRED';
  end if;

  -- The live catalog contains an OTHER code, but there is no catalog metadata
  -- or existing constraint that formally makes notes mandatory for that type.
  -- Notes therefore remain optional instead of hardcoding a hidden rule.
  insert into public.dispatch_incidents (
    project_id,
    dispatch_id,
    incident_type_id,
    responsibility,
    charge_applicability,
    notes,
    reported_by
  )
  values (
    v_project_id,
    p_dispatch_id,
    p_incident_type_id,
    p_responsibility,
    p_charge_applicability,
    v_notes,
    v_actor
  )
  returning id into v_incident_id;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    new_values
  )
  values (
    v_actor,
    v_company_id,
    v_project_id,
    'dispatch_incident',
    v_incident_id,
    'DISPATCH_INCIDENT_REPORTED',
    jsonb_build_object(
      'dispatch_id', p_dispatch_id,
      'incident_id', v_incident_id,
      'incident_type_id', p_incident_type_id,
      'responsibility', p_responsibility,
      'charge_applicability', p_charge_applicability
    )
  );

  return v_incident_id;
end;
$$;

alter function public.register_dispatch_incident(
  uuid,
  uuid,
  public.responsibility_type,
  public.charge_applicability,
  text
)
owner to postgres;

revoke all
on function public.register_dispatch_incident(
  uuid,
  uuid,
  public.responsibility_type,
  public.charge_applicability,
  text
)
from public, anon;

grant execute
on function public.register_dispatch_incident(
  uuid,
  uuid,
  public.responsibility_type,
  public.charge_applicability,
  text
)
to authenticated, service_role;

-- ============================================================
-- 4. MINIMUM TABLE-GRANT HARDENING
-- ============================================================

-- The existing dispatch_incidents SELECT policies remain unchanged. Browser
-- mutations are intentionally unavailable; creation uses the RPC above.
revoke all privileges
on table
  public.incident_types,
  public.dispatch_incidents
from public, anon, authenticated;

grant select
on table
  public.incident_types,
  public.dispatch_incidents
to authenticated;

grant all privileges
on table
  public.incident_types,
  public.dispatch_incidents
to service_role;

-- ============================================================
-- 5. FINAL SAFETY ASSERTIONS
-- ============================================================

do $$
declare
  v_table text;
  v_privilege text;
  v_policy_qual text;
  v_helper_definition text;
begin
  if to_regprocedure(
    'public.register_dispatch_incident(uuid,uuid,public.responsibility_type,public.charge_applicability,text)'
  ) is null then
    raise exception 'REGISTER_DISPATCH_INCIDENT_SIGNATURE_MISSING';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.register_dispatch_incident(uuid,uuid,public.responsibility_type,public.charge_applicability,text)',
    'EXECUTE'
  ) then
    raise exception 'REGISTER_DISPATCH_INCIDENT_AUTHENTICATED_EXECUTE_MISSING';
  end if;

  if has_function_privilege(
    'anon',
    'public.register_dispatch_incident(uuid,uuid,public.responsibility_type,public.charge_applicability,text)',
    'EXECUTE'
  ) then
    raise exception 'REGISTER_DISPATCH_INCIDENT_ANON_EXECUTE_REMAINS';
  end if;

  select p.qual
  into v_policy_qual
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'incident_types'
    and p.policyname = 'incident_types_select_dispatch_access'
    and p.cmd = 'SELECT'
    and 'authenticated'::name = any(p.roles);

  if v_policy_qual is null
     or position('active' in v_policy_qual) = 0
     or position('can_read_incident_type_company' in v_policy_qual) = 0
     or position('is_project_member' in v_policy_qual) > 0 then
    raise exception 'INCIDENT_TYPES_OPERATIONAL_POLICY_NOT_ALIGNED';
  end if;

  select pg_get_functiondef(
    'app_private.can_read_incident_type_company(uuid)'::regprocedure
  )
  into v_helper_definition;

  if position('dispatch.view' in v_helper_definition) = 0
     or position('projects' in v_helper_definition) = 0
     or position('company_id' in v_helper_definition) = 0
     or position('is_project_member' in v_helper_definition) > 0 then
    raise exception 'INCIDENT_TYPES_READ_HELPER_NOT_ALIGNED';
  end if;

  foreach v_table in array array[
    'incident_types',
    'dispatch_incidents'
  ]
  loop
    if not has_table_privilege(
      'authenticated',
      format('public.%I', v_table),
      'SELECT'
    ) then
      raise exception 'DISPATCH_INCIDENT_AUTHENTICATED_SELECT_MISSING: %', v_table;
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
          'DISPATCH_INCIDENT_AUTHENTICATED_MUTATION_PRIVILEGE_REMAINS: %.%',
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
          'DISPATCH_INCIDENT_ANON_TABLE_PRIVILEGE_REMAINS: %.%',
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
      if not has_table_privilege(
        'service_role',
        format('public.%I', v_table),
        v_privilege
      ) then
        raise exception
          'DISPATCH_INCIDENT_SERVICE_ROLE_PRIVILEGE_MISSING: %.%',
          v_table,
          v_privilege;
      end if;
    end loop;
  end loop;

  -- No browser mutation policy may bypass the command RPC.
  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'dispatch_incidents'
      and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and 'authenticated'::name = any(p.roles)
  ) then
    raise exception 'DISPATCH_INCIDENT_BROWSER_MUTATION_POLICY_REMAINS';
  end if;

  if not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'incident_types'
      and p.cmd = 'SELECT'
      and position('is_platform_admin' in coalesce(p.qual, '')) > 0
  )
  or not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'dispatch_incidents'
      and p.cmd = 'SELECT'
      and position('is_platform_admin' in coalesce(p.qual, '')) > 0
  ) then
    raise exception 'DISPATCH_INCIDENT_PLATFORM_ADMIN_READ_POLICY_LOST';
  end if;

  if exists (
    select 1
    from (
      values
        ('incident_types'),
        ('dispatch_incidents')
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
    raise exception 'DISPATCH_INCIDENT_RLS_LOST';
  end if;
end;
$$;

-- ============================================================
-- 6. QA PLAN — RUN ONLY AFTER MANUAL EXECUTION
-- ============================================================

-- Execute live QA inside a deliberately reversible transaction or statement:
--   * report SUPPLIER, PROJECT, SHARED and UNDETERMINED responsibility;
--   * report YES, NO and UNDETERMINED charge applicability;
--   * accept an active type from the Dispatch project company;
--   * reject inactive, nonexistent and other-company types with exact errors;
--   * accept COMPANY_ADMIN and RECEPTION with dispatch.register_incident;
--   * reject RESIDENT/PURCHASING without dispatch.register_incident even when
--     dispatch.view permits reading;
--   * reject PLATFORM_ADMIN without an operational role and reject anon;
--   * validate DISPATCH_INCIDENT_REPORTED without notes in audit metadata;
--   * confirm Dispatch status/result and all physical quantities are unchanged;
--   * validate PROJECT + YES for RETURNED/REJECTED with received_quantity = 0;
--   * validate incident_types company isolation, active-only filtering and RLS;
--   * verify authenticated SELECT-only, anon none and service_role grants;
--   * force rollback and confirm no incident or audit QA row remains.

commit;
