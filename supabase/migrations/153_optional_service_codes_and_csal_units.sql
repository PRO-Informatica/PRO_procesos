-- Service codes are optional. Doses and travel allowances have their own units.
begin;

insert into public.units_of_measure (code, name, active)
values ('DOSIS', 'Dosis', true), ('VIATICO', 'Viático', true)
on conflict (code) do update set active = true;

alter table public.project_service_prices
  alter column code drop not null,
  drop constraint project_service_prices_project_variant_key,
  drop constraint project_service_prices_unit_code_valid,
  add constraint project_service_prices_description_required_without_code
    check (code is not null or description is not null),
  add constraint project_service_prices_unit_code_valid check (
    unit_code is null or unit_code in ('KM', 'M', 'M2', 'M3', 'UN', 'SERVICIO', 'COMBO', 'RECARGO', 'DOSIS/M3', 'DOSIS', 'VIATICO')
  );

create unique index project_service_prices_project_variant_key
  on public.project_service_prices (project_id, code, observations, (case when code is null then description end))
  nulls not distinct;

alter table public.dispatch_guide_lines
  drop constraint dispatch_guide_lines_catalog_shape_ck,
  add constraint dispatch_guide_lines_catalog_shape_ck check (
    (catalog_type is null and product_price_id is null and service_price_id is null
      and catalog_reference is null and unit_price is null and currency is null)
    or (catalog_type = 'PRODUCT' and service_price_id is null and nullif(btrim(product_code), '') is not null
      and nullif(btrim(catalog_reference), '') is not null and unit_price is not null and unit_price >= 0 and currency = 'GTQ')
    or (catalog_type = 'SERVICE' and product_price_id is null and catalog_reference is null
      and (nullif(btrim(product_code), '') is not null or nullif(btrim(product_description), '') is not null)
      and unit_price is not null and unit_price >= 0 and currency = 'GTQ')
    or (catalog_type in ('PRODUCT', 'SERVICE') and product_price_id is null and service_price_id is null
      and nullif(btrim(product_code), '') is not null and unit_price is null and currency is null and catalog_reference is null)
  );

create or replace function app_private.normalize_service_catalog_unit(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when normalized_unit in ('UNIDAD', 'U', 'UNITARIO') then 'UN'
    when normalized_unit = 'VIÁTICO' then 'VIATICO'
    when normalized_unit in ('KM', 'M', 'M2', 'M3', 'UN', 'SERVICIO', 'COMBO', 'RECARGO', 'DOSIS/M3', 'DOSIS', 'VIATICO')
      then normalized_unit
    else null
  end
  from (
    select upper(regexp_replace(
      regexp_replace(normalize(coalesce(p_value, ''), NFKC),
        '^[[:space:]]+|[[:space:]]+$', '', 'g'),
      '[[:space:]]*/[[:space:]]*', '/', 'g'
    )) as normalized_unit
  ) normalized;
$$;

-- Preserve the current resolver's rules, including historical guide snapshots.
do $migration$
declare
  definition text := pg_get_functiondef('app_private.resolve_dispatch_guide_lines(uuid,text,jsonb,uuid)'::regprocedure);
  allowed_units constant text := $$('KM','M','M2','M3','UN','SERVICIO','COMBO','RECARGO','DOSIS/M3')$$;
  historical_service constant text := $$'product_code', v_existing.product_code,
          'product_description', v_description,$$;
begin
  if position(allowed_units in definition) = 0 or position(historical_service in definition) = 0 then
    raise exception 'UNEXPECTED_DISPATCH_CATALOG_RESOLVER';
  end if;
  definition := replace(definition, allowed_units, $$('KM','M','M2','M3','UN','SERVICIO','COMBO','RECARGO','DOSIS/M3','DOSIS','VIATICO')$$);
  definition := replace(definition, historical_service,
    $$'product_code', v_existing.product_code,
          'product_description', case when v_existing.product_code is null then coalesce(v_description, v_existing.product_description) else v_description end,$$);
  execute definition;
end;
$migration$;

create or replace function public.platform_import_project_price_catalog(
  p_company_id uuid,
  p_project_id uuid,
  p_catalog_type text,
  p_mode text,
  p_file_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_catalog_type text := upper(btrim(coalesce(p_catalog_type, '')));
  v_mode text := upper(btrim(coalesce(p_mode, '')));
  v_file_name text := btrim(coalesce(p_file_name, ''));
  v_rows jsonb;
  v_row_count integer;
  v_updated_count integer := 0;
  v_inserted_count integer := 0;
  v_total_count integer := 0;
  v_action text;
begin
  if v_actor is null or not app_private.is_platform_admin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  perform 1
  from public.projects
  where id = p_project_id and company_id = p_company_id
  for update;
  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_catalog_type not in ('PRODUCT', 'SERVICE') then
    raise exception 'CATALOG_TYPE_INVALID';
  end if;
  if v_mode not in ('REPLACE', 'UPDATE') then
    raise exception 'IMPORT_MODE_INVALID';
  end if;
  if char_length(v_file_name) not between 1 and 255
     or v_file_name ~ '[[:cntrl:]/\\]' then
    raise exception 'FILE_NAME_INVALID';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) not between 1 and 10000 then
    raise exception 'CATALOG_ROWS_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where jsonb_typeof(item) is distinct from 'object'
  ) then
    raise exception 'CATALOG_ROWS_INVALID';
  end if;

  if v_catalog_type = 'PRODUCT' then
    if exists (
      select 1
      from jsonb_array_elements(p_rows) item
      where jsonb_typeof(item->'code') is distinct from 'string'
         or jsonb_typeof(item->'reference') is distinct from 'string'
         or jsonb_typeof(item->'price') is distinct from 'string'
         or char_length(btrim(item->>'code')) not between 1 and 120
         or char_length(btrim(item->>'reference')) not between 1 and 160
         or (item ? 'resistance_psi' and jsonb_typeof(item->'resistance_psi') <> 'null' and (
           jsonb_typeof(item->'resistance_psi') not in ('string', 'number')
           or item->>'resistance_psi' !~ '^[1-9][0-9]{0,4}$'
         ))
         or (item ? 'slump' and jsonb_typeof(item->'slump') <> 'null' and (
           jsonb_typeof(item->'slump') <> 'string' or char_length(btrim(item->>'slump')) > 120
           or item->>'slump' ~ '[[:cntrl:]]'
         ))
         or btrim(item->>'code') ~ '[[:cntrl:]]'
         or btrim(item->>'reference') ~ '[[:cntrl:]]'
         or btrim(item->>'price') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$'
    ) then
      raise exception 'CATALOG_ROWS_INVALID';
    end if;

    select jsonb_agg(jsonb_build_object(
      'code', btrim(item->>'code'),
      'reference', btrim(item->>'reference'),
      'resistance_psi', case when item ? 'resistance_psi' then item->'resistance_psi'
        when v_mode = 'UPDATE' then to_jsonb(existing.resistance_psi) else 'null'::jsonb end,
      'slump', case when item ? 'slump' then to_jsonb(nullif(btrim(item->>'slump'), ''))
        when v_mode = 'UPDATE' then to_jsonb(existing.slump) else 'null'::jsonb end,
      'price', btrim(item->>'price')
    ))
    into v_rows
    from jsonb_array_elements(p_rows) item
    left join public.project_product_prices existing on existing.project_id = p_project_id
      and existing.code = btrim(item->>'code') and existing.reference = btrim(item->>'reference');

    if exists (
      select 1
      from jsonb_to_recordset(v_rows) as row_data(code text, reference text, price text)
      group by row_data.code, row_data.reference
      having count(*) > 1
    ) then
      raise exception 'CATALOG_DUPLICATE_KEYS';
    end if;

    select count(*)::integer into v_row_count
    from jsonb_to_recordset(v_rows) as row_data(code text, reference text, price text);

    if v_mode = 'REPLACE' then
      delete from public.project_product_prices where project_id = p_project_id;
      v_inserted_count := v_row_count;
    else
      select count(*)::integer into v_updated_count
      from jsonb_to_recordset(v_rows) as row_data(code text, reference text, price text)
      join public.project_product_prices existing
        on existing.project_id = p_project_id
       and existing.code = row_data.code
       and existing.reference = row_data.reference;
      v_inserted_count := v_row_count - v_updated_count;
    end if;

    insert into public.project_product_prices(project_id, code, reference, price, resistance_psi, slump)
    select p_project_id, row_data.code, row_data.reference, row_data.price::numeric(18,4), row_data.resistance_psi, row_data.slump
    from jsonb_to_recordset(v_rows) as row_data(code text, reference text, price text, resistance_psi integer, slump text)
    on conflict (project_id, code, reference)
    do update set price = excluded.price, resistance_psi = excluded.resistance_psi, slump = excluded.slump;

    select count(*)::integer into v_total_count
    from public.project_product_prices where project_id = p_project_id;
    v_action := 'PROJECT_PRODUCT_PRICE_CATALOG_' ||
      case when v_mode = 'REPLACE' then 'REPLACED' else 'UPDATED' end;
  else
    if exists (
      select 1
      from jsonb_array_elements(p_rows) item
      where (item ? 'code' and jsonb_typeof(item->'code') not in ('string', 'null'))
         or jsonb_typeof(item->'price') is distinct from 'string'
         or jsonb_typeof(item->'description') is distinct from 'string'
         or (
           item ? 'unit_code'
           and jsonb_typeof(item->'unit_code') not in ('string', 'null')
         )
         or (item ? 'observations' and jsonb_typeof(item->'observations') not in ('string', 'null'))
         or char_length(nullif(btrim(coalesce(item->>'observations', ''), chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)), '')) > 500
         or nullif(btrim(coalesce(item->>'observations', ''), chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)), '') ~ '[[:cntrl:]]'
         or char_length(btrim(item->>'description')) not between 1 and 500
         or btrim(item->>'description') ~ '[[:cntrl:]]'
         or (
           normalize(coalesce(item->>'unit_code', ''), NFKC) !~ '^[[:space:]]*$'
           and app_private.normalize_service_catalog_unit(item->>'unit_code') is null
         )
         or char_length(btrim(item->>'code')) > 120
         or btrim(item->>'code') ~ '[[:cntrl:]]'
         or btrim(item->>'price') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$'
    ) then
      raise exception 'CATALOG_ROWS_INVALID';
    end if;

    select jsonb_agg(jsonb_build_object(
      'code', nullif(btrim(item->>'code'), ''),
      'description', btrim(item->>'description'),
      'observations', nullif(btrim(coalesce(item->>'observations', ''), chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)), ''),
      'unit_code', app_private.normalize_service_catalog_unit(item->>'unit_code'),
      'price', btrim(item->>'price')
    ))
    into v_rows
    from jsonb_array_elements(p_rows) item;

    if exists (
      select 1
      from jsonb_to_recordset(v_rows) as row_data(code text, description text, unit_code text, observations text, price text)
      group by row_data.code, row_data.observations,
               case when row_data.code is null then row_data.description end
      having count(*) > 1
    ) then
      raise exception 'CATALOG_DUPLICATE_KEYS';
    end if;

    select count(*)::integer into v_row_count
    from jsonb_to_recordset(v_rows) as row_data(code text, price text);

    if v_mode = 'REPLACE' then
      delete from public.project_service_prices where project_id = p_project_id;
      v_inserted_count := v_row_count;
    else
      select count(*)::integer into v_updated_count
      from jsonb_to_recordset(v_rows) as row_data(code text, description text, unit_code text, observations text, price text)
      join public.project_service_prices existing
        on existing.project_id = p_project_id
       and existing.code is not distinct from row_data.code
       and existing.observations is not distinct from row_data.observations
       and (row_data.code is not null or existing.description = row_data.description);
      v_inserted_count := v_row_count - v_updated_count;
    end if;

    insert into public.project_service_prices(project_id, code, description, unit_code, observations, price)
    select p_project_id, row_data.code, row_data.description, row_data.unit_code, row_data.observations, row_data.price::numeric(18,4)
    from jsonb_to_recordset(v_rows) as row_data(code text, description text, unit_code text, observations text, price text)
    on conflict (project_id, code, observations, (case when code is null then description end))
    do update set price = excluded.price, description = excluded.description, unit_code = excluded.unit_code;

    select count(*)::integer into v_total_count
    from public.project_service_prices where project_id = p_project_id;
    v_action := 'PROJECT_SERVICE_PRICE_CATALOG_' ||
      case when v_mode = 'REPLACE' then 'REPLACED' else 'UPDATED' end;
  end if;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, p_company_id, p_project_id, 'project_price_catalog',
    p_project_id, v_action,
    jsonb_build_object(
      'catalog_type', v_catalog_type,
      'mode', v_mode,
      'file_name', v_file_name,
      'received_count', v_row_count,
      'inserted_count', v_inserted_count,
      'updated_count', v_updated_count,
      'total_count', v_total_count
    )
  );

  return jsonb_build_object(
    'inserted_count', v_inserted_count,
    'updated_count', v_updated_count,
    'total_count', v_total_count
  );
end;
$$;

commit;
