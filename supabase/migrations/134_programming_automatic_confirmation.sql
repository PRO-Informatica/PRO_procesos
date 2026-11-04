-- Automatic confirmation for creation/editing; separate operational and final closure.
-- Keeps dispatch statuses, billing rules, authorization and optimistic versions.
begin;


CREATE OR REPLACE FUNCTION app_private.guard_programming_future_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
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

  -- Confirmation now belongs to creation/editing, not a separate temporal gate.
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.create_programming_with_details(p_project_id uuid, p_supplier_id uuid, p_scheduled_at timestamp with time zone, p_lines jsonb, p_order_number text, p_notes text DEFAULT NULL::text, p_delivery_modes text[] DEFAULT '{}'::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
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

  -- Lines use the pending parent only inside this transaction. No unconfirmed
  -- programming is committed or exposed to another user.
  update public.programming
  set status='CONFIRMED', confirmed_quantity=v_total_quantity,
      confirmed_at=now(), confirmed_by=v_actor
  where id=v_programming_id;

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
      'status', 'CONFIRMED', 'version', 1, 'confirmation_source', 'AUTOMATIC_CREATION',
      'delivery_modes', app_private.normalize_programming_delivery_modes(p_delivery_modes)
    )
  );
  return v_programming_id;
end;
$function$;


CREATE OR REPLACE FUNCTION app_private.confirm_programming_core(p_programming_id uuid, p_actor uuid, p_confirmation_source text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_programming public.programming%rowtype;
begin
  select programming.* into v_programming
  from public.programming programming
  where programming.id = p_programming_id for update;
  if not found then raise exception 'PROGRAMMING_NOT_FOUND'; end if;
  -- Bulk creation still invokes this helper. The create RPC already confirmed it.
  if v_programming.status = 'CONFIRMED' then return v_programming.version; end if;
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
$function$;


CREATE OR REPLACE FUNCTION public.update_programming_with_details(p_programming_id uuid, p_expected_version integer, p_supplier_id uuid, p_scheduled_at timestamp with time zone, p_lines jsonb, p_order_number text, p_reason text, p_notes text DEFAULT NULL::text, p_delivery_modes text[] DEFAULT NULL::text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
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
  -- edit. The final update confirms all changed values before commit.
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
      status = 'CONFIRMED',
      confirmed_quantity = v_total_quantity,
      confirmed_at = now(),
      confirmed_by = v_actor,
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
      'confirmed_quantity', v_total_quantity,
      'unit_code', v_unit_code,
      'status', 'CONFIRMED',
      'confirmation_source', 'AUTOMATIC_EDIT',
      'version', v_programming.version + 1
    ),
    v_reason
  );

  perform set_config('app.programming_edit_source', coalesce(v_previous_edit_source, ''), true);
  return v_programming.version + 1;
end;
$function$;


create or replace function app_private.sync_programming_completion_from_dispatch(p_dispatch_id uuid)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_programming public.programming%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_target public.programming_status;
  v_actor uuid;
  v_company_id uuid;
  v_action text;
  v_reason text;
begin
  select * into v_dispatch from public.dispatches where id=p_dispatch_id;
  if not found then return false; end if;
  select * into v_programming from public.programming
    where id=v_dispatch.programming_id and project_id=v_dispatch.project_id for update;
  -- Never reopen a final/cancelled programming as a side effect of a late invoice.
  if not found or v_programming.status not in ('IN_EXECUTION','DISPATCH_COMPLETED') then return false; end if;
  if exists(select 1 from public.dispatches where programming_id=v_programming.id
    and project_id=v_programming.project_id and status<>'COMPLETED') then
    v_target:='IN_EXECUTION';
  elsif not exists(select 1 from public.dispatches where programming_id=v_programming.id
    and project_id=v_programming.project_id and not app_private.dispatch_billing_complete(id)) then
    v_target:='COMPLETED';
  else
    v_target:='DISPATCH_COMPLETED';
  end if;
  if v_target=v_programming.status then return false; end if;
  v_actor:=coalesce(auth.uid(),v_programming.created_by);
  select company_id into v_company_id from public.projects where id=v_programming.project_id;
  v_action:=case v_target when 'COMPLETED' then 'PROGRAMMING_COMPLETED'
    when 'DISPATCH_COMPLETED' then 'PROGRAMMING_DISPATCH_COMPLETED' else 'PROGRAMMING_IN_EXECUTION' end;
  v_reason:=case v_target when 'COMPLETED' then 'Cierre automático: despacho completado, Producto conciliado y facturas requeridas según modalidad.'
    when 'DISPATCH_COMPLETED' then 'El despacho está completo. El cierre final de la programación espera la conciliación y las facturas requeridas.'
    else 'El despacho continúa en ejecución.' end;
  update public.programming set status=v_target,version=version+1,updated_at=now()
    where id=v_programming.id;
  perform app_private.snapshot_programming(v_programming.id,v_actor,v_action,v_reason);
  insert into public.audit_events(actor_user_id,company_id,project_id,entity_type,entity_id,
    action,old_values,new_values,comment)
  values(v_actor,v_company_id,v_programming.project_id,'programming',v_programming.id,
    case when v_target='COMPLETED' then 'PROGRAMMING_AUTO_COMPLETED' else v_action end,
    jsonb_build_object('status',v_programming.status,'version',v_programming.version),
    jsonb_build_object('status',v_target,'version',v_programming.version+1,
      'dispatch_id',v_dispatch.id,'delivery_modes',v_programming.delivery_modes,
      'completion_source',case when v_target='COMPLETED' then 'DISPATCH_INVOICES_RECONCILED' else 'DISPATCH_OPERATION' end),v_reason);
  return true;
end;
$$;
alter function app_private.sync_programming_completion_from_dispatch(uuid) owner to postgres;
revoke all on function app_private.sync_programming_completion_from_dispatch(uuid) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.close_programming(p_programming_id uuid, p_expected_version integer, p_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app_private'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_programming public.programming%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_dispatch_count integer;
  v_dispatches_without_result integer;
  v_dispatches_without_guide integer;
  v_target_quantity numeric(12,3);
  v_received_quantity numeric(12,3);
  v_remaining numeric(12,3);
  v_excess numeric(12,3);
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_expected_version is null then
    raise exception 'PROGRAMMING_EXPECTED_VERSION_REQUIRED';
  end if;

  select p.*
  into v_programming
  from public.programming p
  where p.id = p_programming_id
  for update;

  if not found then
    raise exception 'PROGRAMMING_NOT_FOUND';
  end if;

  if not app_private.has_project_permission(
    v_programming.project_id,
    'programming.close'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if v_programming.version <> p_expected_version then
    raise exception 'PROGRAMMING_VERSION_CONFLICT';
  end if;

  if v_programming.status not in ('IN_EXECUTION','DISPATCH_COMPLETED') then
    raise exception 'PROGRAMMING_NOT_IN_EXECUTION';
  end if;

  select
    count(*)::integer,
    (count(*) filter (where d.result is null))::integer
  into
    v_dispatch_count,
    v_dispatches_without_result
  from public.dispatches d
  where d.programming_id = v_programming.id
    and d.project_id = v_programming.project_id;

  if v_dispatch_count = 0 then
    raise exception 'PROGRAMMING_REQUIRES_DISPATCH';
  end if;

  if v_dispatches_without_result > 0 then
    raise exception 'PROGRAMMING_DISPATCH_RESULT_REQUIRED';
  end if;

  select count(*)::integer
  into v_dispatches_without_guide
  from public.dispatches d
  where d.programming_id = v_programming.id
    and d.project_id = v_programming.project_id
    and not exists (
      select 1
      from public.dispatch_guides dg
      where dg.dispatch_id = d.id
        and dg.project_id = d.project_id
    );

  if v_dispatches_without_guide > 0 then
    raise exception 'PROGRAMMING_DISPATCH_GUIDE_MISSING';
  end if;

  v_target_quantity := coalesce(
    v_programming.confirmed_quantity,
    v_programming.requested_quantity
  );

  select coalesce(sum(dg.quantity), 0)::numeric(12,3)
  into v_received_quantity
  from public.dispatches d
  join public.dispatch_guides dg
    on dg.dispatch_id = d.id
   and dg.project_id = d.project_id
  where d.programming_id = v_programming.id
    and d.project_id = v_programming.project_id;

  v_remaining := greatest(
    v_target_quantity - v_received_quantity,
    0
  );
  v_excess := greatest(
    v_received_quantity - v_target_quantity,
    0
  );

  if (v_remaining > 0 or v_excess > 0)
     and v_reason is null then
    raise exception 'PROGRAMMING_CLOSE_REASON_REQUIRED';
  end if;

  update public.programming
  set status = 'COMPLETED',
      version = version + 1,
      updated_at = now()
  where id = v_programming.id;

  perform app_private.snapshot_programming(
    v_programming.id,
    v_actor,
    'PROGRAMMING_COMPLETED',
    v_reason
  );

  insert into public.audit_events (
    actor_user_id,
    project_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values,
    comment
  )
  values (
    v_actor,
    v_programming.project_id,
    'programming',
    v_programming.id,
    'PROGRAMMING_COMPLETED',
    jsonb_build_object(
      'status', v_programming.status,
      'version', v_programming.version
    ),
    jsonb_build_object(
      'status', 'COMPLETED',
      'version', v_programming.version + 1,
      'target_quantity', v_target_quantity,
      'received_quantity', v_received_quantity,
      'remaining', v_remaining,
      'excess', v_excess,
      'reason', v_reason
    ),
    v_reason
  );

  return v_programming.version + 1;
end;
$function$;


-- Explicitly requested backfill. Keep every original record and revision;
-- append an automatic-confirmation revision/audit instead of rewriting history.
do $$
declare p public.programming%rowtype; d record;
begin
  for p in select * from public.programming where status='PENDING_CONFIRMATION' order by id for update loop
    update public.programming set status='CONFIRMED',confirmed_quantity=requested_quantity,
      confirmed_at=now(),confirmed_by=created_by,version=version+1,updated_at=now() where id=p.id;
    perform app_private.snapshot_programming(p.id,p.created_by,'PROGRAMMING_AUTO_CONFIRMED',
      'Confirmación automática al eliminar el paso de confirmación manual.');
    insert into public.audit_events(actor_user_id,project_id,entity_type,entity_id,action,old_values,new_values,comment)
    values(p.created_by,p.project_id,'programming',p.id,'PROGRAMMING_AUTO_CONFIRMED',
      jsonb_build_object('status',p.status,'version',p.version),
      jsonb_build_object('status','CONFIRMED','version',p.version+1,'confirmation_source','STATUS_WORKFLOW_MIGRATION'),
      'Cambio de flujo solicitado: las programaciones se confirman automáticamente.');
  end loop;
  for d in select dispatch.id from public.dispatches dispatch
    join public.programming programming on programming.id=dispatch.programming_id
    where programming.status in ('IN_EXECUTION','DISPATCH_COMPLETED') order by dispatch.id loop
    perform app_private.sync_programming_completion_from_dispatch(d.id);
  end loop;
end;
$$;
notify pgrst,'reload schema';
commit;
