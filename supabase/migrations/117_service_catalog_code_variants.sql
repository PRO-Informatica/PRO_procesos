-- Service codes may repeat; observations distinguish their commercial variants.
-- Description, UM and price remain updatable. Blank observations compare equal.
-- Observations are picker metadata only and are never copied to a dispatch guide.
-- No existing catalog rows, IDs, prices or historical guide snapshots are changed.
begin;

alter table public.project_service_prices
  add column observations text,
  add constraint project_service_prices_observations_check check (
    observations is null or (
      char_length(observations) between 1 and 500
      and observations = btrim(observations, chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))
      and observations !~ '[[:cntrl:]]'
    )
  ),
  drop constraint project_service_prices_project_code_key,
  add constraint project_service_prices_project_variant_key
    unique nulls not distinct (project_id, code, observations);

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
         or char_length(btrim(item->>'code')) not between 1 and 120
         or btrim(item->>'code') ~ '[[:cntrl:]]'
         or btrim(item->>'price') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$'
    ) then
      raise exception 'CATALOG_ROWS_INVALID';
    end if;

    select jsonb_agg(jsonb_build_object(
      'code', btrim(item->>'code'),
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
      group by row_data.code, row_data.observations
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
       and existing.code = row_data.code
       and existing.observations is not distinct from row_data.observations;
      v_inserted_count := v_row_count - v_updated_count;
    end if;

    insert into public.project_service_prices(project_id, code, description, unit_code, observations, price)
    select p_project_id, row_data.code, row_data.description, row_data.unit_code, row_data.observations, row_data.price::numeric(18,4)
    from jsonb_to_recordset(v_rows) as row_data(code text, description text, unit_code text, observations text, price text)
    on conflict on constraint project_service_prices_project_variant_key
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
      'observations', item.observations,
      'unit_code', item.unit_code,
      'price', item.price
    ) order by item.code, item.observations, item.id), '[]'::jsonb)
    into v_items
    from (
      select service.id, service.code, service.description, service.unit_code, service.observations, service.price
      from public.project_service_prices service
      where service.project_id = p_project_id
        and (v_query = '' or service.code ilike '%' || v_query || '%'
          or service.description ilike '%' || v_query || '%'
          or service.observations ilike '%' || v_query || '%')
      order by service.code, service.observations, service.id
      limit v_limit
    ) item;
  end if;

  return jsonb_build_object('items', v_items);
end;
$$;

-- CREATE OR REPLACE preserves owners, privileges and all product validation.
notify pgrst, 'reload schema';
commit;
