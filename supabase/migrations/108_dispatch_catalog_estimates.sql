begin;

do $$
begin
  if to_regclass('public.dispatch_guide_lines') is null
     or to_regclass('public.dispatch_guides') is null
     or to_regclass('public.dispatches') is null
     or to_regclass('public.project_product_prices') is null
     or to_regclass('public.project_service_prices') is null
     or to_regprocedure('app_private.has_project_permission(uuid,text)') is null then
    raise exception 'Missing dispatch catalog estimate prerequisites';
  end if;
end;
$$;

insert into public.units_of_measure(code, name, active)
values
  ('KM', 'Kilómetro', true),
  ('M3', 'Metro cúbico', true),
  ('UN', 'Unidad', true)
on conflict (code) do update
set name = excluded.name, active = true;

create function app_private.normalize_catalog_reference(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select upper(regexp_replace(btrim(coalesce(p_value, '')), '[[:space:]]+', ' ', 'g'));
$$;

alter function app_private.normalize_catalog_reference(text) owner to postgres;
revoke all on function app_private.normalize_catalog_reference(text)
  from public, anon, authenticated, service_role;

alter table public.project_product_prices
  add column normalized_reference text generated always as (
    app_private.normalize_catalog_reference(reference)
  ) stored;

create index project_product_prices_project_normalized_reference_idx
  on public.project_product_prices(project_id, normalized_reference);

create policy project_product_prices_dispatch_select
on public.project_product_prices
for select to authenticated
using (app_private.has_project_permission(project_id, 'dispatch.view'));

create policy project_service_prices_dispatch_select
on public.project_service_prices
for select to authenticated
using (app_private.has_project_permission(project_id, 'dispatch.view'));

alter table public.dispatch_guide_lines
  add column catalog_type text,
  add column product_price_id uuid,
  add column service_price_id uuid,
  add column catalog_reference text,
  add column unit_price numeric(18,4),
  add column currency text,
  add column estimated_subtotal numeric(22,4) generated always as (
    case
      when unit_price is null then null
      else round(quantity * unit_price, 4)
    end
  ) stored,
  add constraint dispatch_guide_lines_product_price_fk
    foreign key (product_price_id)
    references public.project_product_prices(id)
    on delete set null,
  add constraint dispatch_guide_lines_service_price_fk
    foreign key (service_price_id)
    references public.project_service_prices(id)
    on delete set null,
  add constraint dispatch_guide_lines_catalog_type_ck check (
    catalog_type is null or catalog_type in ('PRODUCT', 'SERVICE')
  ),
  add constraint dispatch_guide_lines_catalog_shape_ck check (
    (
      catalog_type is null
      and product_price_id is null
      and service_price_id is null
      and catalog_reference is null
      and unit_price is null
      and currency is null
    )
    or (
      catalog_type = 'PRODUCT'
      and service_price_id is null
      and nullif(btrim(product_code), '') is not null
      and nullif(btrim(catalog_reference), '') is not null
      and unit_price is not null
      and unit_price >= 0
      and currency = 'GTQ'
    )
    or (
      catalog_type = 'SERVICE'
      and product_price_id is null
      and catalog_reference is null
      and nullif(btrim(product_code), '') is not null
      and unit_price is not null
      and unit_price >= 0
      and currency = 'GTQ'
    )
  );

create index dispatch_guide_lines_product_price_idx
  on public.dispatch_guide_lines(product_price_id)
  where product_price_id is not null;
create index dispatch_guide_lines_service_price_idx
  on public.dispatch_guide_lines(service_price_id)
  where service_price_id is not null;
create index dispatch_guide_lines_guide_catalog_type_idx
  on public.dispatch_guide_lines(guide_id, catalog_type);

create function app_private.resolve_dispatch_guide_lines(
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
    if v_unit not in ('KM', 'M3', 'UN')
       or not exists (
         select 1 from public.units_of_measure unit
         where unit.code = v_unit and unit.active
       ) then
      raise exception 'INVALID_OR_INACTIVE_UNIT_OF_MEASURE';
    end if;

    v_type := upper(btrim(coalesce(v_item ->> 'catalog_type', '')));
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

alter function app_private.resolve_dispatch_guide_lines(uuid,text,jsonb,uuid)
  owner to postgres;
revoke all on function app_private.resolve_dispatch_guide_lines(uuid,text,jsonb,uuid)
  from public, anon, authenticated, service_role;

create or replace function app_private.sync_dispatch_guide_line_rollup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_guide_id uuid := coalesce(new.guide_id, old.guide_id);
  v_programming_unit text;
  v_count integer;
  v_total numeric(12,3);
begin
  select programming.unit_code
  into v_programming_unit
  from public.dispatch_guides guide
  join public.dispatches dispatch on dispatch.id = guide.dispatch_id
  join public.programming programming on programming.id = dispatch.programming_id
  where guide.id = v_guide_id;

  if v_programming_unit is null then return null; end if;

  select count(*)::integer, sum(line.quantity)::numeric(12,3)
  into v_count, v_total
  from public.dispatch_guide_lines line
  where line.guide_id = v_guide_id
    and (line.catalog_type = 'PRODUCT' or line.catalog_type is null);

  if v_count = 0 then return null; end if;
  if exists (
    select 1 from public.dispatch_guide_lines line
    where line.guide_id = v_guide_id
      and (line.catalog_type = 'PRODUCT' or line.catalog_type is null)
      and line.unit_code is distinct from v_programming_unit
  ) then
    raise exception 'DISPATCH_PROGRAMMING_UNIT_MISMATCH';
  end if;

  update public.dispatch_guides
  set quantity = v_total, unit_code = v_programming_unit, updated_at = now()
  where id = v_guide_id;
  return null;
end;
$$;

alter function app_private.sync_dispatch_guide_line_rollup() owner to postgres;
revoke all on function app_private.sync_dispatch_guide_line_rollup()
  from public, anon, authenticated, service_role;

create or replace function app_private.guard_dispatch_child_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_dispatch_id uuid;
  v_status public.dispatch_status;
begin
  if tg_table_name = 'dispatch_guides' then
    v_dispatch_id := case when tg_op = 'DELETE' then old.dispatch_id else new.dispatch_id end;
  elsif tg_table_name = 'dispatch_guide_lines' then
    select guide.dispatch_id into v_dispatch_id
    from public.dispatch_guides guide
    where guide.id = case when tg_op = 'DELETE' then old.guide_id else new.guide_id end;
  elsif tg_table_name = 'dispatch_incidents' then
    v_dispatch_id := case when tg_op = 'DELETE' then old.dispatch_id else new.dispatch_id end;
  elsif tg_table_name = 'dispatch_documents' then
    v_dispatch_id := case when tg_op = 'DELETE' then old.dispatch_id else new.dispatch_id end;
  elsif tg_table_name = 'guide_documents' then
    select guide.dispatch_id into v_dispatch_id
    from public.dispatch_guides guide
    where guide.id = case when tg_op = 'DELETE' then old.guide_id else new.guide_id end;
  elsif tg_table_name = 'incident_documents' then
    select incident.dispatch_id into v_dispatch_id
    from public.dispatch_incidents incident
    where incident.id = case when tg_op = 'DELETE' then old.incident_id else new.incident_id end;
  end if;

  select dispatch.status into v_status
  from public.dispatches dispatch where dispatch.id = v_dispatch_id;
  if v_status = 'COMPLETED' then
    if tg_table_name = 'dispatch_guide_lines'
       and tg_op = 'UPDATE'
       and (
         new.id,
         new.project_id,
         new.guide_id,
         new.quantity,
         new.unit_code,
         new.product_code,
         new.product_description,
         new.position,
         new.catalog_type,
         new.catalog_reference,
         new.unit_price,
         new.currency,
         new.created_at
       ) is not distinct from (
         old.id,
         old.project_id,
         old.guide_id,
         old.quantity,
         old.unit_code,
         old.product_code,
         old.product_description,
         old.position,
         old.catalog_type,
         old.catalog_reference,
         old.unit_price,
         old.currency,
         old.created_at
       )
       and (
         (
           old.product_price_id is not null
           and new.product_price_id is null
           and new.service_price_id is not distinct from old.service_price_id
         )
         or (
           old.service_price_id is not null
           and new.service_price_id is null
           and new.product_price_id is not distinct from old.product_price_id
         )
       ) then
      return new;
    end if;
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

alter function app_private.guard_dispatch_child_mutation() owner to postgres;
revoke all on function app_private.guard_dispatch_child_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists dispatch_guide_lines_completed_guard
  on public.dispatch_guide_lines;
create trigger dispatch_guide_lines_completed_guard
before insert or update or delete on public.dispatch_guide_lines
for each row execute function app_private.guard_dispatch_child_mutation();

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
      'price', item.price
    ) order by item.code), '[]'::jsonb)
    into v_items
    from (
      select service.id, service.code, service.price
      from public.project_service_prices service
      where service.project_id = p_project_id
        and (v_query = '' or service.code ilike '%' || v_query || '%')
      order by service.code
      limit v_limit
    ) item;
  end if;

  return jsonb_build_object('items', v_items);
end;
$$;

alter function public.search_project_dispatch_catalog(uuid,text,text,integer)
  owner to postgres;
revoke all on function public.search_project_dispatch_catalog(uuid,text,text,integer)
  from public, anon;
grant execute on function public.search_project_dispatch_catalog(uuid,text,text,integer)
  to authenticated, service_role;

create or replace function public.create_dispatch_guide_with_lines(
  p_dispatch_id uuid,
  p_expected_version integer,
  p_guide_number text,
  p_guide_date date,
  p_lines jsonb
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
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
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
  v_resolved := app_private.resolve_dispatch_guide_lines(
    v_dispatch.project_id, v_programming.unit_code, p_lines, null
  );
  v_count := jsonb_array_length(v_resolved);
  select
    count(*) filter (where item.value ->> 'catalog_type' = 'PRODUCT')::integer,
    count(*) filter (where item.value ->> 'catalog_type' = 'SERVICE')::integer,
    sum((item.value ->> 'quantity')::numeric)
      filter (where item.value ->> 'catalog_type' = 'PRODUCT')::numeric(12,3)
  into v_product_count, v_service_count, v_total
  from jsonb_array_elements(v_resolved) item(value);

  begin
    insert into public.dispatch_guides(
      id, project_id, dispatch_id, guide_number, guide_date,
      quantity, unit_code, created_by
    ) values (
      v_guide_id, v_dispatch.project_id, v_dispatch.id,
      btrim(p_guide_number), p_guide_date, v_total,
      v_programming.unit_code, v_actor
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
  p_lines jsonb
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
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
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
  select sum((item.value ->> 'quantity')::numeric)::numeric(12,3)
  into v_total
  from jsonb_array_elements(v_resolved) item(value)
  where item.value ->> 'catalog_type' = 'PRODUCT'
     or item.value ->> 'catalog_type' is null;

  begin
    update public.dispatch_guides
    set guide_number = btrim(p_guide_number),
        guide_date = p_guide_date,
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
      'quantity', v_guide.quantity
    ),
    jsonb_build_object(
      'guide_number', btrim(p_guide_number),
      'guide_date', p_guide_date,
      'line_count', v_count,
      'product_count', v_product_count,
      'service_count', v_service_count,
      'quantity', v_total,
      'unit_code', v_programming_unit
    )
  );
  return v_dispatch.version + 1;
end;
$$;

create or replace function public.delete_dispatch_guide(
  p_guide_id uuid,
  p_expected_version integer
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
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
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
  if exists (select 1 from public.guide_documents where guide_id = v_guide.id) then
    raise exception 'DISPATCH_GUIDE_HAS_EVIDENCE';
  end if;

  delete from public.dispatch_guide_lines where guide_id = v_guide.id;
  delete from public.dispatch_guides where id = v_guide.id;
  update public.dispatches set version = version + 1, updated_at = now()
  where id = v_dispatch.id;
  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id,
    action, old_values, new_values
  ) values (
    v_actor, v_dispatch.project_id, 'dispatch_guide', v_guide.id,
    'DISPATCH_GUIDE_DELETED', jsonb_build_object(
      'dispatch_id', v_dispatch.id,
      'guide_number', v_guide.guide_number,
      'quantity', v_guide.quantity,
      'unit_code', v_guide.unit_code
    ), jsonb_build_object('dispatch_version', v_dispatch.version + 1)
  );
  return v_dispatch.version + 1;
end;
$$;

alter function public.create_dispatch_guide_with_lines(uuid,integer,text,date,jsonb)
  owner to postgres;
alter function public.update_dispatch_guide_with_lines(uuid,integer,text,date,jsonb)
  owner to postgres;
alter function public.delete_dispatch_guide(uuid,integer) owner to postgres;

revoke all on function public.create_dispatch_guide_with_lines(uuid,integer,text,date,jsonb)
  from public, anon;
revoke all on function public.update_dispatch_guide_with_lines(uuid,integer,text,date,jsonb)
  from public, anon;
revoke all on function public.delete_dispatch_guide(uuid,integer)
  from public, anon;
grant execute on function public.create_dispatch_guide_with_lines(uuid,integer,text,date,jsonb)
  to authenticated, service_role;
grant execute on function public.update_dispatch_guide_with_lines(uuid,integer,text,date,jsonb)
  to authenticated, service_role;
grant execute on function public.delete_dispatch_guide(uuid,integer)
  to authenticated, service_role;

do $$
begin
  if to_regprocedure('public.search_project_dispatch_catalog(uuid,text,text,integer)') is null
     or to_regprocedure('app_private.resolve_dispatch_guide_lines(uuid,text,jsonb,uuid)') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'dispatch_guide_lines'
         and column_name = 'estimated_subtotal'
     ) then
    raise exception 'Dispatch catalog estimate migration postcondition failed';
  end if;
end;
$$;

commit;
