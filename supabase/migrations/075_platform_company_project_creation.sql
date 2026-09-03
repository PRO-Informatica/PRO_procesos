-- 075_platform_company_project_creation.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Allows a Platform Admin to create an active Project inside an active
-- Company. The operation validates the Project business fields and records
-- the creation in the global audit trail.

begin;

do $$
begin
  if to_regclass('public.companies') is null
     or to_regclass('public.projects') is null
     or to_regclass('public.audit_events') is null
     or to_regprocedure('app_private.is_platform_admin()') is null then
    raise exception 'PLATFORM_PROJECT_CREATION_REQUIRED_CONTRACT_MISSING';
  end if;

  if to_regprocedure(
       'public.platform_create_company_project(uuid,text,text,text,text,date,date)'
     ) is not null then
    raise exception 'PLATFORM_PROJECT_CREATION_CONTRACT_ALREADY_EXISTS';
  end if;
end;
$$;

create function public.platform_create_company_project(
  p_company_id uuid,
  p_name text,
  p_code text,
  p_address text default null,
  p_timezone text default 'America/Guatemala',
  p_start_date date default null,
  p_estimated_end_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := nullif(btrim(p_name), '');
  v_code text := upper(nullif(btrim(p_code), ''));
  v_address text := nullif(btrim(p_address), '');
  v_timezone text := coalesce(nullif(btrim(p_timezone), ''), 'America/Guatemala');
  v_project_id uuid := gen_random_uuid();
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app_private.is_platform_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  if not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and company.status = 'ACTIVE'
    for update
  ) then
    raise exception 'ACTIVE_COMPANY_NOT_FOUND';
  end if;

  if v_name is null or char_length(v_name) not between 2 and 160 then
    raise exception 'PROJECT_NAME_INVALID';
  end if;
  if v_code is null
     or char_length(v_code) not between 2 and 40
     or v_code !~ '^[A-Z0-9][A-Z0-9_-]*$' then
    raise exception 'PROJECT_CODE_INVALID';
  end if;
  if v_address is not null and char_length(v_address) > 300 then
    raise exception 'PROJECT_ADDRESS_INVALID';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names timezone_definition
    where timezone_definition.name = v_timezone
  ) then
    raise exception 'PROJECT_TIMEZONE_INVALID';
  end if;
  if p_start_date is not null
     and p_estimated_end_date is not null
     and p_estimated_end_date < p_start_date then
    raise exception 'PROJECT_DATE_RANGE_INVALID';
  end if;

  begin
    insert into public.projects(
      id, company_id, name, code, address, timezone, status,
      start_date, estimated_end_date
    ) values (
      v_project_id, p_company_id, v_name, v_code, v_address, v_timezone,
      'ACTIVE', p_start_date, p_estimated_end_date
    );
  exception
    when unique_violation then
      raise exception 'PROJECT_CODE_ALREADY_EXISTS';
  end;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, p_company_id, v_project_id, 'project',
    v_project_id, 'PLATFORM_PROJECT_CREATED',
    jsonb_build_object(
      'name', v_name,
      'code', v_code,
      'address', v_address,
      'timezone', v_timezone,
      'status', 'ACTIVE',
      'start_date', p_start_date,
      'estimated_end_date', p_estimated_end_date
    )
  );

  return v_project_id;
end;
$$;

alter function public.platform_create_company_project(
  uuid,text,text,text,text,date,date
) owner to postgres;
revoke all on function public.platform_create_company_project(
  uuid,text,text,text,text,date,date
) from public, anon;
grant execute on function public.platform_create_company_project(
  uuid,text,text,text,text,date,date
) to authenticated, service_role;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.platform_create_company_project(uuid,text,text,text,text,date,date)'::regprocedure
  ) into v_definition;

  if position('app_private.is_platform_admin()' in v_definition) = 0
     or position('PLATFORM_PROJECT_CREATED' in v_definition) = 0
     or has_function_privilege(
       'anon',
       'public.platform_create_company_project(uuid,text,text,text,text,date,date)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.platform_create_company_project(uuid,text,text,text,text,date,date)',
       'EXECUTE'
     ) then
    raise exception 'PLATFORM_PROJECT_CREATION_SECURITY_NOT_ALIGNED';
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * Platform Admin can create a Project for an active Company;
--   * code is normalized to uppercase and duplicate codes are rejected;
--   * invalid timezone or reversed dates are rejected;
--   * inactive/missing Company is rejected;
--   * authenticated non-admin and anon cannot create a Project;
--   * audit_events records PLATFORM_PROJECT_CREATED.
