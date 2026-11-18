-- Optional quotation metadata. Existing products remain NULL; guide prices are untouched.
begin;
alter table public.project_product_prices
  add column resistance_psi integer check (resistance_psi between 1 and 99999),
  add column slump text check (slump is null or (char_length(slump) between 1 and 120 and slump = btrim(slump) and slump !~ '[[:cntrl:]]'));

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


create or replace function public.platform_update_product_specifications(
  p_company_id uuid, p_project_id uuid, p_product_id uuid,
  p_resistance_psi integer, p_slump text, p_expected_updated_at timestamptz
) returns void language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_before public.project_product_prices%rowtype;
  v_slump text := nullif(btrim(p_slump), '');
begin
  if auth.uid() is null or not app_private.is_platform_admin() then raise exception 'PERMISSION_DENIED'; end if;
  perform 1 from public.projects where id = p_project_id and company_id = p_company_id for update;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
  if p_resistance_psi is not null and p_resistance_psi not between 1 and 99999 then raise exception 'PRODUCT_SPECIFICATIONS_INVALID'; end if;
  if v_slump is not null and (char_length(v_slump) > 120 or v_slump ~ '[[:cntrl:]]') then raise exception 'PRODUCT_SPECIFICATIONS_INVALID'; end if;
  select * into v_before from public.project_product_prices where id = p_product_id and project_id = p_project_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if p_expected_updated_at is distinct from v_before.updated_at then raise exception 'CATALOG_CONFLICT'; end if;
  update public.project_product_prices set resistance_psi = p_resistance_psi, slump = v_slump where id = p_product_id;
  insert into public.audit_events(actor_user_id, company_id, project_id, entity_type, entity_id, action, old_values, new_values)
  values(auth.uid(), p_company_id, p_project_id, 'project_price_catalog', p_product_id, 'PROJECT_PRODUCT_SPECIFICATIONS_UPDATED',
    jsonb_build_object('resistance_psi', v_before.resistance_psi, 'slump', v_before.slump),
    jsonb_build_object('resistance_psi', p_resistance_psi, 'slump', v_slump));
end;
$$;
revoke all on function public.platform_update_product_specifications(uuid,uuid,uuid,integer,text,timestamptz) from public, anon;
grant execute on function public.platform_update_product_specifications(uuid,uuid,uuid,integer,text,timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
