begin;

-- Validate the final document type because manual entry saves details after its lines.
alter table public.dispatch_guide_lines
  drop constraint dispatch_guide_lines_quantity_ck,
  add constraint dispatch_guide_lines_quantity_ck check (quantity >= 0);

create function app_private.check_dispatch_guide_zero_quantity()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_guide_id uuid;
  v_document_type text;
begin
  if tg_table_name = 'dispatch_guides' then
    v_guide_id := new.id;
  else
    v_guide_id := new.guide_id;
  end if;

  select guide.details ->> 'documentType' into v_document_type
  from public.dispatch_guides guide where guide.id = v_guide_id for no key update;

  if found and v_document_type is distinct from 'DISPATCH_GUIDE' and exists (
    select 1 from public.dispatch_guide_lines line
    where line.guide_id = v_guide_id and line.quantity = 0
  ) then
    raise exception 'DISPATCH_GUIDE_ZERO_QUANTITY_NOT_ALLOWED';
  end if;
  return null;
end;
$$;

revoke all on function app_private.check_dispatch_guide_zero_quantity() from public, anon, authenticated, service_role;

create constraint trigger dispatch_guide_lines_zero_quantity_guard
after insert or update of quantity on public.dispatch_guide_lines
deferrable initially deferred
for each row when (new.quantity = 0)
execute function app_private.check_dispatch_guide_zero_quantity();

create constraint trigger dispatch_guides_zero_quantity_type_guard
after update of details on public.dispatch_guides
deferrable initially deferred
for each row when ((old.details ->> 'documentType') is distinct from (new.details ->> 'documentType'))
execute function app_private.check_dispatch_guide_zero_quantity();

create function pg_temp.patch_guide_programming_function(p_signature regprocedure, p_before text, p_after text)
returns void language plpgsql as $$
declare
  v_definition text := pg_get_functiondef(p_signature);
begin
  if (length(v_definition) - length(replace(v_definition, p_before, ''))) <> length(p_before) then
    raise exception 'GUIDE_PROGRAMMING_PREREQUISITE_CHANGED: %', p_signature;
  end if;
  execute replace(v_definition, p_before, p_after);
end;
$$;

select pg_temp.patch_guide_programming_function(
  'app_private.resolve_dispatch_guide_lines(uuid,text,jsonb,uuid)',
  $old$if v_quantity <= 0 then$old$,
  $new$if v_quantity is null or v_quantity < 0
       or (v_quantity = 0 and (v_item ->> 'quantity')::numeric <> 0) then$new$
);

select pg_temp.patch_guide_programming_function(
  'app_private.resolve_ocr_guide_lines(uuid,text,jsonb)',
  $old$if qty<=0 or$old$,
  $new$if qty < 0 or (qty = 0 and (item ->> 'quantity')::numeric <> 0) or$new$
);

select pg_temp.patch_guide_programming_function(
  'public.complete_dispatch(uuid,integer)',
  $old$              and line.quantity > 0
              -- A missing commercial line UM does not invalidate a guide.$old$,
  $new$              and line.quantity >= 0
              -- The document type determines whether an informational zero is allowed.$new$
);

select pg_temp.patch_guide_programming_function(
  'public.reconcile_dispatch_service(uuid)',
  $old$where guide.dispatch_id=v_dispatch.id and guide.project_id=v_dispatch.project_id and line.catalog_type='SERVICE';$old$,
  $new$where guide.dispatch_id=v_dispatch.id and guide.project_id=v_dispatch.project_id
    and line.catalog_type='SERVICE' and line.quantity > 0;$new$
);

-- Once a dispatch has an arrival, use that recorded day for its operation.
-- Correcting the planned date must not move an arrival or its guides.
select pg_temp.patch_guide_programming_function(
  'app_private.guard_dispatch_programming_day()',
  $old$  select max(truck_departure_at) into v_guide_departure$old$,
  $new$  if tg_op = 'UPDATE' and old.arrival_at is not null
     and (new.programming_id, new.project_id) = (old.programming_id, old.project_id) then
    v_programming_date := (old.arrival_at at time zone v_timezone)::date;
  end if;
  select max(truck_departure_at) into v_guide_departure$new$
);

select pg_temp.patch_guide_programming_function(
  'app_private.guard_programming_line()',
  $old$  if v_status not in ('DRAFT', 'PENDING_CONFIRMATION') then
    raise exception 'PROGRAMMING_LINES_LOCKED';
  end if;$old$,
  $new$  if v_status not in ('DRAFT', 'PENDING_CONFIRMATION')
     and not (
       v_status in ('IN_EXECUTION', 'DISPATCH_COMPLETED', 'COMPLETED')
       and current_setting('app.programming_edit_source', true) is not distinct from 'AUTHORIZED_EDIT'
       and app_private.is_company_admin((select company_id from public.projects where id = v_project_id))
     ) then
    raise exception 'PROGRAMMING_LINES_LOCKED';
  end if;$new$
);

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
returns integer language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_programming public.programming%rowtype;
  v_dispatch_id uuid;
  v_target_status public.programming_status;
  v_delivery_modes text[];
  v_previous_edit_source text := current_setting('app.programming_edit_source', true);
  v_line_count integer;
  v_total_quantity numeric(12,3);
  v_unit_code text;
  v_order_number text := nullif(btrim(p_order_number), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_notes text := nullif(btrim(p_notes), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_expected_version is null then raise exception 'PROGRAMMING_EXPECTED_VERSION_REQUIRED'; end if;
  if v_reason is null then raise exception 'PROGRAMMING_EDIT_REASON_REQUIRED'; end if;
  if char_length(v_reason) > 1000 then raise exception 'PROGRAMMING_EDIT_REASON_TOO_LONG'; end if;

  -- start_dispatch locks the same parent before checking or creating a dispatch.
  select programming.* into v_programming
  from public.programming programming where programming.id = p_programming_id for update;
  if not found then raise exception 'PROGRAMMING_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_programming.project_id, 'programming.modify') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_programming.version <> p_expected_version then
    raise exception 'PROGRAMMING_VERSION_CONFLICT';
  end if;

  select dispatch.id into v_dispatch_id from public.dispatches dispatch
  where dispatch.programming_id = v_programming.id and dispatch.project_id = v_programming.project_id;
  v_delivery_modes := app_private.normalize_programming_delivery_modes(
    coalesce(p_delivery_modes, v_programming.delivery_modes)
  );

  if v_dispatch_id is not null then
    if not app_private.is_company_admin((select company_id from public.projects where id = v_programming.project_id)) then
      raise exception 'PROGRAMMING_STARTED_EDIT_REQUIRES_ADMIN';
    end if;
    if v_programming.status not in ('IN_EXECUTION', 'DISPATCH_COMPLETED', 'COMPLETED') then
      raise exception 'PROGRAMMING_NOT_EDITABLE';
    end if;
    if p_supplier_id is distinct from v_programming.supplier_id then
      raise exception 'PROGRAMMING_STARTED_SUPPLIER_LOCKED';
    end if;
    if v_delivery_modes is distinct from v_programming.delivery_modes then
      raise exception 'PROGRAMMING_DELIVERY_MODES_LOCKED';
    end if;
    v_target_status := v_programming.status;
  else
    if v_programming.status not in ('PENDING_CONFIRMATION', 'CONFIRMED') then
      raise exception 'PROGRAMMING_NOT_EDITABLE';
    end if;
    if not exists (
      select 1
      from public.project_suppliers relation
      join public.suppliers supplier on supplier.id = relation.supplier_id
        and supplier.company_id = relation.company_id
      where relation.project_id = v_programming.project_id
        and relation.supplier_id = p_supplier_id and relation.active and supplier.active
    ) then
      raise exception 'SUPPLIER_NOT_AVAILABLE';
    end if;
    v_target_status := 'CONFIRMED';
  end if;

  if v_order_number is null then raise exception 'PROGRAMMING_ORDER_NUMBER_REQUIRED'; end if;
  if p_scheduled_at is null or not isfinite(p_scheduled_at) then
    raise exception 'PROGRAMMING_SCHEDULE_REQUIRED';
  end if;
  select valid.line_count, valid.total_quantity, valid.unit_code
  into v_line_count, v_total_quantity, v_unit_code
  from app_private.validate_programming_lines_payload(p_lines) valid;
  if v_dispatch_id is not null and v_unit_code is distinct from v_programming.unit_code then
    raise exception 'PROGRAMMING_STARTED_UNIT_LOCKED';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) item(value)
    where jsonb_typeof(item.value -> 'concrete_type') is distinct from 'string'
       or nullif(btrim(item.value ->> 'concrete_type'), '') is null
       or char_length(btrim(item.value ->> 'concrete_type')) > 160
  ) then
    raise exception 'PROGRAMMING_CONCRETE_TYPE_REQUIRED';
  end if;

  perform set_config('app.programming_edit_source', 'AUTHORIZED_EDIT', true);

  -- Unstarted edits still reconfirm atomically. Started edits retain status and confirmation.
  if v_dispatch_id is null and v_programming.status = 'CONFIRMED' then
    update public.programming
    set status = 'PENDING_CONFIRMATION', confirmed_quantity = null,
        confirmed_at = null, confirmed_by = null, updated_at = now()
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
    (item.value ->> 'quantity')::numeric(12,3), btrim(item.value ->> 'unit_code'),
    btrim(item.value ->> 'concrete_type'), item.position::integer
  from jsonb_array_elements(p_lines) with ordinality as item(value, position)
  on conflict on constraint programming_lines_position_uq
  do update set quantity = excluded.quantity, unit_code = excluded.unit_code,
    concrete_type = excluded.concrete_type;

  delete from public.programming_lines line
  where line.programming_id = v_programming.id
    and line.project_id = v_programming.project_id and line.position > v_line_count;

  update public.programming
  set delivery_modes = v_delivery_modes,
      supplier_id = p_supplier_id,
      scheduled_at = p_scheduled_at,
      order_number = v_order_number,
      notes = v_notes,
      status = v_target_status,
      confirmed_quantity = v_total_quantity,
      confirmed_at = case when v_dispatch_id is null then now() else v_programming.confirmed_at end,
      confirmed_by = case when v_dispatch_id is null then v_actor else v_programming.confirmed_by end,
      version = version + 1,
      updated_at = now()
  where id = v_programming.id;

  perform app_private.snapshot_programming(v_programming.id, v_actor, 'PROGRAMMING_UPDATED', v_reason);
  insert into public.audit_events (
    actor_user_id, project_id, entity_type, entity_id, action, old_values, new_values, comment
  ) values (
    v_actor, v_programming.project_id, 'programming', v_programming.id, 'PROGRAMMING_UPDATED',
    jsonb_build_object(
      'delivery_modes', v_programming.delivery_modes, 'supplier_id', v_programming.supplier_id,
      'scheduled_at', v_programming.scheduled_at, 'order_number', v_programming.order_number,
      'requested_quantity', v_programming.requested_quantity,
      'confirmed_quantity', v_programming.confirmed_quantity, 'notes', v_programming.notes,
      'status', v_programming.status, 'version', v_programming.version
    ),
    jsonb_build_object(
      'delivery_modes', v_delivery_modes, 'supplier_id', p_supplier_id,
      'scheduled_at', p_scheduled_at, 'order_number', v_order_number, 'line_count', v_line_count,
      'requested_quantity', v_total_quantity, 'confirmed_quantity', v_total_quantity,
      'unit_code', v_unit_code, 'notes', v_notes, 'status', v_target_status,
      'confirmation_source', case when v_dispatch_id is null then 'AUTOMATIC_EDIT' end,
      'dispatch_id', v_dispatch_id, 'version', v_programming.version + 1
    ),
    v_reason
  );
  perform set_config('app.programming_edit_source', coalesce(v_previous_edit_source, ''), true);
  return v_programming.version + 1;
end;
$$;

notify pgrst, 'reload schema';
commit;
