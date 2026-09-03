-- 077_relax_project_code_validation.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Allows commercial Project codes such as "LAS CAMPANELAS, S. A." while
-- preserving trimming, uppercase normalization, uniqueness and the 2..40
-- character limit. Control characters remain forbidden.
-- The migration defines both Project RPCs completely, so it can also repair
-- an environment where migration 075 or 076 was not applied.

begin;

do $$
begin
  if to_regclass('public.companies') is null then
    raise exception 'PROJECT_CODE_VALIDATION_COMPANIES_TABLE_MISSING';
  end if;
  if to_regclass('public.projects') is null then
    raise exception 'PROJECT_CODE_VALIDATION_PROJECTS_TABLE_MISSING';
  end if;
  if to_regclass('public.audit_events') is null then
    raise exception 'PROJECT_CODE_VALIDATION_AUDIT_EVENTS_TABLE_MISSING';
  end if;
  if to_regtype('public.project_status') is null then
    raise exception 'PROJECT_CODE_VALIDATION_PROJECT_STATUS_TYPE_MISSING';
  end if;
  if to_regprocedure('app_private.is_platform_admin()') is null then
    raise exception 'PROJECT_CODE_VALIDATION_PLATFORM_ADMIN_HELPER_MISSING';
  end if;
end;
$$;

create or replace function public.platform_create_company_project(
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
  v_timezone text := coalesce(
    nullif(btrim(p_timezone), ''), 'America/Guatemala'
  );
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
     or v_code ~ '[[:cntrl:]]' then
    raise exception 'PROJECT_CODE_INVALID';
  end if;
  if v_address is not null and char_length(v_address) > 300 then
    raise exception 'PROJECT_ADDRESS_INVALID';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone_definition
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

create or replace function public.platform_update_company_project(
  p_company_id uuid,
  p_project_id uuid,
  p_name text,
  p_code text,
  p_address text,
  p_timezone text,
  p_status text,
  p_start_date date,
  p_estimated_end_date date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_project public.projects%rowtype;
  v_name text := nullif(btrim(p_name), '');
  v_code text := upper(nullif(btrim(p_code), ''));
  v_address text := nullif(btrim(p_address), '');
  v_timezone text := coalesce(
    nullif(btrim(p_timezone), ''), 'America/Guatemala'
  );
  v_status text := upper(nullif(btrim(p_status), ''));
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app_private.is_platform_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  select project.* into v_project
  from public.projects project
  where project.id = p_project_id
  for update;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
  if v_project.company_id <> p_company_id then
    raise exception 'PROJECT_COMPANY_MISMATCH';
  end if;

  if v_name is null or char_length(v_name) not between 2 and 160 then
    raise exception 'PROJECT_NAME_INVALID';
  end if;
  if v_code is null
     or char_length(v_code) not between 2 and 40
     or v_code ~ '[[:cntrl:]]' then
    raise exception 'PROJECT_CODE_INVALID';
  end if;
  if v_address is not null and char_length(v_address) > 300 then
    raise exception 'PROJECT_ADDRESS_INVALID';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone_definition
    where timezone_definition.name = v_timezone
  ) then
    raise exception 'PROJECT_TIMEZONE_INVALID';
  end if;
  if v_status is null
     or v_status not in ('ACTIVE', 'INACTIVE', 'CLOSED') then
    raise exception 'PROJECT_STATUS_INVALID';
  end if;
  if p_start_date is not null
     and p_estimated_end_date is not null
     and p_estimated_end_date < p_start_date then
    raise exception 'PROJECT_DATE_RANGE_INVALID';
  end if;

  begin
    update public.projects
    set name = v_name,
        code = v_code,
        address = v_address,
        timezone = v_timezone,
        status = v_status::public.project_status,
        start_date = p_start_date,
        estimated_end_date = p_estimated_end_date,
        updated_at = now()
    where id = v_project.id;
  exception
    when unique_violation then
      raise exception 'PROJECT_CODE_ALREADY_EXISTS';
  end;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values
  ) values (
    v_actor, p_company_id, v_project.id, 'project',
    v_project.id, 'PLATFORM_PROJECT_UPDATED',
    jsonb_build_object(
      'name', v_project.name,
      'code', v_project.code,
      'address', v_project.address,
      'timezone', v_project.timezone,
      'status', v_project.status,
      'start_date', v_project.start_date,
      'estimated_end_date', v_project.estimated_end_date
    ),
    jsonb_build_object(
      'name', v_name,
      'code', v_code,
      'address', v_address,
      'timezone', v_timezone,
      'status', v_status,
      'start_date', p_start_date,
      'estimated_end_date', p_estimated_end_date
    )
  );

  return v_project.id;
end;
$$;

alter function public.platform_create_company_project(
  uuid,text,text,text,text,date,date
) owner to postgres;
alter function public.platform_update_company_project(
  uuid,uuid,text,text,text,text,text,date,date
) owner to postgres;

revoke all on function public.platform_create_company_project(
  uuid,text,text,text,text,date,date
) from public, anon;
revoke all on function public.platform_update_company_project(
  uuid,uuid,text,text,text,text,text,date,date
) from public, anon;

grant execute on function public.platform_create_company_project(
  uuid,text,text,text,text,date,date
) to authenticated, service_role;
grant execute on function public.platform_update_company_project(
  uuid,uuid,text,text,text,text,text,date,date
) to authenticated, service_role;

do $$
declare
  v_create_definition text;
  v_update_definition text;
begin
  select pg_get_functiondef(
    'public.platform_create_company_project(uuid,text,text,text,text,date,date)'::regprocedure
  ) into v_create_definition;
  select pg_get_functiondef(
    'public.platform_update_company_project(uuid,uuid,text,text,text,text,text,date,date)'::regprocedure
  ) into v_update_definition;

  if position('v_code ~ ''[[:cntrl:]]''' in v_create_definition) = 0
     or position('v_code ~ ''[[:cntrl:]]''' in v_update_definition) = 0
     or position('A-Z0-9' in v_create_definition) > 0
     or position('A-Z0-9' in v_update_definition) > 0
     or has_function_privilege(
       'anon',
       'public.platform_create_company_project(uuid,text,text,text,text,date,date)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.platform_update_company_project(uuid,uuid,text,text,text,text,text,date,date)',
       'EXECUTE'
     ) then
    raise exception 'PROJECT_CODE_VALIDATION_NOT_ALIGNED';
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * creation and editing accept "LAS CAMPANELAS, S. A.";
--   * codes remain uppercase, trimmed, unique and limited to 2..40 chars;
--   * empty codes and control characters are rejected;
--   * non-admin and anonymous callers remain unauthorized.
