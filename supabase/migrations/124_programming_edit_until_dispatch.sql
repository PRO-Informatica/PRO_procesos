-- Authorized edits remain available until a dispatch exists, irrespective of
-- calendar day. Keep reasons, revisions, version conflicts and reconfirmation.
-- Manual backdated creation stays restricted; historical reconfirmation needs
-- a matching edit revision for the exact pending version.
begin;

create or replace function app_private.guard_programming_future_schedule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_timezone text;
  v_today date;
  v_scheduled_date date;
  v_edit_source text := current_setting('app.programming_edit_source', true);
  v_confirmation_source text := current_setting(
    'app.programming_confirmation_source', true
  );
begin
  if new.scheduled_at is null or not isfinite(new.scheduled_at) then
    raise exception 'PROGRAMMING_SCHEDULE_REQUIRED';
  end if;

  select coalesce(nullif(btrim(project.timezone), ''), 'America/Guatemala')
  into v_timezone
  from public.projects project
  where project.id = new.project_id;

  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_scheduled_date := (new.scheduled_at at time zone v_timezone)::date;

  -- Approved workbooks may create historical rows. Once created, status-only
  -- updates must remain usable by start_dispatch and programming completion.
  -- Manual creation or changing the date to a past day remains restricted.
  if v_scheduled_date < v_today
     and v_confirmation_source is distinct from 'APPROVED_MIXTO_WORKBOOK'
     and v_edit_source is distinct from 'AUTHORIZED_EDIT' then
    if tg_op = 'INSERT' then
      raise exception 'PROGRAMMING_SCHEDULE_DATE_IN_PAST';
    elsif new.scheduled_at is distinct from old.scheduled_at then
      raise exception 'PROGRAMMING_SCHEDULE_DATE_IN_PAST';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.scheduled_at is distinct from old.scheduled_at
     and old.status = 'PENDING_CONFIRMATION'
     and v_edit_source is distinct from 'AUTHORIZED_EDIT'
     and (old.scheduled_at at time zone v_timezone)::date <= v_today then
    raise exception 'PROGRAMMING_EDIT_WINDOW_CLOSED';
  end if;

  if tg_op = 'UPDATE'
     and new.status = 'CONFIRMED'
     and old.status is distinct from new.status
     and v_confirmation_source is distinct from 'APPROVED_MIXTO_WORKBOOK'
     and new.scheduled_at <= clock_timestamp()
     and not exists (
       select 1 from public.programming_revisions revision
       where revision.programming_id = old.id
         and revision.programming_version = old.version
         and revision.action = 'PROGRAMMING_UPDATED'
         and revision.status = 'PENDING_CONFIRMATION'
     ) then
    raise exception 'PROGRAMMING_SCHEDULE_MUST_BE_FUTURE';
  end if;

  return new;
end;
$$;

create or replace function app_private.guard_programming_delivery_modes()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  new.delivery_modes := app_private.normalize_programming_delivery_modes(new.delivery_modes);
  if tg_op = 'UPDATE' and new.delivery_modes is distinct from old.delivery_modes then
    if auth.uid() is null or not app_private.has_project_permission(old.project_id,'programming.modify') then
      raise exception 'PERMISSION_DENIED';
    end if;
    if old.status not in ('PENDING_CONFIRMATION','CONFIRMED')
       or exists(select 1 from public.dispatches where programming_id = old.id)
       or (old.status = 'CONFIRMED' and new.status <> 'PENDING_CONFIRMATION') then
      raise exception 'PROGRAMMING_DELIVERY_MODES_LOCKED';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.update_programming_with_details(
  p_programming_id uuid,
  p_expected_version integer,
  p_supplier_id uuid,
  p_scheduled_at timestamptz,
  p_lines jsonb,
  p_order_number text,
  p_reason text,
  p_notes text default null,
  p_delivery_modes text[] default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_programming public.programming%rowtype;
  v_previous_edit_source text := current_setting('app.programming_edit_source', true);
  v_line_count integer;
  v_total_quantity numeric(12,3);
  v_unit_code text;
  v_order_number text := nullif(btrim(p_order_number), '');
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_expected_version is null then raise exception 'PROGRAMMING_EXPECTED_VERSION_REQUIRED'; end if;
  if v_reason is null then raise exception 'PROGRAMMING_EDIT_REASON_REQUIRED'; end if;
  if char_length(v_reason) > 1000 then raise exception 'PROGRAMMING_EDIT_REASON_TOO_LONG'; end if;

  select programming.* into v_programming
  from public.programming programming
  where programming.id = p_programming_id
  for update;

  if not found then raise exception 'PROGRAMMING_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_programming.project_id, 'programming.modify') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_programming.version <> p_expected_version then
    raise exception 'PROGRAMMING_VERSION_CONFLICT';
  end if;
  if v_programming.status not in ('PENDING_CONFIRMATION', 'CONFIRMED') then
    raise exception 'PROGRAMMING_NOT_EDITABLE';
  end if;
  if exists (
    select 1 from public.dispatches dispatch
    where dispatch.programming_id = v_programming.id
  ) then
    raise exception 'PROGRAMMING_EDIT_HAS_DISPATCHES';
  end if;
  if v_order_number is null then raise exception 'PROGRAMMING_ORDER_NUMBER_REQUIRED'; end if;

  if p_scheduled_at is null or not isfinite(p_scheduled_at) then
    raise exception 'PROGRAMMING_SCHEDULE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.project_suppliers relation
    join public.suppliers supplier
      on supplier.id = relation.supplier_id
     and supplier.company_id = relation.company_id
    where relation.project_id = v_programming.project_id
      and relation.supplier_id = p_supplier_id
      and relation.active
      and supplier.active
  ) then
    raise exception 'SUPPLIER_NOT_AVAILABLE';
  end if;

  select valid.line_count, valid.total_quantity, valid.unit_code
  into v_line_count, v_total_quantity, v_unit_code
  from app_private.validate_programming_lines_payload(p_lines) valid;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) item(value)
    where jsonb_typeof(item.value -> 'concrete_type') <> 'string'
       or nullif(btrim(item.value ->> 'concrete_type'), '') is null
       or char_length(btrim(item.value ->> 'concrete_type')) > 160
  ) then
    raise exception 'PROGRAMMING_CONCRETE_TYPE_REQUIRED';
  end if;

  perform set_config('app.programming_edit_source', 'AUTHORIZED_EDIT', true);

  -- The line guard intentionally locks confirmed records. Moving the record
  -- back to pending inside the same locked transaction allows the authorized
  -- edit while ensuring every changed value must be confirmed again.
  if v_programming.status = 'CONFIRMED' then
    update public.programming
    set status = 'PENDING_CONFIRMATION',
        confirmed_quantity = null,
        confirmed_at = null,
        confirmed_by = null,
        updated_at = now()
    where id = v_programming.id;
  end if;

  update public.programming_lines line
  set unit_code = v_unit_code
  where line.programming_id = v_programming.id
    and line.project_id = v_programming.project_id
    and line.unit_code is distinct from v_unit_code;

  insert into public.programming_lines (
    project_id, programming_id, quantity, unit_code, concrete_type, position
  )
  select v_programming.project_id, v_programming.id,
    (item.value ->> 'quantity')::numeric(12,3),
    btrim(item.value ->> 'unit_code'),
    btrim(item.value ->> 'concrete_type'),
    item.position::integer
  from jsonb_array_elements(p_lines) with ordinality as item(value, position)
  on conflict on constraint programming_lines_position_uq
  do update set quantity = excluded.quantity,
    unit_code = excluded.unit_code,
    concrete_type = excluded.concrete_type;

  delete from public.programming_lines line
  where line.programming_id = v_programming.id
    and line.project_id = v_programming.project_id
    and line.position > v_line_count;

  update public.programming
  set delivery_modes = app_private.normalize_programming_delivery_modes(coalesce(p_delivery_modes,v_programming.delivery_modes)),
      supplier_id = p_supplier_id,
      scheduled_at = p_scheduled_at,
      order_number = v_order_number,
      notes = nullif(btrim(p_notes), ''),
      status = 'PENDING_CONFIRMATION',
      confirmed_quantity = null,
      confirmed_at = null,
      confirmed_by = null,
      version = version + 1,
      updated_at = now()
  where id = v_programming.id;

  perform app_private.snapshot_programming(
    v_programming.id,
    v_actor,
    'PROGRAMMING_UPDATED',
    v_reason
  );

  insert into public.audit_events (
    actor_user_id, project_id, entity_type, entity_id,
    action, old_values, new_values, comment
  ) values (
    v_actor, v_programming.project_id, 'programming', v_programming.id,
    'PROGRAMMING_UPDATED',
    jsonb_build_object(
      'delivery_modes', v_programming.delivery_modes,
      'supplier_id', v_programming.supplier_id,
      'scheduled_at', v_programming.scheduled_at,
      'order_number', v_programming.order_number,
      'requested_quantity', v_programming.requested_quantity,
      'confirmed_quantity', v_programming.confirmed_quantity,
      'status', v_programming.status,
      'version', v_programming.version
    ),
    jsonb_build_object(
      'delivery_modes', app_private.normalize_programming_delivery_modes(coalesce(p_delivery_modes,v_programming.delivery_modes)),
      'supplier_id', p_supplier_id,
      'scheduled_at', p_scheduled_at,
      'order_number', v_order_number,
      'line_count', v_line_count,
      'requested_quantity', v_total_quantity,
      'confirmed_quantity', null,
      'unit_code', v_unit_code,
      'status', 'PENDING_CONFIRMATION',
      'version', v_programming.version + 1
    ),
    v_reason
  );

  perform set_config('app.programming_edit_source', coalesce(v_previous_edit_source, ''), true);
  return v_programming.version + 1;
end;
$$;

notify pgrst,'reload schema';
commit;
