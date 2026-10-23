-- Explicit delivery marks determine required invoices. Product reconciliation
-- is ALWAYS required. Unknown historical modes keep the two-invoice rule.
-- No historical records are reclassified or automatically completed here.
begin;

do $$
begin
  if to_regprocedure('app_private.ensure_batch_month_segment(uuid,date)') is null
     or to_regprocedure('app_private.snapshot_programming(uuid,uuid,text,text)') is null
     or to_regprocedure('app_private.sync_programming_completion_from_dispatch(uuid)') is null
     or to_regclass('public.invoice_recipient_exceptions') is null then
    raise exception 'PROGRAMMING_INVOICE_POLICY_PREREQUISITES_MISSING';
  end if;
end;
$$;

alter table public.programming
  add column delivery_modes text[] not null default '{}'::text[],
  add constraint programming_delivery_modes_ck check (
    delivery_modes <@ array['DIRECT','PUMP','BOOM','PLACEMENT']::text[]
    and array_position(delivery_modes, null) is null
    and coalesce(array_ndims(delivery_modes), 1) = 1
    and cardinality(delivery_modes) <= 4
  );
alter table public.programming_revisions
  add column delivery_modes text[] not null default '{}'::text[];

comment on column public.programming.delivery_modes is
  'Explicit approved delivery marks. Empty means unknown, NOT direct. Only exclusive DIRECT makes Service optional; Product reconciliation remains mandatory.';

create function app_private.normalize_programming_delivery_modes(p_modes text[])
returns text[] language plpgsql immutable
set search_path = pg_catalog
as $$
begin
  if p_modes is null or cardinality(p_modes) > 4
     or coalesce(array_ndims(p_modes),1) <> 1
     or array_position(p_modes,null) is not null
     or not p_modes <@ array['DIRECT','PUMP','BOOM','PLACEMENT']::text[] then
    raise exception 'PROGRAMMING_DELIVERY_MODES_INVALID';
  end if;
  return array(select mode from unnest(array['DIRECT','PUMP','BOOM','PLACEMENT']::text[])
    as modes(mode) where mode = any(p_modes));
end;
$$;

create function app_private.guard_programming_delivery_modes()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_timezone text;
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
    select coalesce(nullif(btrim(timezone),''),'America/Guatemala') into v_timezone
    from public.projects where id=old.project_id;
    if (old.scheduled_at at time zone v_timezone)::date <= (clock_timestamp() at time zone v_timezone)::date then
      raise exception 'PROGRAMMING_EDIT_WINDOW_CLOSED';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_programming_delivery_modes
before insert or update of delivery_modes on public.programming
for each row execute function app_private.guard_programming_delivery_modes();

create function app_private.dispatch_billing_complete(p_dispatch_id uuid)
-- Must see writes made by the statement firing the AFTER triggers.
returns boolean language sql volatile security definer
set search_path = pg_catalog, public, app_private
as $$
  select exists (
    select 1 from public.dispatches dispatch
    join public.programming programming
      on programming.id=dispatch.programming_id and programming.project_id=dispatch.project_id
    join public.dispatch_reconciliations reconciliation
      on reconciliation.dispatch_id=dispatch.id and reconciliation.project_id=dispatch.project_id
    where dispatch.id=p_dispatch_id and dispatch.status='COMPLETED'
      and reconciliation.status='RECONCILED'
      and reconciliation.current_product_invoice_id is not null
      and (programming.delivery_modes = array['DIRECT']::text[]
        or reconciliation.current_service_invoice_id is not null)
      and not exists (
        select 1 from public.invoice_recipient_exceptions exception
        where exception.invoice_id in (reconciliation.current_product_invoice_id,
          reconciliation.current_service_invoice_id) and exception.status='PENDING'
      )
  );
$$;

-- Protect manual RPCs and direct writes too; a client cannot bypass Product
-- reconciliation by calling the old manual close endpoint.
create function app_private.guard_programming_billing_completion()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.status='COMPLETED' and old.status is distinct from new.status then
    if not exists(select 1 from public.dispatches where programming_id=new.id and project_id=new.project_id)
       or exists(select 1 from public.dispatches where programming_id=new.id and project_id=new.project_id
         and not app_private.dispatch_billing_complete(id)) then
      raise exception 'PROGRAMMING_BILLING_INCOMPLETE';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_programming_billing_completion
before update of status on public.programming
for each row execute function app_private.guard_programming_billing_completion();

-- Function definitions below preserve the existing permission, schedule,
-- version, confirmation, revision, fiscal and monthly rollover contracts.
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
    supplier_id, order_number, delivery_modes, requested_quantity, confirmed_quantity,
    unit_code, placement_group, requires_pumping, estimated_work_item_id,
    status, notes, confirmed_at, confirmed_by, change_reason, action, created_by
  ) values (
    v_programming.id, v_revision_no, v_programming.version,
    v_programming.scheduled_at, v_programming.supplier_id,
    v_programming.order_number, v_programming.delivery_modes, v_programming.requested_quantity,
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

drop function public.create_programming_with_details(uuid,uuid,timestamptz,jsonb,text,text);

drop function public.update_programming_with_details(uuid,integer,uuid,timestamptz,jsonb,text,text,text);

create function public.create_programming_with_details(
  p_project_id uuid,
  p_supplier_id uuid,
  p_scheduled_at timestamptz,
  p_lines jsonb,
  p_order_number text,
  p_notes text default null,
  p_delivery_modes text[] default '{}'::text[]
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
    requested_quantity, unit_code, status, notes, delivery_modes
  ) values (
    p_project_id, p_supplier_id, v_order_number, v_actor, p_scheduled_at,
    v_total_quantity, v_unit_code, 'PENDING_CONFIRMATION', nullif(btrim(p_notes), ''),
    app_private.normalize_programming_delivery_modes(p_delivery_modes)
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
      'status', 'PENDING_CONFIRMATION', 'version', 1,
      'delivery_modes', app_private.normalize_programming_delivery_modes(p_delivery_modes)
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
  v_timezone text;
  v_today date;
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

  select coalesce(nullif(btrim(project.timezone), ''), 'America/Guatemala')
  into v_timezone
  from public.projects project
  where project.id = v_programming.project_id;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  if (v_programming.scheduled_at at time zone v_timezone)::date <= v_today
     or (p_scheduled_at at time zone v_timezone)::date <= v_today then
    raise exception 'PROGRAMMING_EDIT_WINDOW_CLOSED';
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

  return v_programming.version + 1;
end;
$$;

create or replace function public.create_programming_batch(
  p_project_id uuid,
  p_items jsonb
)
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
  v_timezone text;
  v_today date;
  v_ids jsonb := '[]'::jsonb;
  v_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select coalesce(nullif(btrim(project.timezone), ''), 'America/Guatemala')
  into v_timezone
  from public.projects project
  where project.id = p_project_id and project.status = 'ACTIVE';
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;

  if not app_private.has_project_permission(p_project_id, 'programming.create') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 250 then
    raise exception 'PROGRAMMING_BATCH_INVALID';
  end if;

  v_today := (clock_timestamp() at time zone v_timezone)::date;

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
    if (v_scheduled_at at time zone v_timezone)::date < v_today
       or nullif(btrim(v_item.value ->> 'order_number'), '') is null
       or jsonb_typeof(v_item.value -> 'lines') <> 'array' then
      raise exception 'PROGRAMMING_BATCH_ROW_INVALID:%', v_item.position;
    end if;
    if v_item.value ? 'delivery_modes' then
      if jsonb_typeof(v_item.value -> 'delivery_modes') <> 'array' then
        raise exception 'PROGRAMMING_DELIVERY_MODES_INVALID';
      end if;
      if exists(select 1 from jsonb_array_elements(v_item.value -> 'delivery_modes') mode
        where jsonb_typeof(mode) <> 'string') then
        raise exception 'PROGRAMMING_DELIVERY_MODES_INVALID';
      end if;
      perform app_private.normalize_programming_delivery_modes(array(
        select jsonb_array_elements_text(v_item.value -> 'delivery_modes')));
    end if;
    perform valid.line_count
    from app_private.validate_programming_lines_payload(
      v_item.value -> 'lines'
    ) valid;
    if exists (
      select 1 from jsonb_array_elements(v_item.value -> 'lines') line(value)
      where jsonb_typeof(line.value -> 'concrete_type') <> 'string'
         or nullif(btrim(line.value ->> 'concrete_type'), '') is null
    ) then
      raise exception 'PROGRAMMING_BATCH_ROW_INVALID:%', v_item.position;
    end if;
    if not exists (
      select 1 from public.project_suppliers relation
      join public.suppliers supplier
        on supplier.id = relation.supplier_id
       and supplier.company_id = relation.company_id
      where relation.project_id = p_project_id
        and relation.supplier_id = v_supplier_id
        and relation.active and supplier.active
    ) then
      raise exception 'PROGRAMMING_BATCH_SUPPLIER_INVALID:%', v_item.position;
    end if;
  end loop;

  perform set_config(
    'app.programming_confirmation_source',
    'APPROVED_MIXTO_WORKBOOK',
    true
  );

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
      v_item.value ->> 'notes',
      array(select jsonb_array_elements_text(coalesce(v_item.value -> 'delivery_modes','[]'::jsonb)))
    );
    perform app_private.confirm_programming_core(
      v_id, v_actor, 'APPROVED_MIXTO_WORKBOOK'
    );
    v_ids := v_ids || jsonb_build_array(v_id);
  end loop;

  perform set_config('app.programming_confirmation_source', '', true);
  return jsonb_build_object('programming_ids', v_ids);
end;
$$;

create or replace function app_private.sync_programming_completion_from_dispatch(
  p_dispatch_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_programming public.programming%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_reconciliation public.dispatch_reconciliations%rowtype;
  v_actor uuid;
  v_company_id uuid;
begin
  select dispatch.* into v_dispatch
  from public.dispatches dispatch
  where dispatch.id = p_dispatch_id;
  if not found then return false; end if;

  select programming.* into v_programming
  from public.programming programming
  where programming.id = v_dispatch.programming_id
    and programming.project_id = v_dispatch.project_id
  for update;
  if not found or v_programming.status <> 'IN_EXECUTION' then
    return false;
  end if;

  select reconciliation.* into v_reconciliation
  from public.dispatch_reconciliations reconciliation
  where reconciliation.dispatch_id = v_dispatch.id
    and reconciliation.project_id = v_dispatch.project_id;
  if not found then return false; end if;

  if not app_private.dispatch_billing_complete(v_dispatch.id)
     or exists(select 1 from public.dispatches dispatch
       where dispatch.programming_id=v_programming.id and dispatch.project_id=v_programming.project_id
         and not app_private.dispatch_billing_complete(dispatch.id)) then
    return false;
  end if;

  v_actor := coalesce(auth.uid(), v_programming.created_by);
  select project.company_id into v_company_id
  from public.projects project where project.id = v_programming.project_id;

  update public.programming
  set status = 'COMPLETED', version = version + 1, updated_at = now()
  where id = v_programming.id and status = 'IN_EXECUTION';
  if not found then return false; end if;

  perform app_private.snapshot_programming(
    v_programming.id,
    v_actor,
    'PROGRAMMING_COMPLETED',
    'Cierre automático: despacho completado, Producto conciliado y facturas requeridas según modalidad.'
  );

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values, comment
  ) values (
    v_actor, v_company_id, v_programming.project_id, 'programming',
    v_programming.id, 'PROGRAMMING_AUTO_COMPLETED',
    jsonb_build_object('status', v_programming.status, 'version', v_programming.version),
    jsonb_build_object(
      'status', 'COMPLETED',
      'version', v_programming.version + 1,
      'completion_source', 'DISPATCH_INVOICES_RECONCILED',
      'dispatch_id', v_dispatch.id,
      'recipient_exceptions_resolved', true,
      'delivery_modes', v_programming.delivery_modes,
      'service_invoice_required', v_programming.delivery_modes <> array['DIRECT']::text[]
    ),
    'Despacho completado con Producto conciliado, facturas requeridas según modalidad y decisiones fiscales resueltas.'
  );

  return true;
end;
$$;

create or replace function public.preview_weekly_batch_rollover(
  p_batch_id uuid
)
returns table(
  batch_dispatch_id uuid,
  dispatch_id uuid,
  reconciled boolean,
  rollover_action text,
  rollover_reason text,
  destination_batch_id uuid,
  destination_period_start date,
  destination_period_end date,
  destination_accounting_period date
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_batch public.batches%rowtype;
  v_period record;
  v_destination uuid;
begin
  select * into v_batch from public.batches where id = p_batch_id;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_batch.project_id, 'batch.view')
  then raise exception 'PERMISSION_DENIED'; end if;
  select resolved.* into v_period
  from app_private.resolve_weekly_batch_period(
    v_batch.project_id, v_batch.period_end + 1
  ) resolved;
  select id into v_destination from public.batches
  where project_id = v_batch.project_id
    and period_start = v_period.period_start;

  return query
  select relation.id, relation.dispatch_id,
    coalesce(reconciliation.status::text = 'RECONCILED', false),
    case when app_private.dispatch_billing_complete(relation.dispatch_id)
      then 'STAY' else 'MOVE' end,
    case when app_private.dispatch_billing_complete(relation.dispatch_id)
      then 'Producto conciliado y requisitos de cierre completos'
      else 'Pendiente de conciliación de producto, facturas requeridas o decisiones fiscales' end,
    v_destination, v_period.period_start, v_period.period_end,
    v_period.accounting_period
  from public.batch_dispatches relation
  left join public.dispatch_reconciliations reconciliation
    on reconciliation.dispatch_id = relation.dispatch_id
  where relation.batch_id = v_batch.id and relation.removed_at is null
  order by relation.added_at, relation.id;
end;
$$;

create or replace function public.rollover_weekly_batch(p_batch_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.batches%rowtype;
  v_project uuid;
  v_period record;
  v_destination uuid;
  v_relation record;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select project_id into v_project from public.batches where id = p_batch_id;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_project, 'batch.modify') then raise exception 'PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('batch-period:' || v_project::text, 0));
  select * into v_batch from public.batches where id = p_batch_id for update;
  if v_batch.status <> 'OPEN' then raise exception 'WEEKLY_BATCH_ROLLOVER_STATE_INVALID'; end if;
  select * into v_period from app_private.resolve_weekly_batch_period(v_project, v_batch.period_end + 1);
  v_destination := app_private.ensure_batch_month_segment(v_project, v_period.period_start);
  -- If the next week crosses a month, prepare its second part too. Closing the
  -- first part later reuses the already-open second part without duplicating it.
  if v_period.period_end < date_trunc('week', v_period.period_start)::date + 6 then
    perform app_private.ensure_batch_month_segment(v_project, v_period.period_end + 1);
  end if;
  for v_relation in
    select relation.* from public.batch_dispatches relation
    left join public.dispatch_reconciliations reconciliation on reconciliation.dispatch_id = relation.dispatch_id
    where relation.batch_id = v_batch.id and relation.removed_at is null
      and not app_private.dispatch_billing_complete(relation.dispatch_id)
    for update of relation
  loop
    update public.batch_dispatches set removed_at = now(),
      removal_reason = 'Continuidad de período automática', rolled_to_batch_id = v_destination,
      removal_metadata = jsonb_build_object('source', 'SYSTEM_ROLLOVER') where id = v_relation.id;
    insert into public.batch_dispatches(project_id, batch_id, dispatch_id, added_by,
      assignment_source, removal_metadata)
    values (v_project, v_destination, v_relation.dispatch_id, null, 'SYSTEM',
      jsonb_build_object('source', 'SYSTEM_ROLLOVER', 'from_batch_id', v_batch.id));
  end loop;
  update public.batches set status = 'CLOSED', closed_at = now(), version = version + 1,
    updated_at = now() where id = v_batch.id;
  insert into public.audit_events(actor_user_id, project_id, entity_type, entity_id, action, new_values)
  values (v_actor, v_project, 'batch', v_batch.id, 'WEEKLY_BATCH_CLOSED',
    jsonb_build_object('destination_batch_id', v_destination, 'period_policy', 'MONTH_SEGMENT_V1', 'completion_policy', 'REQUIRED_INVOICES_V1'));
  return v_destination;
end;
$$;

alter function app_private.normalize_programming_delivery_modes(text[]) owner to postgres;
revoke all on function app_private.normalize_programming_delivery_modes(text[]) from public, anon, authenticated, service_role;
alter function app_private.guard_programming_delivery_modes() owner to postgres;
revoke all on function app_private.guard_programming_delivery_modes() from public, anon, authenticated, service_role;
alter function app_private.dispatch_billing_complete(uuid) owner to postgres;
revoke all on function app_private.dispatch_billing_complete(uuid) from public, anon, authenticated, service_role;
alter function app_private.guard_programming_billing_completion() owner to postgres;
revoke all on function app_private.guard_programming_billing_completion() from public, anon, authenticated, service_role;
alter function app_private.sync_programming_completion_from_dispatch(uuid) owner to postgres;
revoke all on function app_private.sync_programming_completion_from_dispatch(uuid) from public, anon, authenticated, service_role;
alter function app_private.snapshot_programming(uuid,uuid,text,text) owner to postgres;
revoke all on function app_private.snapshot_programming(uuid,uuid,text,text) from public, anon, authenticated, service_role;
alter function public.create_programming_with_details(uuid,uuid,timestamptz,jsonb,text,text,text[]) owner to postgres;
revoke all on function public.create_programming_with_details(uuid,uuid,timestamptz,jsonb,text,text,text[]) from public, anon;
grant execute on function public.create_programming_with_details(uuid,uuid,timestamptz,jsonb,text,text,text[]) to authenticated, service_role;
alter function public.update_programming_with_details(uuid,integer,uuid,timestamptz,jsonb,text,text,text,text[]) owner to postgres;
revoke all on function public.update_programming_with_details(uuid,integer,uuid,timestamptz,jsonb,text,text,text,text[]) from public, anon;
grant execute on function public.update_programming_with_details(uuid,integer,uuid,timestamptz,jsonb,text,text,text,text[]) to authenticated, service_role;
alter function public.create_programming_batch(uuid,jsonb) owner to postgres;
revoke all on function public.create_programming_batch(uuid,jsonb) from public, anon;
grant execute on function public.create_programming_batch(uuid,jsonb) to authenticated, service_role;
alter function public.preview_weekly_batch_rollover(uuid) owner to postgres;
revoke all on function public.preview_weekly_batch_rollover(uuid) from public, anon;
grant execute on function public.preview_weekly_batch_rollover(uuid) to authenticated, service_role;
alter function public.rollover_weekly_batch(uuid) owner to postgres;
revoke all on function public.rollover_weekly_batch(uuid) from public, anon;
grant execute on function public.rollover_weekly_batch(uuid) to authenticated, service_role;

comment on function app_private.sync_programming_completion_from_dispatch(uuid) is 'Requires completed operations, reconciled Product, required invoices by explicit delivery mode and resolved fiscal decisions.';

notify pgrst, 'reload schema';
commit;
