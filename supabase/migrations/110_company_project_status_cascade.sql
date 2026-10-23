-- A Company and its active Projects are disabled atomically. Enabling a
-- Company does not automatically enable Projects; CLOSED Projects stay closed.
begin;

do $$
begin
  if to_regclass('public.companies') is null
     or to_regclass('public.projects') is null
     or to_regclass('public.audit_events') is null
     or to_regprocedure('public.platform_set_company_status(uuid,boolean)') is null then
    raise exception 'COMPANY_PROJECT_STATUS_PREREQUISITES_MISSING';
  end if;
end;
$$;

create function app_private.disable_inactive_company_projects()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  with disabled_projects as (
    update public.projects
    set status = 'INACTIVE', updated_at = now()
    where company_id = new.id and status = 'ACTIVE'
    returning id, company_id
  )
  insert into public.audit_events (
    actor_user_id, company_id, project_id, entity_type, entity_id,
    action, old_values, new_values
  )
  select auth.uid(), project.company_id, project.id, 'project', project.id,
    'PROJECT_DISABLED_WITH_COMPANY',
    jsonb_build_object('status', 'ACTIVE'),
    jsonb_build_object('status', 'INACTIVE', 'reason', 'COMPANY_DISABLED')
  from disabled_projects project;

  return null;
end;
$$;

create function app_private.require_active_project_company()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_company_status public.company_status;
begin
  if new.status <> 'ACTIVE' then return new; end if;

  -- SHARE conflicts with the row lock held when changing Company status.
  -- An activation cannot slip past a concurrent Company deactivation.
  select company.status into v_company_status
  from public.companies company
  where company.id = new.company_id
  for share;

  if not found then raise exception 'COMPANY_NOT_FOUND'; end if;
  if v_company_status <> 'ACTIVE' then
    raise exception 'PROJECT_COMPANY_INACTIVE';
  end if;

  return new;
end;
$$;

alter function app_private.disable_inactive_company_projects() owner to postgres;
alter function app_private.require_active_project_company() owner to postgres;
revoke all on function app_private.disable_inactive_company_projects()
  from public, anon, authenticated, service_role;
revoke all on function app_private.require_active_project_company()
  from public, anon, authenticated, service_role;

create trigger companies_disable_active_projects
after update of status on public.companies
for each row when (new.status = 'INACTIVE')
execute function app_private.disable_inactive_company_projects();

create trigger projects_require_active_company
before insert or update of company_id, status on public.projects
for each row execute function app_private.require_active_project_company();

-- Repair existing inconsistencies, including Projects of Companies that were
-- disabled before the cascade existed. No historical/operational rows change.
with disabled_projects as (
  update public.projects project
  set status = 'INACTIVE', updated_at = now()
  from public.companies company
  where company.id = project.company_id
    and company.status = 'INACTIVE'
    and project.status = 'ACTIVE'
  returning project.id, project.company_id
)
insert into public.audit_events (
  actor_user_id, company_id, project_id, entity_type, entity_id,
  action, old_values, new_values
)
select auth.uid(), project.company_id, project.id, 'project', project.id,
  'PROJECT_DISABLED_WITH_COMPANY',
  jsonb_build_object('status', 'ACTIVE'),
  jsonb_build_object('status', 'INACTIVE', 'reason', 'COMPANY_STATUS_BACKFILL')
from disabled_projects project;

do $$
begin
  if exists (
    select 1 from public.projects project
    join public.companies company on company.id = project.company_id
    where project.status = 'ACTIVE' and company.status = 'INACTIVE'
  ) then
    raise exception 'COMPANY_PROJECT_STATUS_INVARIANT_FAILED';
  end if;
end;
$$;

commit;

-- Schema rollback (Project activation remains a separate administrative action):
-- drop trigger companies_disable_active_projects on public.companies;
-- drop trigger projects_require_active_company on public.projects;
-- drop function app_private.disable_inactive_company_projects();
-- drop function app_private.require_active_project_company();
