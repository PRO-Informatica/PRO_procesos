-- 076_platform_company_project_editing.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Allows a Platform Admin to edit the administrative fields of a Project.
-- Every update is validated, scoped to its Company and recorded with the
-- previous and resulting values in the global audit trail.

begin;

do $$
begin
  if to_regclass('public.companies') is null
     or to_regclass('public.projects') is null
     or to_regclass('public.audit_events') is null
     or to_regtype('public.project_status') is null
     or to_regprocedure('app_private.is_platform_admin()') is null then
    raise exception 'PLATFORM_PROJECT_EDITING_REQUIRED_CONTRACT_MISSING';
  end if;

  if to_regprocedure(
       'public.platform_update_company_project(uuid,uuid,text,text,text,text,text,date,date)'
     ) is not null then
    raise exception 'PLATFORM_PROJECT_EDITING_CONTRACT_ALREADY_EXISTS';
  end if;
end;
$$;

create function public.platform_update_company_project(
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
     or v_code !~ '^[A-Z0-9][A-Z0-9_-]*$' then
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

alter function public.platform_update_company_project(
  uuid,uuid,text,text,text,text,text,date,date
) owner to postgres;
revoke all on function public.platform_update_company_project(
  uuid,uuid,text,text,text,text,text,date,date
) from public, anon;
grant execute on function public.platform_update_company_project(
  uuid,uuid,text,text,text,text,text,date,date
) to authenticated, service_role;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.platform_update_company_project(uuid,uuid,text,text,text,text,text,date,date)'::regprocedure
  ) into v_definition;

  if position('app_private.is_platform_admin()' in v_definition) = 0
     or position('PLATFORM_PROJECT_UPDATED' in v_definition) = 0
     or position('PROJECT_COMPANY_MISMATCH' in v_definition) = 0
     or has_function_privilege(
       'anon',
       'public.platform_update_company_project(uuid,uuid,text,text,text,text,text,date,date)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.platform_update_company_project(uuid,uuid,text,text,text,text,text,date,date)',
       'EXECUTE'
     ) then
    raise exception 'PLATFORM_PROJECT_EDITING_SECURITY_NOT_ALIGNED';
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * Platform Admin can edit every administrative Project field;
--   * duplicate codes, invalid timezone/status and reversed dates fail;
--   * Project and Company context cannot be crossed;
--   * authenticated non-admin and anon cannot update a Project;
--   * audit_events stores PLATFORM_PROJECT_UPDATED with old/new values.
