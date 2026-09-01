-- 069_platform_project_supplier_management.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Adds the platform-admin authority for assigning any number of active company
-- suppliers to each project. Historical relations are preserved by toggling
-- active instead of deleting rows.

begin;

do $$
begin
  if to_regclass('public.companies') is null
     or to_regclass('public.projects') is null
     or to_regclass('public.suppliers') is null
     or to_regclass('public.project_suppliers') is null
     or to_regclass('public.audit_events') is null
     or to_regprocedure('app_private.is_platform_admin()') is null then
    raise exception 'PLATFORM_PROJECT_SUPPLIER_REQUIRED_CONTRACT_MISSING';
  end if;

  if to_regprocedure(
       'public.platform_set_project_suppliers(uuid,uuid,uuid[])'
     ) is not null then
    raise exception 'PLATFORM_PROJECT_SUPPLIER_RPC_ALREADY_EXISTS';
  end if;

  if exists (
    select 1
    from (
      values
        ('project_suppliers', 'company_id'),
        ('project_suppliers', 'project_id'),
        ('project_suppliers', 'supplier_id'),
        ('project_suppliers', 'active'),
        ('project_suppliers', 'is_default'),
        ('suppliers', 'company_id'),
        ('suppliers', 'active')
    ) required(table_name, column_name)
    where not exists (
      select 1
      from information_schema.columns column_definition
      where column_definition.table_schema = 'public'
        and column_definition.table_name = required.table_name
        and column_definition.column_name = required.column_name
    )
  ) then
    raise exception 'PLATFORM_PROJECT_SUPPLIER_COLUMN_MISSING';
  end if;
end;
$$;

create function public.platform_set_project_suppliers(
  p_company_id uuid,
  p_project_id uuid,
  p_supplier_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_supplier_ids uuid[];
  v_old_supplier_ids uuid[];
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app_private.is_platform_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  if not exists (
    select 1
    from public.companies company
    join public.projects project on project.company_id = company.id
    where company.id = p_company_id
      and project.id = p_project_id
    for update of project
  ) then
    raise exception 'PROJECT_COMPANY_MISMATCH';
  end if;

  select coalesce(
    array_agg(distinct requested.supplier_id order by requested.supplier_id),
    '{}'::uuid[]
  )
  into v_supplier_ids
  from unnest(coalesce(p_supplier_ids, '{}'::uuid[]))
       requested(supplier_id)
  where requested.supplier_id is not null;

  if exists (
    select 1
    from unnest(v_supplier_ids) requested(supplier_id)
    where not exists (
      select 1
      from public.suppliers supplier
      where supplier.id = requested.supplier_id
        and supplier.company_id = p_company_id
        and supplier.active = true
    )
  ) then
    raise exception 'PROJECT_SUPPLIER_INVALID';
  end if;

  select coalesce(
    array_agg(relation.supplier_id order by relation.supplier_id),
    '{}'::uuid[]
  )
  into v_old_supplier_ids
  from public.project_suppliers relation
  where relation.company_id = p_company_id
    and relation.project_id = p_project_id
    and relation.active = true;

  update public.project_suppliers relation
  set active = false,
      is_default = false
  where relation.company_id = p_company_id
    and relation.project_id = p_project_id
    and relation.active = true
    and not (relation.supplier_id = any(v_supplier_ids));

  insert into public.project_suppliers(
    company_id, project_id, supplier_id, active, is_default
  )
  select p_company_id, p_project_id, requested.supplier_id, true, false
  from unnest(v_supplier_ids) requested(supplier_id)
  on conflict (project_id, supplier_id)
  do update set active = true;

  if v_old_supplier_ids is distinct from v_supplier_ids then
    insert into public.audit_events(
      actor_user_id, company_id, project_id, entity_type,
      entity_id, action, old_values, new_values
    ) values (
      v_actor,
      p_company_id,
      p_project_id,
      'project',
      p_project_id,
      'PROJECT_SUPPLIERS_UPDATED',
      jsonb_build_object('supplier_ids', to_jsonb(v_old_supplier_ids)),
      jsonb_build_object('supplier_ids', to_jsonb(v_supplier_ids))
    );
  end if;

  return cardinality(v_supplier_ids);
end;
$$;

alter function public.platform_set_project_suppliers(uuid,uuid,uuid[])
owner to postgres;

revoke all on function public.platform_set_project_suppliers(uuid,uuid,uuid[])
from public, anon;

grant execute on function public.platform_set_project_suppliers(uuid,uuid,uuid[])
to authenticated, service_role;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.platform_set_project_suppliers(uuid,uuid,uuid[])'::regprocedure
  ) into v_definition;

  if position('app_private.is_platform_admin()' in v_definition) = 0
     or position('PROJECT_COMPANY_MISMATCH' in v_definition) = 0
     or position('PROJECT_SUPPLIER_INVALID' in v_definition) = 0
     or position('PROJECT_SUPPLIERS_UPDATED' in v_definition) = 0
     or has_function_privilege(
       'anon',
       'public.platform_set_project_suppliers(uuid,uuid,uuid[])',
       'EXECUTE'
     ) then
    raise exception 'PLATFORM_PROJECT_SUPPLIER_SECURITY_NOT_ALIGNED';
  end if;
end;
$$;

commit;
