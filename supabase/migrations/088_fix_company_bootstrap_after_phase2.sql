-- 088_fix_company_bootstrap_after_phase2.sql
-- APPLIED SUCCESSFULLY — EXECUTED ON 2026-09-04.
--
-- Keep Company bootstrap defaults that remain part of the current product,
-- and remove the obsolete Dispatch Guide template hierarchy dropped in Phase 2.

begin;

do $$
begin
  if to_regprocedure('public.bootstrap_company_defaults(uuid)') is null
     or to_regprocedure('public.handle_company_defaults()') is null
     or to_regclass('public.companies') is null
     or to_regclass('public.suppliers') is null
     or to_regclass('public.incident_types') is null then
    raise exception 'COMPANY_BOOTSTRAP_REQUIRED_CONTRACT_MISSING';
  end if;

  if to_regclass('public.supplier_templates') is not null
     or to_regclass('public.supplier_template_versions') is not null
     or to_regclass('public.supplier_template_fields') is not null then
    raise exception 'COMPANY_BOOTSTRAP_LEGACY_TABLES_STILL_PRESENT';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_definition
    where trigger_definition.tgrelid = 'public.companies'::regclass
      and trigger_definition.tgname = 'on_company_created_defaults'
      and not trigger_definition.tgisinternal
  ) then
    raise exception 'COMPANY_BOOTSTRAP_TRIGGER_MISSING';
  end if;
end;
$$;

create or replace function public.bootstrap_company_defaults(
  p_company_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Current default supplier used by Programming, Dispatches and invoicing.
  insert into public.suppliers(
    company_id, code, name, is_preconfigured
  ) values (
    p_company_id, 'MIXTO_LISTO', 'Mixto Listo', true
  )
  on conflict(company_id, code) do update
  set active = true;

  -- Current incident catalog used while recording Dispatch outcomes.
  insert into public.incident_types(company_id, code, name)
  values
    (p_company_id, 'SUPPLIER_DELAY', 'Llegada tardía del proveedor'),
    (p_company_id, 'PROJECT_NOT_READY', 'Obra no preparada'),
    (p_company_id, 'EXCESSIVE_WAIT', 'Espera en obra'),
    (p_company_id, 'INCORRECT_QUANTITY', 'Cantidad incorrecta'),
    (p_company_id, 'PRODUCT_REJECTED', 'Producto rechazado'),
    (p_company_id, 'ACCESS_PROBLEM', 'Problema de acceso'),
    (p_company_id, 'PUMPING_PROBLEM', 'Problema de bombeo'),
    (p_company_id, 'WEATHER', 'Condición climática'),
    (p_company_id, 'OTHER', 'Otro')
  on conflict(company_id, code) do nothing;
end;
$$;

alter function public.bootstrap_company_defaults(uuid) owner to postgres;

do $$
declare
  v_definition text;
  v_legacy_routines text;
begin
  select lower(pg_get_functiondef(
    'public.bootstrap_company_defaults(uuid)'::regprocedure
  )) into v_definition;

  if position('public.suppliers' in v_definition) = 0
     or position('public.incident_types' in v_definition) = 0
     or v_definition ~ 'supplier_template(s|_versions|_fields)' then
    raise exception 'COMPANY_BOOTSTRAP_DEFINITION_NOT_ALIGNED';
  end if;

  select string_agg(
    format('%I.%I(%s)', namespace.nspname, procedure.proname,
      pg_get_function_identity_arguments(procedure.oid)),
    ', ' order by namespace.nspname, procedure.proname, procedure.oid
  )
  into v_legacy_routines
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('public', 'app_private')
    and procedure.prokind in ('f', 'p')
    and lower(pg_get_functiondef(procedure.oid)) ~
      'supplier_template(s|_versions|_fields)';

  if v_legacy_routines is not null then
    raise exception 'COMPANY_BOOTSTRAP_LEGACY_ROUTINES_REMAIN [%]',
      v_legacy_routines;
  end if;
end;
$$;

commit;

-- Live QA after execution:
--   * inserting a Company executes on_company_created_defaults successfully;
--   * MIXTO_LISTO and the current incident catalog are created;
--   * no active routine references supplier_templates, versions or fields.
