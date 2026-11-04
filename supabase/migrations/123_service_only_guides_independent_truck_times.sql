-- Service-only guides have zero physical product volume. Their commercial
-- quantities/prices remain on their service lines. Guide truck times are
-- independent of the dispatch registration clock; every truck pair stays ordered.
begin;

alter table public.dispatch_guides
  drop constraint dispatch_guides_quantity_ck,
  add constraint dispatch_guides_quantity_ck check (quantity >= 0);

-- The trigger below retains sequencing for manual dispatch times. A table
-- CHECK cannot distinguish a guide-derived departure from a manual departure.
alter table public.dispatches drop constraint dispatches_time_sequence_ck;

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

  return v_resolved;
end;
$$;

create or replace function public.create_dispatch_guide_with_lines(
  p_dispatch_id uuid,
  p_expected_version integer,
  p_guide_number text,
  p_guide_date date,
  p_lines jsonb,
  p_truck_arrival_time time,
  p_truck_departure_time time
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_programming public.programming%rowtype;
  v_guide_id uuid := gen_random_uuid();
  v_resolved jsonb;
  v_count integer;
  v_product_count integer;
  v_service_count integer;
  v_total numeric(12,3);
  v_truck_arrival timestamptz;
  v_truck_departure timestamptz;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_expected_version is null then raise exception 'DISPATCH_VERSION_REQUIRED'; end if;
  if nullif(btrim(p_guide_number), '') is null then
    raise exception 'GUIDE_NUMBER_REQUIRED';
  end if;
  if p_guide_date is null then raise exception 'GUIDE_DATE_REQUIRED'; end if;

  select * into v_dispatch from public.dispatches
  where id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_dispatch.project_id, 'dispatch.modify') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;

  select * into v_programming from public.programming
  where id = v_dispatch.programming_id;
  select arrival_at, departure_at into v_truck_arrival, v_truck_departure
  from app_private.dispatch_guide_truck_timestamps(v_dispatch.id,p_truck_arrival_time,p_truck_departure_time);
  v_resolved := app_private.resolve_dispatch_guide_lines(
    v_dispatch.project_id, v_programming.unit_code, p_lines, null
  );
  v_count := jsonb_array_length(v_resolved);
  select
    count(*) filter (where item.value ->> 'catalog_type' = 'PRODUCT')::integer,
    count(*) filter (where item.value ->> 'catalog_type' = 'SERVICE')::integer,
    coalesce(sum((item.value ->> 'quantity')::numeric)
      filter (where item.value ->> 'catalog_type' = 'PRODUCT'), 0)::numeric(12,3)
  into v_product_count, v_service_count, v_total
  from jsonb_array_elements(v_resolved) item(value);

  begin
    insert into public.dispatch_guides(
      id, project_id, dispatch_id, guide_number, guide_date,
      quantity, unit_code, created_by, truck_arrival_at, truck_departure_at
    ) values (
      v_guide_id, v_dispatch.project_id, v_dispatch.id,
      btrim(p_guide_number), p_guide_date, v_total,
      v_programming.unit_code, v_actor, v_truck_arrival, v_truck_departure
    );
  exception when unique_violation then
    raise exception 'DISPATCH_GUIDE_NUMBER_ALREADY_EXISTS';
  end;

  insert into public.dispatch_guide_lines(
    project_id, guide_id, quantity, unit_code,
    product_code, product_description, position,
    catalog_type, product_price_id, service_price_id,
    catalog_reference, unit_price, currency
  )
  select v_dispatch.project_id, v_guide_id,
    (item.value ->> 'quantity')::numeric(12,3),
    item.value ->> 'unit_code',
    item.value ->> 'product_code',
    item.value ->> 'product_description',
    item.position::integer,
    item.value ->> 'catalog_type',
    nullif(item.value ->> 'product_price_id', '')::uuid,
    nullif(item.value ->> 'service_price_id', '')::uuid,
    item.value ->> 'catalog_reference',
    nullif(item.value ->> 'unit_price', '')::numeric(18,4),
    item.value ->> 'currency'
  from jsonb_array_elements(v_resolved)
       with ordinality item(value, position);

  update public.dispatches set version = version + 1, updated_at = now()
  where id = v_dispatch.id;
  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id, action, new_values
  ) values (
    v_actor, v_dispatch.project_id, 'dispatch_guide', v_guide_id,
    'DISPATCH_GUIDE_ADDED', jsonb_build_object(
      'dispatch_id', v_dispatch.id,
      'guide_number', btrim(p_guide_number),
      'line_count', v_count,
      'product_count', v_product_count,
      'service_count', v_service_count,
      'truck_arrival_at', v_truck_arrival,
      'truck_departure_at', v_truck_departure,
      'quantity', v_total,
      'unit_code', v_programming.unit_code
    )
  );
  return jsonb_build_object(
    'guide_id', v_guide_id,
    'dispatch_version', v_dispatch.version + 1
  );
end;
$$;

create or replace function public.update_dispatch_guide_with_lines(
  p_guide_id uuid,
  p_expected_version integer,
  p_guide_number text,
  p_guide_date date,
  p_lines jsonb,
  p_truck_arrival_time time,
  p_truck_departure_time time
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_guide public.dispatch_guides%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_programming_unit text;
  v_resolved jsonb;
  v_count integer;
  v_product_count integer;
  v_service_count integer;
  v_total numeric(12,3);
  v_truck_arrival timestamptz;
  v_truck_departure timestamptz;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_expected_version is null then raise exception 'DISPATCH_VERSION_REQUIRED'; end if;
  if nullif(btrim(p_guide_number), '') is null then
    raise exception 'GUIDE_NUMBER_REQUIRED';
  end if;
  if p_guide_date is null then raise exception 'GUIDE_DATE_REQUIRED'; end if;

  select * into v_guide from public.dispatch_guides where id = p_guide_id;
  if not found then raise exception 'DISPATCH_GUIDE_NOT_FOUND'; end if;
  select * into v_dispatch from public.dispatches
  where id = v_guide.dispatch_id for update;
  if not app_private.has_project_permission(v_dispatch.project_id, 'dispatch.modify') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;

  select unit_code into v_programming_unit from public.programming
  where id = v_dispatch.programming_id;
  select arrival_at, departure_at into v_truck_arrival, v_truck_departure
  from app_private.dispatch_guide_truck_timestamps(v_dispatch.id,p_truck_arrival_time,p_truck_departure_time);
  v_resolved := app_private.resolve_dispatch_guide_lines(
    v_dispatch.project_id, v_programming_unit, p_lines, v_guide.id
  );
  v_count := jsonb_array_length(v_resolved);
  select
    count(*) filter (where item.value ->> 'catalog_type' = 'PRODUCT')::integer,
    count(*) filter (where item.value ->> 'catalog_type' = 'SERVICE')::integer
  into v_product_count, v_service_count
  from jsonb_array_elements(v_resolved) item(value);

  -- JSON null is represented by a null text value, so include legacy rows too.
  select coalesce(sum((item.value ->> 'quantity')::numeric), 0)::numeric(12,3)
  into v_total
  from jsonb_array_elements(v_resolved) item(value)
  where item.value ->> 'catalog_type' = 'PRODUCT'
     or item.value ->> 'catalog_type' is null;

  begin
    update public.dispatch_guides
    set guide_number = btrim(p_guide_number),
        guide_date = p_guide_date,
        truck_arrival_at = v_truck_arrival,
        truck_departure_at = v_truck_departure,
        quantity = v_total,
        unit_code = v_programming_unit,
        updated_at = now()
    where id = v_guide.id;
  exception when unique_violation then
    raise exception 'DISPATCH_GUIDE_NUMBER_ALREADY_EXISTS';
  end;

  insert into public.dispatch_guide_lines(
    project_id, guide_id, quantity, unit_code,
    product_code, product_description, position,
    catalog_type, product_price_id, service_price_id,
    catalog_reference, unit_price, currency
  )
  select v_dispatch.project_id, v_guide.id,
    (item.value ->> 'quantity')::numeric(12,3),
    item.value ->> 'unit_code',
    item.value ->> 'product_code',
    item.value ->> 'product_description',
    item.position::integer,
    item.value ->> 'catalog_type',
    nullif(item.value ->> 'product_price_id', '')::uuid,
    nullif(item.value ->> 'service_price_id', '')::uuid,
    item.value ->> 'catalog_reference',
    nullif(item.value ->> 'unit_price', '')::numeric(18,4),
    item.value ->> 'currency'
  from jsonb_array_elements(v_resolved)
       with ordinality item(value, position)
  on conflict on constraint dispatch_guide_lines_position_uq do update
  set quantity = excluded.quantity,
      unit_code = excluded.unit_code,
      product_code = excluded.product_code,
      product_description = excluded.product_description,
      catalog_type = excluded.catalog_type,
      product_price_id = excluded.product_price_id,
      service_price_id = excluded.service_price_id,
      catalog_reference = excluded.catalog_reference,
      unit_price = excluded.unit_price,
      currency = excluded.currency;

  delete from public.dispatch_guide_lines
  where guide_id = v_guide.id and position > v_count;
  update public.dispatches set version = version + 1, updated_at = now()
  where id = v_dispatch.id;
  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id,
    action, old_values, new_values
  ) values (
    v_actor, v_dispatch.project_id, 'dispatch_guide', v_guide.id,
    'DISPATCH_GUIDE_UPDATED',
    jsonb_build_object(
      'guide_number', v_guide.guide_number,
      'guide_date', v_guide.guide_date,
      'truck_arrival_at', v_guide.truck_arrival_at,
      'truck_departure_at', v_guide.truck_departure_at,
      'quantity', v_guide.quantity
    ),
    jsonb_build_object(
      'guide_number', btrim(p_guide_number),
      'guide_date', p_guide_date,
      'line_count', v_count,
      'product_count', v_product_count,
      'service_count', v_service_count,
      'truck_arrival_at', v_truck_arrival,
      'truck_departure_at', v_truck_departure,
      'quantity', v_total,
      'unit_code', v_programming_unit
    )
  );
  return v_dispatch.version + 1;
end;
$$;

create or replace function app_private.guard_dispatch_programming_day()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_timezone text;
  v_programming_date date;
  v_guide_departure timestamptz;
begin
  select
    coalesce(nullif(btrim(project.timezone), ''), 'America/Guatemala'),
    (programming.scheduled_at at time zone coalesce(
      nullif(btrim(project.timezone), ''), 'America/Guatemala'
    ))::date
  into v_timezone, v_programming_date
  from public.programming programming
  join public.projects project on project.id = programming.project_id
  where programming.id = new.programming_id
    and programming.project_id = new.project_id;

  if not found then
    raise exception 'DISPATCH_PROGRAMMING_CONTEXT_INVALID';
  end if;
  select max(truck_departure_at) into v_guide_departure
  from public.dispatch_guides where dispatch_id=new.id and project_id=new.project_id;
  if v_guide_departure is not null then new.departure_at := v_guide_departure; end if;
  if new.arrival_at is null then
    raise exception 'DISPATCH_ARRIVAL_REQUIRED';
  end if;
  if (new.arrival_at at time zone v_timezone)::date <> v_programming_date then
    raise exception 'DISPATCH_ARRIVAL_DATE_MISMATCH';
  end if;
  if new.departure_at is not null
     and (new.departure_at at time zone v_timezone)::date <> v_programming_date then
    raise exception 'DISPATCH_DEPARTURE_DATE_MISMATCH';
  end if;
  -- Guide truck times are independent of when the dispatch was registered.
  -- Only a manually entered departure (without timed guides) uses this pair.
  if v_guide_departure is null and new.departure_at is not null
     and new.departure_at < new.arrival_at then
    raise exception 'DISPATCH_INVALID_TIME_SEQUENCE';
  end if;
  return new;
end;
$$;

create or replace function public.update_dispatch(
  p_dispatch_id uuid,
  p_expected_version integer,
  p_arrival_at timestamptz,
  p_departure_at timestamptz,
  p_received_by_name text,
  p_result public.dispatch_result,
  p_order_number text,
  p_real_volume numeric,
  p_real_unit_code text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_company_id uuid;
  v_receiver_name text := nullif(btrim(p_received_by_name), '');
  v_order_number text := nullif(btrim(p_order_number), '');
  v_unit text := nullif(btrim(p_real_unit_code), '');
  v_volume numeric(12,3) := p_real_volume;
  v_departure_at timestamptz;
  v_guide_departure timestamptz;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_expected_version is null then
    raise exception 'DISPATCH_VERSION_REQUIRED';
  end if;

  select dispatch.* into v_dispatch
  from public.dispatches dispatch
  where dispatch.id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(
    v_dispatch.project_id, 'dispatch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  select max(truck_departure_at) into v_guide_departure
  from public.dispatch_guides where dispatch_id=v_dispatch.id and project_id=v_dispatch.project_id;
  v_departure_at := coalesce(v_guide_departure, p_departure_at);
  if p_arrival_at is null then raise exception 'DISPATCH_ARRIVAL_REQUIRED'; end if;
  if v_guide_departure is null and v_departure_at is not null
     and v_departure_at < p_arrival_at then
    raise exception 'DISPATCH_INVALID_TIME_SEQUENCE';
  end if;
  if v_receiver_name is null then raise exception 'RECEIVER_NAME_REQUIRED'; end if;
  if v_volume is not null and v_volume < 0 then
    raise exception 'DISPATCH_REAL_VOLUME_INVALID';
  end if;
  if p_result = 'NOT_DISPATCHED' then v_volume := 0; end if;
  if v_unit is not null and not exists (
    select 1 from public.units_of_measure unit
    where unit.code = v_unit and unit.active
  ) then raise exception 'INVALID_OR_INACTIVE_UNIT_OF_MEASURE'; end if;

  update public.dispatches
  set arrival_at = p_arrival_at,
      departure_at = v_departure_at,
      received_by_name = v_receiver_name,
      result = p_result,
      order_number = v_order_number,
      real_volume = v_volume,
      real_unit_code = v_unit,
      version = version + 1,
      updated_at = now()
  where id = v_dispatch.id;

  select project.company_id into v_company_id
  from public.projects project where project.id = v_dispatch.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values
  ) values (
    v_actor, v_company_id, v_dispatch.project_id, 'dispatch',
    v_dispatch.id, 'DISPATCH_SAVED',
    jsonb_build_object(
      'arrival_at', v_dispatch.arrival_at,
      'departure_at', v_dispatch.departure_at,
      'result', v_dispatch.result,
      'order_number', v_dispatch.order_number,
      'real_volume', v_dispatch.real_volume,
      'real_unit_code', v_dispatch.real_unit_code,
      'version', v_dispatch.version
    ),
    jsonb_build_object(
      'arrival_at', p_arrival_at,
      'departure_at', v_departure_at,
      'result', p_result,
      'order_number', v_order_number,
      'real_volume', v_volume,
      'real_unit_code', v_unit,
      'version', v_dispatch.version + 1
    )
  );
  return v_dispatch.version + 1;
end;
$$;

comment on function app_private.guard_dispatch_programming_day() is
  'Enforces the operation day; orders manual dispatch times, while timed guides keep their own independent truck pairs.';
notify pgrst,'reload schema';
commit;
