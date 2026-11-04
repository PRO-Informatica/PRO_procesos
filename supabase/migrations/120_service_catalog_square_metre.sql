-- Service area units: m²/M2 are square metres; m³/M3 remain cubic metres.
-- No conversion, price adjustment or changes to historical rows/product units.
begin;

insert into public.units_of_measure(code,name,active)
values ('M2','Metro cuadrado',true)
on conflict (code) do nothing;

alter table public.project_service_prices
  drop constraint project_service_prices_unit_code_valid,
  add constraint project_service_prices_unit_code_valid check (
    unit_code is null or unit_code in ('KM', 'M', 'M2', 'M3', 'UN', 'SERVICIO', 'COMBO', 'RECARGO', 'DOSIS/M3')
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
    when normalized_unit in ('KM', 'M', 'M2', 'M3', 'UN', 'SERVICIO', 'COMBO', 'RECARGO', 'DOSIS/M3')
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

    v_type := upper(btrim(coalesce(v_item ->> 'catalog_type', '')));
    v_unit := case
      when v_type = 'SERVICE' then app_private.normalize_service_catalog_unit(v_item ->> 'unit_code')
      else upper(btrim(coalesce(v_item ->> 'unit_code', '')))
    end;
    if v_unit is null or v_unit not in ('KM', 'M', 'M2', 'M3', 'UN', 'SERVICIO', 'COMBO', 'RECARGO', 'DOSIS/M3')
       or not exists (
         select 1 from public.units_of_measure unit
         where unit.code = v_unit and unit.active
       ) then
      raise exception 'INVALID_OR_INACTIVE_UNIT_OF_MEASURE';
    end if;

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

-- Existing owners, privileges, product restrictions and guide snapshots are retained.
notify pgrst, 'reload schema';
commit;
