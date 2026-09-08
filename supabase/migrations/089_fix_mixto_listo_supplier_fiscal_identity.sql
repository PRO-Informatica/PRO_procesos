-- 089_fix_mixto_listo_supplier_fiscal_identity.sql
-- Align the preconfigured Mixto Listo supplier with the legal issuer identity
-- printed on its invoices. Validation can then use the issuer NIT even though
-- the commercial name "Mixto Listo" differs from "MEZCLADORA, S.A.".

begin;

do $$
begin
  if to_regclass('public.suppliers') is null
     or to_regprocedure('public.bootstrap_company_defaults(uuid)') is null then
    raise exception 'MIXTO_LISTO_FISCAL_IDENTITY_REQUIRED_CONTRACT_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns column_definition
    where column_definition.table_schema = 'public'
      and column_definition.table_name = 'suppliers'
      and column_definition.column_name = 'tax_id'
  ) then
    raise exception 'SUPPLIER_TAX_ID_COLUMN_MISSING';
  end if;
end;
$$;

update public.suppliers
set name = 'MEZCLADORA, S.A.',
    tax_id = '32709-3'
where code = 'MIXTO_LISTO'
  and is_preconfigured = true
  and (
    name is distinct from 'MEZCLADORA, S.A.'
    or tax_id is distinct from '32709-3'
  );

create or replace function public.bootstrap_company_defaults(
  p_company_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.suppliers(
    company_id, code, name, tax_id, is_preconfigured
  ) values (
    p_company_id, 'MIXTO_LISTO', 'MEZCLADORA, S.A.', '32709-3', true
  )
  on conflict(company_id, code) do update
  set name = excluded.name,
      tax_id = excluded.tax_id,
      is_preconfigured = true,
      active = true;

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
begin
  select pg_get_functiondef(
    'public.bootstrap_company_defaults(uuid)'::regprocedure
  ) into v_definition;

  if position('MEZCLADORA, S.A.' in v_definition) = 0
     or position('32709-3' in v_definition) = 0 then
    raise exception 'MIXTO_LISTO_BOOTSTRAP_IDENTITY_NOT_ALIGNED';
  end if;

  if exists (
    select 1
    from public.suppliers supplier
    where supplier.code = 'MIXTO_LISTO'
      and supplier.is_preconfigured = true
      and (
        supplier.name is distinct from 'MEZCLADORA, S.A.'
        or supplier.tax_id is distinct from '32709-3'
      )
  ) then
    raise exception 'MIXTO_LISTO_EXISTING_IDENTITY_NOT_ALIGNED';
  end if;
end;
$$;

commit;
