-- Per-guide truck times; never backfill historical timestamps.
begin;

alter table public.dispatch_guides
  add column truck_arrival_at timestamptz,
  add column truck_departure_at timestamptz,
  add constraint dispatch_guides_truck_times_valid check (
    (truck_arrival_at is null and truck_departure_at is null) or
    (truck_arrival_at is not null and truck_departure_at is not null and truck_arrival_at <= truck_departure_at)
  );

create function app_private.dispatch_guide_truck_timestamps(
  p_dispatch_id uuid,p_arrival time,p_departure time
) returns table(arrival_at timestamptz,departure_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_day date; v_timezone text;
begin
  if p_arrival is null or p_departure is null then raise exception 'GUIDE_TRUCK_TIMES_REQUIRED'; end if;
  if p_arrival>=time '24:00' or p_departure>=time '24:00' or p_departure<p_arrival then
    raise exception 'GUIDE_TRUCK_INVALID_TIME_SEQUENCE';
  end if;
  select (pr.scheduled_at at time zone coalesce(nullif(btrim(p.timezone),''),'America/Guatemala'))::date,
    coalesce(nullif(btrim(p.timezone),''),'America/Guatemala') into v_day,v_timezone
  from public.dispatches d join public.programming pr on pr.id=d.programming_id and pr.project_id=d.project_id
  join public.projects p on p.id=d.project_id where d.id=p_dispatch_id;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  return query select (v_day+p_arrival) at time zone v_timezone,(v_day+p_departure) at time zone v_timezone;
end;
$$;

create function app_private.guard_dispatch_guide_truck_times() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app_private
as $$
declare v_dispatch public.dispatches%rowtype; v_day date; v_timezone text;
begin
  select * into v_dispatch from public.dispatches
  where id=case when tg_op='DELETE' then old.dispatch_id else new.dispatch_id end for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if v_dispatch.status<>'IN_EXECUTION' then raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE'; end if;
  if tg_op='DELETE' then return old; end if;
  if new.project_id<>v_dispatch.project_id then raise exception 'DISPATCH_PROGRAMMING_CONTEXT_INVALID'; end if;
  if tg_op='UPDATE' and (new.id,new.dispatch_id,new.project_id) is distinct from (old.id,old.dispatch_id,old.project_id) then
    raise exception 'DISPATCH_CONTEXT_IMMUTABLE';
  end if;
  if new.truck_arrival_at is null or new.truck_departure_at is null then raise exception 'GUIDE_TRUCK_TIMES_REQUIRED'; end if;
  if new.truck_departure_at<new.truck_arrival_at then raise exception 'GUIDE_TRUCK_INVALID_TIME_SEQUENCE'; end if;
  select coalesce(nullif(btrim(p.timezone),''),'America/Guatemala'),
    (pr.scheduled_at at time zone coalesce(nullif(btrim(p.timezone),''),'America/Guatemala'))::date into v_timezone,v_day
  from public.programming pr join public.projects p on p.id=pr.project_id where pr.id=v_dispatch.programming_id;
  if (new.truck_arrival_at at time zone v_timezone)::date<>v_day or (new.truck_departure_at at time zone v_timezone)::date<>v_day then
    raise exception 'GUIDE_TRUCK_DATE_MISMATCH';
  end if;
  return new;
end;
$$;

create function app_private.sync_dispatch_guide_departure() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app_private
as $$
declare v_dispatch_id uuid; v_departure timestamptz;
begin
  if tg_op='DELETE' then
    if old.truck_departure_at is null then return null; end if;
    v_dispatch_id := old.dispatch_id;
  else v_dispatch_id := new.dispatch_id; end if;
  select max(truck_departure_at) into v_departure from public.dispatch_guides where dispatch_id=v_dispatch_id;
  update public.dispatches set departure_at=v_departure,updated_at=now()
  where id=v_dispatch_id and departure_at is distinct from v_departure;
  return null;
end;
$$;

create trigger dispatch_guides_truck_times_guard
before insert or delete or update of truck_arrival_at,truck_departure_at,dispatch_id,project_id
on public.dispatch_guides for each row execute function app_private.guard_dispatch_guide_truck_times();
create trigger dispatch_guides_departure_rollup
after insert or delete or update of truck_arrival_at,truck_departure_at
on public.dispatch_guides for each row execute function app_private.sync_dispatch_guide_departure();

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
    sum((item.value ->> 'quantity')::numeric)
      filter (where item.value ->> 'catalog_type' = 'PRODUCT')::numeric(12,3)
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
  select sum((item.value ->> 'quantity')::numeric)::numeric(12,3)
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


-- Keep the old endpoint explicit: stale clients must reload rather than omit truck times.
create or replace function public.create_dispatch_guide_with_lines(
  p_dispatch_id uuid,p_expected_version integer,p_guide_number text,p_guide_date date,p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, app_private
as $$ begin
  return public.create_dispatch_guide_with_lines(p_dispatch_id,p_expected_version,p_guide_number,p_guide_date,p_lines,null::time,null::time);
end; $$;

-- Keep the old endpoint explicit: stale clients must reload rather than omit truck times.
create or replace function public.update_dispatch_guide_with_lines(
  p_guide_id uuid,p_expected_version integer,p_guide_number text,p_guide_date date,p_lines jsonb
) returns integer language plpgsql security definer set search_path = pg_catalog, public, app_private
as $$ begin
  return public.update_dispatch_guide_with_lines(p_guide_id,p_expected_version,p_guide_number,p_guide_date,p_lines,null::time,null::time);
end; $$;

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
  if new.departure_at is not null and new.departure_at < new.arrival_at then
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
  select coalesce(max(truck_departure_at),p_departure_at) into v_departure_at
  from public.dispatch_guides where dispatch_id=v_dispatch.id and project_id=v_dispatch.project_id;
  if p_arrival_at is null then raise exception 'DISPATCH_ARRIVAL_REQUIRED'; end if;
  if v_departure_at is not null and v_departure_at < p_arrival_at then
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

alter function app_private.dispatch_guide_truck_timestamps(uuid,time,time) owner to postgres;
revoke all on function app_private.dispatch_guide_truck_timestamps(uuid,time,time) from public,anon,authenticated,service_role;
alter function app_private.guard_dispatch_guide_truck_times() owner to postgres;
revoke all on function app_private.guard_dispatch_guide_truck_times() from public,anon,authenticated,service_role;
alter function app_private.sync_dispatch_guide_departure() owner to postgres;
revoke all on function app_private.sync_dispatch_guide_departure() from public,anon,authenticated,service_role;
alter function public.create_dispatch_guide_with_lines(uuid,integer,text,date,jsonb,time,time) owner to postgres;
revoke all on function public.create_dispatch_guide_with_lines(uuid,integer,text,date,jsonb,time,time) from public,anon;
grant execute on function public.create_dispatch_guide_with_lines(uuid,integer,text,date,jsonb,time,time) to authenticated,service_role;
alter function public.update_dispatch_guide_with_lines(uuid,integer,text,date,jsonb,time,time) owner to postgres;
revoke all on function public.update_dispatch_guide_with_lines(uuid,integer,text,date,jsonb,time,time) from public,anon;
grant execute on function public.update_dispatch_guide_with_lines(uuid,integer,text,date,jsonb,time,time) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
