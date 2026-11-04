-- Service-only catalog metadata; no historical guide rows or product catalogs are changed.
begin;

do $$
begin
  if to_regprocedure('app_private.resolve_dispatch_guide_lines(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('public.platform_import_project_price_catalog(uuid,uuid,text,text,text,jsonb)') is null then
    raise exception 'SERVICE_CATALOG_PREREQUISITES_MISSING';
  end if;
end;
$$;

-- These are commercial service units, not conversions to physical product volume.
insert into public.units_of_measure(code, name, active)
values ('SERVICIO', 'Servicio', true), ('COMBO', 'Combo', true), ('RECARGO', 'Recargo', true)
on conflict (code) do nothing;

alter table public.project_service_prices
  add column description text,
  add column unit_code text references public.units_of_measure(code) on delete restrict,
  add constraint project_service_prices_description_valid check (
    description is null or (
      description = btrim(description) and char_length(description) between 1 and 500
      and description !~ '[[:cntrl:]]'
    )
  ),
  add constraint project_service_prices_unit_code_valid check (
    unit_code is null or unit_code in ('KM', 'M3', 'UN', 'SERVICIO', 'COMBO', 'RECARGO')
  );

comment on column public.project_service_prices.description is
  'Service description. NULL for legacy catalog rows until explicitly updated by an administrator.';
comment on column public.project_service_prices.unit_code is
  'Commercial pricing unit. Copied to new guide lines, never inferred or converted.';

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
         or btrim(item->>'code') ~ '[[:cntrl:]]'
         or btrim(item->>'reference') ~ '[[:cntrl:]]'
         or btrim(item->>'price') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$'
    ) then
      raise exception 'CATALOG_ROWS_INVALID';
    end if;

    select jsonb_agg(jsonb_build_object(
      'code', btrim(item->>'code'),
      'reference', btrim(item->>'reference'),
      'price', btrim(item->>'price')
    ))
    into v_rows
    from jsonb_array_elements(p_rows) item;

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

    insert into public.project_product_prices(project_id, code, reference, price)
    select p_project_id, row_data.code, row_data.reference, row_data.price::numeric(18,4)
    from jsonb_to_recordset(v_rows) as row_data(code text, reference text, price text)
    on conflict (project_id, code, reference)
    do update set price = excluded.price;

    select count(*)::integer into v_total_count
    from public.project_product_prices where project_id = p_project_id;
    v_action := 'PROJECT_PRODUCT_PRICE_CATALOG_' ||
      case when v_mode = 'REPLACE' then 'REPLACED' else 'UPDATED' end;
  else
    if exists (
      select 1
      from jsonb_array_elements(p_rows) item
      where jsonb_typeof(item->'code') is distinct from 'string'
         or jsonb_typeof(item->'price') is distinct from 'string'
         or jsonb_typeof(item->'description') is distinct from 'string'
         or jsonb_typeof(item->'unit_code') is distinct from 'string'
         or char_length(btrim(item->>'description')) not between 1 and 500
         or btrim(item->>'description') ~ '[[:cntrl:]]'
         or upper(btrim(item->>'unit_code')) not in ('KM', 'M3', 'UN', 'SERVICIO', 'COMBO', 'RECARGO')
         or char_length(btrim(item->>'code')) not between 1 and 120
         or btrim(item->>'code') ~ '[[:cntrl:]]'
         or btrim(item->>'price') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$'
    ) then
      raise exception 'CATALOG_ROWS_INVALID';
    end if;

    select jsonb_agg(jsonb_build_object(
      'code', btrim(item->>'code'),
      'description', btrim(item->>'description'),
      'unit_code', upper(btrim(item->>'unit_code')),
      'price', btrim(item->>'price')
    ))
    into v_rows
    from jsonb_array_elements(p_rows) item;

    if exists (
      select 1
      from jsonb_to_recordset(v_rows) as row_data(code text, price text)
      group by row_data.code
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
      from jsonb_to_recordset(v_rows) as row_data(code text, price text)
      join public.project_service_prices existing
        on existing.project_id = p_project_id
       and existing.code = row_data.code;
      v_inserted_count := v_row_count - v_updated_count;
    end if;

    insert into public.project_service_prices(project_id, code, description, unit_code, price)
    select p_project_id, row_data.code, row_data.description, row_data.unit_code, row_data.price::numeric(18,4)
    from jsonb_to_recordset(v_rows) as row_data(code text, description text, unit_code text, price text)
    on conflict (project_id, code)
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


create or replace function public.search_project_dispatch_catalog(
  p_project_id uuid,
  p_catalog_type text,
  p_query text default '',
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_type text := upper(btrim(coalesce(p_catalog_type, '')));
  v_query text := btrim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_items jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app_private.has_project_permission(p_project_id, 'dispatch.view') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_type not in ('PRODUCT', 'SERVICE') or char_length(v_query) > 120 then
    raise exception 'DISPATCH_CATALOG_SEARCH_INVALID';
  end if;

  if v_type = 'PRODUCT' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id,
      'type', 'PRODUCT',
      'code', item.code,
      'reference', item.reference,
      'price', item.price
    ) order by item.code, item.reference), '[]'::jsonb)
    into v_items
    from (
      select product.id, product.code, product.reference, product.price
      from public.project_product_prices product
      where product.project_id = p_project_id
        and (
          v_query = ''
          or product.code ilike '%' || v_query || '%'
          or product.reference ilike '%' || v_query || '%'
        )
      order by product.code, product.reference
      limit v_limit
    ) item;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id,
      'type', 'SERVICE',
      'code', item.code,
      'reference', null,
      'description', item.description,
      'unit_code', item.unit_code,
      'price', item.price
    ) order by item.code), '[]'::jsonb)
    into v_items
    from (
      select service.id, service.code, service.description, service.unit_code, service.price
      from public.project_service_prices service
      where service.project_id = p_project_id
        and (v_query = '' or service.code ilike '%' || v_query || '%'
          or service.description ilike '%' || v_query || '%')
      order by service.code
      limit v_limit
    ) item;
  end if;

  return jsonb_build_object('items', v_items);
end;
$$;


create or replace function app_private.resolve_dispatch_guide_lines(
  p_project_id uuid,
  p_programming_unit text,
  p_lines jsonb,
  p_existing_guide_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_item jsonb;
  v_resolved jsonb := '[]'::jsonb;
  v_quantity numeric(12,3);
  v_unit text;
  v_type text;
  v_catalog_id uuid;
  v_line_id uuid;
  v_description text;
  v_product public.project_product_prices%rowtype;
  v_service public.project_service_prices%rowtype;
  v_existing public.dispatch_guide_lines%rowtype;
  v_has_operational_product boolean := false;
begin
  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0
     or jsonb_array_length(p_lines) > 100 then
    raise exception 'DISPATCH_GUIDE_LINES_REQUIRED';
  end if;

  for v_item in
    select item.value from jsonb_array_elements(p_lines) item(value)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'quantity') <> 'number' then
      raise exception 'DISPATCH_GUIDE_LINE_INVALID';
    end if;

    begin
      v_quantity := (v_item ->> 'quantity')::numeric(12,3);
    exception when others then
      raise exception 'DISPATCH_GUIDE_LINE_INVALID';
    end;
    if v_quantity <= 0 then
      raise exception 'DISPATCH_GUIDE_LINE_INVALID';
    end if;

    v_unit := upper(btrim(coalesce(v_item ->> 'unit_code', '')));
    if v_unit not in ('KM', 'M3', 'UN', 'SERVICIO', 'COMBO', 'RECARGO')
       or not exists (
         select 1 from public.units_of_measure unit
         where unit.code = v_unit and unit.active
       ) then
      raise exception 'INVALID_OR_INACTIVE_UNIT_OF_MEASURE';
    end if;

    v_type := upper(btrim(coalesce(v_item ->> 'catalog_type', '')));
    if v_type <> 'SERVICE' and v_unit not in ('KM', 'M3', 'UN') then
      raise exception 'INVALID_OR_INACTIVE_UNIT_OF_MEASURE';
    end if;
    v_line_id := null;
    if nullif(btrim(coalesce(v_item ->> 'line_id', '')), '') is not null then
      begin
        v_line_id := (v_item ->> 'line_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'DISPATCH_GUIDE_LINE_INVALID';
      end;
    end if;

    v_existing := null;
    if p_existing_guide_id is not null and v_line_id is not null then
      select line.* into v_existing
      from public.dispatch_guide_lines line
      where line.id = v_line_id and line.guide_id = p_existing_guide_id;
    end if;

    if v_type = '' then
      if v_existing.id is null or v_existing.catalog_type is not null then
        raise exception 'DISPATCH_CATALOG_SELECTION_REQUIRED';
      end if;
      if v_unit is distinct from p_programming_unit then
        raise exception 'DISPATCH_PROGRAMMING_UNIT_MISMATCH';
      end if;
      v_has_operational_product := true;
      v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
        'quantity', v_quantity,
        'unit_code', v_unit,
        'catalog_type', null,
        'product_price_id', null,
        'service_price_id', null,
        'product_code', v_existing.product_code,
        'product_description', v_existing.product_description,
        'catalog_reference', null,
        'unit_price', null,
        'currency', null
      ));
      continue;
    end if;

    if v_type not in ('PRODUCT', 'SERVICE') then
      raise exception 'DISPATCH_CATALOG_TYPE_INVALID';
    end if;

    v_catalog_id := null;
    if nullif(btrim(coalesce(v_item ->> 'catalog_item_id', '')), '') is not null then
      begin
        v_catalog_id := (v_item ->> 'catalog_item_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'DISPATCH_CATALOG_SELECTION_INVALID';
      end;
    end if;

    if v_type = 'PRODUCT' then
      if v_unit is distinct from p_programming_unit then
        raise exception 'DISPATCH_PROGRAMMING_UNIT_MISMATCH';
      end if;
      v_has_operational_product := true;

      if v_existing.id is not null
         and v_existing.catalog_type = 'PRODUCT'
         and (
           v_existing.product_price_id = v_catalog_id
           or (v_existing.product_price_id is null and v_catalog_id is null)
         ) then
        v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
          'quantity', v_quantity,
          'unit_code', v_unit,
          'catalog_type', 'PRODUCT',
          'product_price_id', v_existing.product_price_id,
          'service_price_id', null,
          'product_code', v_existing.product_code,
          'product_description', v_existing.catalog_reference,
          'catalog_reference', v_existing.catalog_reference,
          'unit_price', v_existing.unit_price,
          'currency', v_existing.currency
        ));
        continue;
      end if;

      if v_catalog_id is null then
        raise exception 'DISPATCH_CATALOG_SELECTION_REQUIRED';
      end if;
      select product.* into v_product
      from public.project_product_prices product
      where product.id = v_catalog_id and product.project_id = p_project_id;
      if not found then raise exception 'DISPATCH_CATALOG_ITEM_NOT_FOUND'; end if;

      v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
        'quantity', v_quantity,
        'unit_code', v_unit,
        'catalog_type', 'PRODUCT',
        'product_price_id', v_product.id,
        'service_price_id', null,
        'product_code', v_product.code,
        'product_description', v_product.reference,
        'catalog_reference', v_product.reference,
        'unit_price', v_product.price,
        'currency', 'GTQ'
      ));
    else
      v_description := nullif(btrim(coalesce(v_item ->> 'product_description', '')), '');
      if v_description is not null and char_length(v_description) > 500 then
        raise exception 'DISPATCH_GUIDE_LINE_INVALID';
      end if;

      if v_existing.id is not null
         and v_existing.catalog_type = 'SERVICE'
         and (
           v_existing.service_price_id = v_catalog_id
           or (v_existing.service_price_id is null and v_catalog_id is null)
         ) then
        v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
          'quantity', v_quantity,
          'unit_code', v_unit,
          'catalog_type', 'SERVICE',
          'product_price_id', null,
          'service_price_id', v_existing.service_price_id,
          'product_code', v_existing.product_code,
          'product_description', v_description,
          'catalog_reference', null,
          'unit_price', v_existing.unit_price,
          'currency', v_existing.currency
        ));
        continue;
      end if;

      if v_catalog_id is null then
        raise exception 'DISPATCH_CATALOG_SELECTION_REQUIRED';
      end if;
      select service.* into v_service
      from public.project_service_prices service
      where service.id = v_catalog_id and service.project_id = p_project_id;
      if not found then raise exception 'DISPATCH_CATALOG_ITEM_NOT_FOUND'; end if;
      -- Existing lines above retain their historical price and metadata.
      -- New selections must use the service's commercial unit, without conversions.
      if v_service.unit_code is not null and v_unit is distinct from v_service.unit_code then
        raise exception 'DISPATCH_SERVICE_UNIT_MISMATCH';
      end if;
      v_description := coalesce(v_description, v_service.description);

      v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
        'quantity', v_quantity,
        'unit_code', v_unit,
        'catalog_type', 'SERVICE',
        'product_price_id', null,
        'service_price_id', v_service.id,
        'product_code', v_service.code,
        'product_description', v_description,
        'catalog_reference', null,
        'unit_price', v_service.price,
        'currency', 'GTQ'
      ));
    end if;
  end loop;

  if not v_has_operational_product then
    raise exception 'DISPATCH_GUIDE_OPERATIONAL_PRODUCT_REQUIRED';
  end if;
  return v_resolved;
end;
$$;


-- CREATE OR REPLACE preserves existing ownership, RLS and EXECUTE restrictions.
notify pgrst, 'reload schema';
commit;
