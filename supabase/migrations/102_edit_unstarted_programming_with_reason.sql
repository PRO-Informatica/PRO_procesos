-- Allow an unstarted confirmed programming to be edited with a required
-- reason. Every edit returns the record to PENDING_CONFIRMATION so the
-- resulting operational values must be reviewed and confirmed again.

begin;

do $$
begin
  if to_regclass('public.programming') is null
     or to_regclass('public.programming_lines') is null
     or to_regclass('public.dispatches') is null
     or to_regprocedure('app_private.validate_programming_lines_payload(jsonb)') is null
     or to_regprocedure('app_private.snapshot_programming(uuid,uuid,text,text)') is null then
    raise exception 'PROGRAMMING_EDIT_REASON_REQUIRED_CONTRACT_MISSING';
  end if;
end;
$$;

drop function if exists public.update_programming_with_details(
  uuid, integer, uuid, timestamptz, jsonb, text, text
);

create function public.update_programming_with_details(
  p_programming_id uuid,
  p_expected_version integer,
  p_supplier_id uuid,
  p_scheduled_at timestamptz,
  p_lines jsonb,
  p_order_number text,
  p_reason text,
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
  set supplier_id = p_supplier_id,
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
      'supplier_id', v_programming.supplier_id,
      'scheduled_at', v_programming.scheduled_at,
      'order_number', v_programming.order_number,
      'requested_quantity', v_programming.requested_quantity,
      'confirmed_quantity', v_programming.confirmed_quantity,
      'status', v_programming.status,
      'version', v_programming.version
    ),
    jsonb_build_object(
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

alter function public.update_programming_with_details(
  uuid, integer, uuid, timestamptz, jsonb, text, text, text
) owner to postgres;

revoke all on function public.update_programming_with_details(
  uuid, integer, uuid, timestamptz, jsonb, text, text, text
) from public, anon;

grant execute on function public.update_programming_with_details(
  uuid, integer, uuid, timestamptz, jsonb, text, text, text
) to authenticated, service_role;

commit;
