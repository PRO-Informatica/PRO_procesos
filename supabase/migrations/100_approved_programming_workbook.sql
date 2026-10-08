-- 100_approved_programming_workbook.sql
-- Approved Mixto Listo workbook import and structured operational fields.

begin;

alter table public.programming
  add column if not exists order_number text;

alter table public.programming_lines
  add column if not exists concrete_type text;

alter table public.programming_revisions
  add column if not exists order_number text;

alter table public.programming_revision_lines
  add column if not exists concrete_type text;

alter table public.programming
  add constraint programming_order_number_length_ck
  check (order_number is null or char_length(btrim(order_number)) between 1 and 120)
  not valid;

alter table public.programming_lines
  add constraint programming_lines_concrete_type_length_ck
  check (concrete_type is null or char_length(btrim(concrete_type)) between 1 and 160)
  not valid;

alter table public.programming validate constraint programming_order_number_length_ck;
alter table public.programming_lines validate constraint programming_lines_concrete_type_length_ck;

create or replace function app_private.snapshot_programming(
  p_programming_id uuid,
  p_actor uuid,
  p_action text,
  p_change_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_programming public.programming%rowtype;
  v_revision_id uuid;
  v_revision_no integer;
begin
  if p_actor is null then raise exception 'PROGRAMMING_SNAPSHOT_ACTOR_REQUIRED'; end if;
  if nullif(btrim(p_action), '') is null then raise exception 'PROGRAMMING_SNAPSHOT_ACTION_REQUIRED'; end if;

  select p.* into v_programming
  from public.programming p where p.id = p_programming_id;
  if not found then raise exception 'PROGRAMMING_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.programming_lines line
    where line.programming_id = v_programming.id
      and line.project_id = v_programming.project_id
  ) then raise exception 'PROGRAMMING_REQUIRES_LINE'; end if;

  select coalesce(max(revision.revision_no), 0) + 1
  into v_revision_no
  from public.programming_revisions revision
  where revision.programming_id = v_programming.id;

  insert into public.programming_revisions (
    programming_id, revision_no, programming_version, scheduled_at,
    supplier_id, order_number, requested_quantity, confirmed_quantity,
    unit_code, placement_group, requires_pumping, estimated_work_item_id,
    status, notes, confirmed_at, confirmed_by, change_reason, action, created_by
  ) values (
    v_programming.id, v_revision_no, v_programming.version,
    v_programming.scheduled_at, v_programming.supplier_id,
    v_programming.order_number, v_programming.requested_quantity,
    v_programming.confirmed_quantity, v_programming.unit_code,
    v_programming.placement_group, v_programming.requires_pumping,
    v_programming.estimated_work_item_id, v_programming.status,
    v_programming.notes, v_programming.confirmed_at,
    v_programming.confirmed_by, nullif(btrim(p_change_reason), ''),
    btrim(p_action), p_actor
  ) returning id into v_revision_id;

  insert into public.programming_revision_lines (
    project_id, programming_id, revision_id, quantity,
    unit_code, concrete_type, position
  )
  select line.project_id, line.programming_id, v_revision_id,
    line.quantity, line.unit_code, line.concrete_type, line.position
  from public.programming_lines line
  where line.programming_id = v_programming.id
    and line.project_id = v_programming.project_id
  order by line.position;

  return v_revision_id;
end;
$$;

create function public.create_programming_with_details(
  p_project_id uuid,
  p_supplier_id uuid,
  p_scheduled_at timestamptz,
  p_lines jsonb,
  p_order_number text,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_programming_id uuid;
  v_line_count integer;
  v_total_quantity numeric(12,3);
  v_unit_code text;
  v_order_number text := nullif(btrim(p_order_number), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.projects project
    where project.id = p_project_id and project.status = 'ACTIVE'
  ) then raise exception 'PROJECT_NOT_FOUND'; end if;
  if not app_private.has_project_permission(p_project_id, 'programming.create') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if not exists (
    select 1 from public.project_suppliers relation
    join public.suppliers supplier
      on supplier.id = relation.supplier_id
     and supplier.company_id = relation.company_id
    where relation.project_id = p_project_id
      and relation.supplier_id = p_supplier_id
      and relation.active and supplier.active
  ) then raise exception 'SUPPLIER_NOT_AVAILABLE'; end if;
  if p_scheduled_at is null then raise exception 'PROGRAMMING_SCHEDULE_REQUIRED'; end if;
  if v_order_number is null then raise exception 'PROGRAMMING_ORDER_NUMBER_REQUIRED'; end if;
  if char_length(v_order_number) > 120 then raise exception 'PROGRAMMING_ORDER_NUMBER_INVALID'; end if;

  select valid.line_count, valid.total_quantity, valid.unit_code
  into v_line_count, v_total_quantity, v_unit_code
  from app_private.validate_programming_lines_payload(p_lines) valid;

  if exists (
    select 1 from jsonb_array_elements(p_lines) item(value)
    where jsonb_typeof(item.value -> 'concrete_type') <> 'string'
       or nullif(btrim(item.value ->> 'concrete_type'), '') is null
       or char_length(btrim(item.value ->> 'concrete_type')) > 160
  ) then raise exception 'PROGRAMMING_CONCRETE_TYPE_REQUIRED'; end if;

  insert into public.programming (
    project_id, supplier_id, order_number, created_by, scheduled_at,
    requested_quantity, unit_code, status, notes
  ) values (
    p_project_id, p_supplier_id, v_order_number, v_actor, p_scheduled_at,
    v_total_quantity, v_unit_code, 'PENDING_CONFIRMATION', nullif(btrim(p_notes), '')
  ) returning id into v_programming_id;

  insert into public.programming_lines (
    project_id, programming_id, quantity, unit_code, concrete_type, position
  )
  select p_project_id, v_programming_id,
    (item.value ->> 'quantity')::numeric(12,3),
    btrim(item.value ->> 'unit_code'),
    btrim(item.value ->> 'concrete_type'),
    item.position::integer
  from jsonb_array_elements(p_lines) with ordinality as item(value, position);

  perform app_private.snapshot_programming(
    v_programming_id, v_actor, 'PROGRAMMING_CREATED', null
  );
  insert into public.audit_events (
    actor_user_id, project_id, entity_type, entity_id, action, new_values
  ) values (
    v_actor, p_project_id, 'programming', v_programming_id,
    'PROGRAMMING_CREATED', jsonb_build_object(
      'supplier_id', p_supplier_id, 'scheduled_at', p_scheduled_at,
      'order_number', v_order_number, 'line_count', v_line_count,
      'requested_quantity', v_total_quantity, 'unit_code', v_unit_code,
      'status', 'PENDING_CONFIRMATION', 'version', 1
    )
  );
  return v_programming_id;
end;
$$;

create function public.update_programming_with_details(
  p_programming_id uuid,
  p_expected_version integer,
  p_supplier_id uuid,
  p_scheduled_at timestamptz,
  p_lines jsonb,
  p_order_number text,
  p_notes text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_programming public.programming%rowtype;
  v_timezone text;
  v_today date;
  v_line_count integer;
  v_total_quantity numeric(12,3);
  v_unit_code text;
  v_order_number text := nullif(btrim(p_order_number), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_expected_version is null then raise exception 'PROGRAMMING_EXPECTED_VERSION_REQUIRED'; end if;
  select programming.* into v_programming
  from public.programming programming
  where programming.id = p_programming_id for update;
  if not found then raise exception 'PROGRAMMING_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_programming.project_id, 'programming.modify') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_programming.version <> p_expected_version then raise exception 'PROGRAMMING_VERSION_CONFLICT'; end if;
  if v_programming.status <> 'PENDING_CONFIRMATION' then raise exception 'PROGRAMMING_NOT_EDITABLE'; end if;
  if v_order_number is null then raise exception 'PROGRAMMING_ORDER_NUMBER_REQUIRED'; end if;

  select coalesce(nullif(btrim(project.timezone), ''), 'America/Guatemala')
  into v_timezone from public.projects project where project.id = v_programming.project_id;
  v_today := (clock_timestamp() at time zone v_timezone)::date;
  if (v_programming.scheduled_at at time zone v_timezone)::date <= v_today
     or (p_scheduled_at at time zone v_timezone)::date <= v_today then
    raise exception 'PROGRAMMING_EDIT_WINDOW_CLOSED';
  end if;
  if not exists (
    select 1 from public.project_suppliers relation
    join public.suppliers supplier
      on supplier.id = relation.supplier_id and supplier.company_id = relation.company_id
    where relation.project_id = v_programming.project_id
      and relation.supplier_id = p_supplier_id
      and relation.active and supplier.active
  ) then raise exception 'SUPPLIER_NOT_AVAILABLE'; end if;

  select valid.line_count, valid.total_quantity, valid.unit_code
  into v_line_count, v_total_quantity, v_unit_code
  from app_private.validate_programming_lines_payload(p_lines) valid;
  if exists (
    select 1 from jsonb_array_elements(p_lines) item(value)
    where jsonb_typeof(item.value -> 'concrete_type') <> 'string'
       or nullif(btrim(item.value ->> 'concrete_type'), '') is null
       or char_length(btrim(item.value ->> 'concrete_type')) > 160
  ) then raise exception 'PROGRAMMING_CONCRETE_TYPE_REQUIRED'; end if;

  update public.programming_lines line set unit_code = v_unit_code
  where line.programming_id = v_programming.id
    and line.project_id = v_programming.project_id
    and line.unit_code is distinct from v_unit_code;

  insert into public.programming_lines (
    project_id, programming_id, quantity, unit_code, concrete_type, position
  )
  select v_programming.project_id, v_programming.id,
    (item.value ->> 'quantity')::numeric(12,3),
    btrim(item.value ->> 'unit_code'), btrim(item.value ->> 'concrete_type'),
    item.position::integer
  from jsonb_array_elements(p_lines) with ordinality as item(value, position)
  on conflict on constraint programming_lines_position_uq
  do update set quantity = excluded.quantity,
    unit_code = excluded.unit_code, concrete_type = excluded.concrete_type;

  delete from public.programming_lines line
  where line.programming_id = v_programming.id
    and line.project_id = v_programming.project_id
    and line.position > v_line_count;

  update public.programming
  set supplier_id = p_supplier_id, scheduled_at = p_scheduled_at,
      order_number = v_order_number, notes = nullif(btrim(p_notes), ''),
      version = version + 1, updated_at = now()
  where id = v_programming.id;

  perform app_private.snapshot_programming(v_programming.id, v_actor, 'PROGRAMMING_UPDATED', null);
  insert into public.audit_events (
    actor_user_id, project_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v_actor, v_programming.project_id, 'programming', v_programming.id,
    'PROGRAMMING_UPDATED',
    jsonb_build_object('supplier_id', v_programming.supplier_id,
      'scheduled_at', v_programming.scheduled_at, 'order_number', v_programming.order_number,
      'requested_quantity', v_programming.requested_quantity, 'version', v_programming.version),
    jsonb_build_object('supplier_id', p_supplier_id, 'scheduled_at', p_scheduled_at,
      'order_number', v_order_number, 'line_count', v_line_count,
      'requested_quantity', v_total_quantity, 'unit_code', v_unit_code,
      'version', v_programming.version + 1)
  );
  return v_programming.version + 1;
end;
$$;

create function app_private.confirm_programming_core(
  p_programming_id uuid,
  p_actor uuid,
  p_confirmation_source text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_programming public.programming%rowtype;
begin
  select programming.* into v_programming
  from public.programming programming
  where programming.id = p_programming_id for update;
  if not found then raise exception 'PROGRAMMING_NOT_FOUND'; end if;
  if v_programming.status <> 'PENDING_CONFIRMATION' then
    raise exception 'PROGRAMMING_NOT_PENDING_CONFIRMATION';
  end if;
  if nullif(btrim(v_programming.order_number), '') is null then
    raise exception 'PROGRAMMING_ORDER_NUMBER_REQUIRED';
  end if;
  if exists (
    select 1 from public.programming_lines line
    where line.programming_id = v_programming.id
      and nullif(btrim(line.concrete_type), '') is null
  ) then raise exception 'PROGRAMMING_CONCRETE_TYPE_REQUIRED'; end if;

  update public.programming
  set status = 'CONFIRMED', confirmed_quantity = requested_quantity,
      confirmed_at = now(), confirmed_by = p_actor,
      version = version + 1, updated_at = now()
  where id = v_programming.id;

  perform app_private.snapshot_programming(
    v_programming.id, p_actor, 'PROGRAMMING_CONFIRMED', null
  );
  insert into public.audit_events (
    actor_user_id, project_id, entity_type, entity_id,
    action, old_values, new_values
  ) values (
    p_actor, v_programming.project_id, 'programming', v_programming.id,
    'PROGRAMMING_CONFIRMED',
    jsonb_build_object('status', v_programming.status,
      'confirmed_quantity', v_programming.confirmed_quantity,
      'version', v_programming.version),
    jsonb_build_object('status', 'CONFIRMED',
      'confirmed_quantity', v_programming.requested_quantity,
      'version', v_programming.version + 1,
      'confirmation_source', p_confirmation_source)
  );
  return v_programming.version + 1;
end;
$$;

create or replace function public.confirm_programming(
  p_programming_id uuid,
  p_confirmed_quantity numeric,
  p_expected_version integer,
  p_notes text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_programming public.programming%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_expected_version is null then raise exception 'PROGRAMMING_EXPECTED_VERSION_REQUIRED'; end if;
  select programming.* into v_programming
  from public.programming programming
  where programming.id = p_programming_id for update;
  if not found then raise exception 'PROGRAMMING_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_programming.project_id, 'programming.confirm') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_programming.version <> p_expected_version then raise exception 'PROGRAMMING_VERSION_CONFLICT'; end if;
  return app_private.confirm_programming_core(
    p_programming_id, v_actor, 'DIRECT_PHASE1'
  );
end;
$$;

create or replace function public.create_programming_batch(p_project_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_item record;
  v_supplier_id uuid;
  v_scheduled_at timestamptz;
  v_ids jsonb := '[]'::jsonb;
  v_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app_private.has_project_permission(p_project_id, 'programming.create') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 250 then
    raise exception 'PROGRAMMING_BATCH_INVALID';
  end if;

  for v_item in
    select item.value, item.position
    from jsonb_array_elements(p_items) with ordinality as item(value, position)
  loop
    begin
      v_supplier_id := (v_item.value ->> 'supplier_id')::uuid;
      v_scheduled_at := (v_item.value ->> 'scheduled_at')::timestamptz;
    exception when others then
      raise exception 'PROGRAMMING_BATCH_ROW_INVALID:%', v_item.position;
    end;
    if v_scheduled_at <= clock_timestamp()
       or nullif(btrim(v_item.value ->> 'order_number'), '') is null
       or jsonb_typeof(v_item.value -> 'lines') <> 'array' then
      raise exception 'PROGRAMMING_BATCH_ROW_INVALID:%', v_item.position;
    end if;
    perform valid.line_count
    from app_private.validate_programming_lines_payload(v_item.value -> 'lines') valid;
    if exists (
      select 1 from jsonb_array_elements(v_item.value -> 'lines') line(value)
      where jsonb_typeof(line.value -> 'concrete_type') <> 'string'
         or nullif(btrim(line.value ->> 'concrete_type'), '') is null
    ) then raise exception 'PROGRAMMING_BATCH_ROW_INVALID:%', v_item.position; end if;
    if not exists (
      select 1 from public.project_suppliers relation
      join public.suppliers supplier
        on supplier.id = relation.supplier_id and supplier.company_id = relation.company_id
      where relation.project_id = p_project_id
        and relation.supplier_id = v_supplier_id
        and relation.active and supplier.active
    ) then raise exception 'PROGRAMMING_BATCH_SUPPLIER_INVALID:%', v_item.position; end if;
  end loop;

  for v_item in
    select item.value, item.position
    from jsonb_array_elements(p_items) with ordinality as item(value, position)
  loop
    v_id := public.create_programming_with_details(
      p_project_id,
      (v_item.value ->> 'supplier_id')::uuid,
      (v_item.value ->> 'scheduled_at')::timestamptz,
      v_item.value -> 'lines',
      v_item.value ->> 'order_number',
      v_item.value ->> 'notes'
    );
    perform app_private.confirm_programming_core(
      v_id, v_actor, 'APPROVED_MIXTO_WORKBOOK'
    );
    v_ids := v_ids || jsonb_build_array(v_id);
  end loop;
  return jsonb_build_object('programming_ids', v_ids);
end;
$$;

create or replace function public.start_dispatch(
  p_programming_id uuid,
  p_arrival_at timestamptz,
  p_received_by_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_programming public.programming%rowtype;
  v_company_id uuid;
  v_dispatch_id uuid;
  v_receiver_name text := nullif(btrim(p_received_by_name), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_arrival_at is null then raise exception 'DISPATCH_ARRIVAL_REQUIRED'; end if;
  select programming.* into v_programming
  from public.programming programming
  join public.projects project on project.id = programming.project_id
  where programming.id = p_programming_id and project.status = 'ACTIVE'
  for update of programming;
  if not found then raise exception 'PROGRAMMING_NOT_FOUND'; end if;
  if v_programming.status not in ('CONFIRMED', 'IN_EXECUTION') then
    raise exception 'DISPATCH_PROGRAMMING_INVALID_STATE';
  end if;
  if not app_private.has_project_permission(v_programming.project_id, 'dispatch.create') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if exists (select 1 from public.dispatches dispatch where dispatch.programming_id = v_programming.id) then
    raise exception 'PROGRAMMING_DISPATCH_ALREADY_EXISTS';
  end if;
  select project.company_id into v_company_id
  from public.projects project where project.id = v_programming.project_id;
  if not exists (
    select 1 from public.suppliers supplier
    where supplier.id = v_programming.supplier_id
      and supplier.company_id = v_company_id and supplier.active
  ) or not exists (
    select 1 from public.project_suppliers relation
    where relation.project_id = v_programming.project_id
      and relation.company_id = v_company_id
      and relation.supplier_id = v_programming.supplier_id and relation.active
  ) then raise exception 'DISPATCH_SUPPLIER_NOT_AVAILABLE'; end if;
  if v_receiver_name is null then
    select nullif(btrim(profile.full_name), '') into v_receiver_name
    from public.profiles profile where profile.id = v_actor and profile.active;
  end if;
  if v_receiver_name is null then raise exception 'RECEIVER_NAME_REQUIRED'; end if;

  begin
    insert into public.dispatches (
      project_id, supplier_id, programming_id, status, result, version,
      created_by, arrival_at, received_by, received_by_name, order_number
    ) values (
      v_programming.project_id, v_programming.supplier_id, v_programming.id,
      'IN_EXECUTION', null, 1, v_actor, p_arrival_at, v_actor,
      v_receiver_name, v_programming.order_number
    ) returning id into v_dispatch_id;
  exception when unique_violation then
    raise exception 'PROGRAMMING_DISPATCH_ALREADY_EXISTS';
  end;

  if v_programming.status = 'CONFIRMED' then
    update public.programming set status = 'IN_EXECUTION',
      version = version + 1, updated_at = now()
    where id = v_programming.id;
    perform app_private.snapshot_programming(
      v_programming.id, v_actor, 'PROGRAMMING_IN_EXECUTION',
      'Despacho operativo iniciado.'
    );
  end if;
  insert into public.audit_events (
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_programming.project_id, 'dispatch',
    v_dispatch_id, 'DISPATCH_STARTED', jsonb_build_object(
      'programming_id', v_programming.id, 'status', 'IN_EXECUTION',
      'arrival_at', p_arrival_at, 'received_by_name', v_receiver_name,
      'order_number', v_programming.order_number
    )
  );
  return v_dispatch_id;
end;
$$;

alter function public.create_programming_with_details(uuid,uuid,timestamptz,jsonb,text,text) owner to postgres;
alter function public.update_programming_with_details(uuid,integer,uuid,timestamptz,jsonb,text,text) owner to postgres;
alter function app_private.confirm_programming_core(uuid,uuid,text) owner to postgres;

revoke all on function public.create_programming_with_details(uuid,uuid,timestamptz,jsonb,text,text) from public, anon;
revoke all on function public.update_programming_with_details(uuid,integer,uuid,timestamptz,jsonb,text,text) from public, anon;
revoke all on function app_private.confirm_programming_core(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.create_programming_with_details(uuid,uuid,timestamptz,jsonb,text,text) to authenticated, service_role;
grant execute on function public.update_programming_with_details(uuid,integer,uuid,timestamptz,jsonb,text,text) to authenticated, service_role;

commit;
