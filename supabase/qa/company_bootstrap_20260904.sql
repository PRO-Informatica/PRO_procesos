-- Transactional smoke test for 088_fix_company_bootstrap_after_phase2.sql.
-- It exercises the real Company INSERT trigger and leaves no test data behind.

begin;

do $$
declare
  v_company_id uuid := gen_random_uuid();
  v_company_code text := '__BOOTSTRAP_QA_' ||
    substring(replace(v_company_id::text, '-', '') from 1 for 20);
  v_legacy_routines text;
begin
  insert into public.companies(id, name, code, status)
  values (v_company_id, 'Company Bootstrap QA', v_company_code, 'ACTIVE');

  if not exists (
    select 1
    from public.suppliers supplier
    where supplier.company_id = v_company_id
      and supplier.code = 'MIXTO_LISTO'
      and supplier.name = 'Mixto Listo'
      and supplier.is_preconfigured
      and supplier.active
  ) then
    raise exception 'COMPANY_BOOTSTRAP_QA_SUPPLIER_MISSING';
  end if;

  if (
    select count(*)
    from public.incident_types incident_type
    where incident_type.company_id = v_company_id
      and incident_type.code = any(array[
        'SUPPLIER_DELAY', 'PROJECT_NOT_READY', 'EXCESSIVE_WAIT',
        'INCORRECT_QUANTITY', 'PRODUCT_REJECTED', 'ACCESS_PROBLEM',
        'PUMPING_PROBLEM', 'WEATHER', 'OTHER'
      ])
  ) <> 9 then
    raise exception 'COMPANY_BOOTSTRAP_QA_INCIDENT_TYPES_INCOMPLETE';
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
    raise exception 'COMPANY_BOOTSTRAP_QA_LEGACY_ROUTINES_REMAIN [%]',
      v_legacy_routines;
  end if;
end;
$$;

rollback;
