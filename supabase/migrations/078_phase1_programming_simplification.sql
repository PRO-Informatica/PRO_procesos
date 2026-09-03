-- 078_phase1_programming_simplification.sql
-- APPLIED CORRECTLY — EXECUTED MANUALLY.
--
-- Phase 1 Programming flow:
--   * new manual and bulk records start in PENDING_CONFIRMATION;
--   * historical DRAFT rows and the enum value are preserved;
--   * pending records are editable only before their scheduled local day;
--   * confirmation is direct and keeps confirmed_quantity = requested_quantity
--     for compatibility with Dispatch, dashboard and reporting consumers;
--   * Mixto Listo workbook rows are persisted atomically through one RPC.

begin;

do $$
begin
  if to_regclass('public.programming') is null
     or to_regclass('public.programming_lines') is null
     or to_regclass('public.project_suppliers') is null
     or to_regclass('public.projects') is null
     or to_regprocedure(
       'app_private.validate_programming_lines_payload(jsonb)'
     ) is null
     or to_regprocedure(
       'app_private.snapshot_programming(uuid,uuid,text,text)'
     ) is null
     or to_regprocedure(
       'app_private.guard_programming_future_schedule()'
     ) is null then
    raise exception 'PROGRAMMING_PHASE1_REQUIRED_CONTRACT_MISSING';
  end if;
end;
$$;

-- Calendar-day authority. Creation may target today in the Project timezone;
-- editing an existing pending record is allowed only through the previous day.
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
begin
  if new.scheduled_at is null then
    raise exception 'PROGRAMMING_SCHEDULE_REQUIRED';
  end if;

  select coalesce(nullif(btrim(project.timezone), ''), 'America/Guatemala')
  into v_timezone
  from public.projects project
  where project.id = new.project_id;

  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_scheduled_date := (new.scheduled_at at time zone v_timezone)::date;

  if v_scheduled_date < v_today then
    raise exception 'PROGRAMMING_SCHEDULE_DATE_IN_PAST';
  end if;

  if tg_op = 'UPDATE'
     and new.scheduled_at is distinct from old.scheduled_at
     and old.status = 'PENDING_CONFIRMATION'
     and (old.scheduled_at at time zone v_timezone)::date <= v_today then
    raise exception 'PROGRAMMING_EDIT_WINDOW_CLOSED';
  end if;

  if tg_op = 'UPDATE'
     and new.status = 'CONFIRMED'
     and old.status is distinct from new.status
     and new.scheduled_at <= clock_timestamp() then
    raise exception 'PROGRAMMING_SCHEDULE_MUST_BE_FUTURE';
  end if;

  return new;
end;
$$;

alter function app_private.guard_programming_future_schedule() owner to postgres;
revoke all on function app_private.guard_programming_future_schedule()
from public, anon, authenticated, service_role;

create or replace function public.create_programming_with_lines(
  p_project_id uuid,
  p_supplier_id uuid,
  p_scheduled_at timestamptz,
  p_lines jsonb,
  p_notes text default null,
  p_placement_group text default null,
  p_requires_pumping boolean default false,
  p_work_item_id uuid default null
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
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.projects project
    where project.id = p_project_id and project.status = 'ACTIVE'
  ) then raise exception 'PROJECT_NOT_FOUND'; end if;
  if not app_private.has_project_permission(
    p_project_id, 'programming.create'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if not exists (
    select 1
    from public.project_suppliers project_supplier
    join public.suppliers supplier
      on supplier.id = project_supplier.supplier_id
     and supplier.company_id = project_supplier.company_id
    where project_supplier.project_id = p_project_id
      and project_supplier.supplier_id = p_supplier_id
      and project_supplier.active
      and supplier.active
  ) then raise exception 'SUPPLIER_NOT_AVAILABLE'; end if;
  if p_scheduled_at is null then
    raise exception 'PROGRAMMING_SCHEDULE_REQUIRED';
  end if;

  select validated.line_count, validated.total_quantity, validated.unit_code
  into v_line_count, v_total_quantity, v_unit_code
  from app_private.validate_programming_lines_payload(p_lines) validated;

  insert into public.programming(
    project_id, supplier_id, created_by, scheduled_at,
    requested_quantity, unit_code, placement_group, requires_pumping,
    estimated_work_item_id, status, notes
  ) values (
    p_project_id, p_supplier_id, v_actor, p_scheduled_at,
    v_total_quantity, v_unit_code, nullif(btrim(p_placement_group), ''),
    coalesce(p_requires_pumping, false), p_work_item_id,
    'PENDING_CONFIRMATION', nullif(btrim(p_notes), '')
  ) returning id into v_programming_id;

  insert into public.programming_lines(
    project_id, programming_id, quantity, unit_code, position
  )
  select p_project_id, v_programming_id,
    (item.value ->> 'quantity')::numeric(12,3),
    btrim(item.value ->> 'unit_code'), item.position::integer
  from jsonb_array_elements(p_lines)
       with ordinality as item(value, position);

  perform app_private.snapshot_programming(
    v_programming_id, v_actor, 'PROGRAMMING_CREATED', null
  );
  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id, action, new_values
  ) values (
    v_actor, p_project_id, 'programming', v_programming_id,
    'PROGRAMMING_CREATED', jsonb_build_object(
      'supplier_id', p_supplier_id,
      'scheduled_at', p_scheduled_at,
      'line_count', v_line_count,
      'requested_quantity', v_total_quantity,
      'unit_code', v_unit_code,
      'status', 'PENDING_CONFIRMATION',
      'version', 1
    )
  );
  return v_programming_id;
end;
$$;

create or replace function public.update_programming_with_lines(
  p_programming_id uuid,
  p_expected_version integer,
  p_supplier_id uuid,
  p_scheduled_at timestamptz,
  p_lines jsonb,
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
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_expected_version is null then
    raise exception 'PROGRAMMING_EXPECTED_VERSION_REQUIRED';
  end if;

  select programming.* into v_programming
  from public.programming programming
  where programming.id = p_programming_id for update;
  if not found then raise exception 'PROGRAMMING_NOT_FOUND'; end if;
  if not app_private.has_project_permission(
    v_programming.project_id, 'programming.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_programming.version <> p_expected_version then
    raise exception 'PROGRAMMING_VERSION_CONFLICT';
  end if;
  if v_programming.status <> 'PENDING_CONFIRMATION' then
    raise exception 'PROGRAMMING_NOT_EDITABLE';
  end if;

  select coalesce(nullif(btrim(project.timezone), ''), 'America/Guatemala')
  into v_timezone from public.projects project
  where project.id = v_programming.project_id;
  v_today := (clock_timestamp() at time zone v_timezone)::date;
  if (v_programming.scheduled_at at time zone v_timezone)::date <= v_today
     or (p_scheduled_at at time zone v_timezone)::date <= v_today then
    raise exception 'PROGRAMMING_EDIT_WINDOW_CLOSED';
  end if;

  if not exists (
    select 1
    from public.project_suppliers project_supplier
    join public.suppliers supplier
      on supplier.id = project_supplier.supplier_id
     and supplier.company_id = project_supplier.company_id
    where project_supplier.project_id = v_programming.project_id
      and project_supplier.supplier_id = p_supplier_id
      and project_supplier.active and supplier.active
  ) then raise exception 'SUPPLIER_NOT_AVAILABLE'; end if;

  select validated.line_count, validated.total_quantity, validated.unit_code
  into v_line_count, v_total_quantity, v_unit_code
  from app_private.validate_programming_lines_payload(p_lines) validated;

  update public.programming_lines line
  set unit_code = v_unit_code
  where line.programming_id = v_programming.id
    and line.project_id = v_programming.project_id
    and line.unit_code is distinct from v_unit_code;

  insert into public.programming_lines(
    project_id, programming_id, quantity, unit_code, position
  )
  select v_programming.project_id, v_programming.id,
    (item.value ->> 'quantity')::numeric(12,3),
    btrim(item.value ->> 'unit_code'), item.position::integer
  from jsonb_array_elements(p_lines)
       with ordinality as item(value, position)
  on conflict on constraint programming_lines_position_uq
  do update set quantity = excluded.quantity, unit_code = excluded.unit_code;

  delete from public.programming_lines line
  where line.programming_id = v_programming.id
    and line.project_id = v_programming.project_id
    and line.position > v_line_count;

  update public.programming
  set supplier_id = p_supplier_id,
      scheduled_at = p_scheduled_at,
      notes = nullif(btrim(p_notes), ''),
      version = version + 1,
      updated_at = now()
  where id = v_programming.id;

  perform app_private.snapshot_programming(
    v_programming.id, v_actor, 'PROGRAMMING_UPDATED', null
  );
  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id,
    action, old_values, new_values
  ) values (
    v_actor, v_programming.project_id, 'programming', v_programming.id,
    'PROGRAMMING_UPDATED',
    jsonb_build_object(
      'supplier_id', v_programming.supplier_id,
      'scheduled_at', v_programming.scheduled_at,
      'requested_quantity', v_programming.requested_quantity,
      'unit_code', v_programming.unit_code,
      'version', v_programming.version
    ),
    jsonb_build_object(
      'supplier_id', p_supplier_id,
      'scheduled_at', p_scheduled_at,
      'line_count', v_line_count,
      'requested_quantity', v_total_quantity,
      'unit_code', v_unit_code,
      'version', v_programming.version + 1
    )
  );
  return v_programming.version + 1;
end;
$$;

-- Retain the established signature, but confirmation is now one decision.
-- The two legacy input fields are intentionally ignored for compatibility.
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
  if p_expected_version is null then
    raise exception 'PROGRAMMING_EXPECTED_VERSION_REQUIRED';
  end if;
  select programming.* into v_programming
  from public.programming programming
  where programming.id = p_programming_id for update;
  if not found then raise exception 'PROGRAMMING_NOT_FOUND'; end if;
  if not app_private.has_project_permission(
    v_programming.project_id, 'programming.confirm'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_programming.version <> p_expected_version then
    raise exception 'PROGRAMMING_VERSION_CONFLICT';
  end if;
  if v_programming.status <> 'PENDING_CONFIRMATION' then
    raise exception 'PROGRAMMING_NOT_PENDING_CONFIRMATION';
  end if;

  update public.programming
  set status = 'CONFIRMED',
      confirmed_quantity = requested_quantity,
      confirmed_at = now(),
      confirmed_by = v_actor,
      version = version + 1,
      updated_at = now()
  where id = v_programming.id;

  perform app_private.snapshot_programming(
    v_programming.id, v_actor, 'PROGRAMMING_CONFIRMED', null
  );
  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id,
    action, old_values, new_values
  ) values (
    v_actor, v_programming.project_id, 'programming', v_programming.id,
    'PROGRAMMING_CONFIRMED',
    jsonb_build_object(
      'status', v_programming.status,
      'confirmed_quantity', v_programming.confirmed_quantity,
      'version', v_programming.version
    ),
    jsonb_build_object(
      'status', 'CONFIRMED',
      'confirmed_quantity', v_programming.requested_quantity,
      'version', v_programming.version + 1,
      'confirmation_source', 'DIRECT_PHASE1'
    )
  );
  return v_programming.version + 1;
end;
$$;

-- The caller sends already-previewed rows. The first pass validates the whole
-- payload; the second creates it. Any exception rolls the complete batch back.
create function public.create_programming_batch(p_project_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_item record;
  v_supplier_id uuid;
  v_scheduled_at timestamptz;
  v_ids jsonb := '[]'::jsonb;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 250 then
    raise exception 'PROGRAMMING_BATCH_INVALID';
  end if;

  for v_item in
    select item.value, item.position
    from jsonb_array_elements(p_items)
         with ordinality as item(value, position)
  loop
    begin
      v_supplier_id := (v_item.value ->> 'supplier_id')::uuid;
      v_scheduled_at := (v_item.value ->> 'scheduled_at')::timestamptz;
    exception when others then
      raise exception 'PROGRAMMING_BATCH_ROW_INVALID:%', v_item.position;
    end;
    if not exists (
      select 1 from public.project_suppliers project_supplier
      join public.suppliers supplier
        on supplier.id = project_supplier.supplier_id
       and supplier.company_id = project_supplier.company_id
      where project_supplier.project_id = p_project_id
        and project_supplier.supplier_id = v_supplier_id
        and project_supplier.active and supplier.active
    ) then
      raise exception 'PROGRAMMING_BATCH_SUPPLIER_INVALID:%', v_item.position;
    end if;
    perform validated.line_count
    from app_private.validate_programming_lines_payload(
      v_item.value -> 'lines'
    ) validated;
    if v_scheduled_at is null then
      raise exception 'PROGRAMMING_BATCH_ROW_INVALID:%', v_item.position;
    end if;
  end loop;

  for v_item in
    select item.value, item.position
    from jsonb_array_elements(p_items)
         with ordinality as item(value, position)
  loop
    v_id := public.create_programming_with_lines(
      p_project_id,
      (v_item.value ->> 'supplier_id')::uuid,
      (v_item.value ->> 'scheduled_at')::timestamptz,
      v_item.value -> 'lines',
      v_item.value ->> 'notes',
      null, false, null
    );
    v_ids := v_ids || jsonb_build_array(v_id);
  end loop;
  return jsonb_build_object('programming_ids', v_ids);
end;
$$;

alter function public.create_programming_with_lines(
  uuid,uuid,timestamptz,jsonb,text,text,boolean,uuid
) owner to postgres;
alter function public.update_programming_with_lines(
  uuid,integer,uuid,timestamptz,jsonb,text
) owner to postgres;
alter function public.confirm_programming(uuid,numeric,integer,text)
owner to postgres;
alter function public.create_programming_batch(uuid,jsonb) owner to postgres;

revoke all on function public.create_programming_with_lines(
  uuid,uuid,timestamptz,jsonb,text,text,boolean,uuid
) from public, anon;
revoke all on function public.update_programming_with_lines(
  uuid,integer,uuid,timestamptz,jsonb,text
) from public, anon;
revoke all on function public.confirm_programming(uuid,numeric,integer,text)
from public, anon;
revoke all on function public.create_programming_batch(uuid,jsonb)
from public, anon;
grant execute on function public.create_programming_with_lines(
  uuid,uuid,timestamptz,jsonb,text,text,boolean,uuid
) to authenticated, service_role;
grant execute on function public.update_programming_with_lines(
  uuid,integer,uuid,timestamptz,jsonb,text
) to authenticated, service_role;
grant execute on function public.confirm_programming(uuid,numeric,integer,text)
to authenticated, service_role;
grant execute on function public.create_programming_batch(uuid,jsonb)
to authenticated, service_role;

-- Display labels for Programming actors. Auth email is used only when the
-- operational profile has no full name; UUIDs are never exposed as labels.
create function public.get_programming_actor_labels(p_project_id uuid)
returns table(profile_id uuid, display_label text)
language sql
stable
security definer
set search_path = pg_catalog, public, app_private, auth
as $$
  select profile.id,
    coalesce(
      nullif(btrim(profile.full_name), ''),
      nullif(btrim(auth_user.email), ''),
      'Usuario no disponible'
    )
  from public.profiles profile
  left join auth.users auth_user on auth_user.id = profile.id
  where app_private.has_project_permission(p_project_id, 'programming.view')
    and profile.id in (
      select programming.created_by
      from public.programming programming
      where programming.project_id = p_project_id
      union
      select programming.confirmed_by
      from public.programming programming
      where programming.project_id = p_project_id
        and programming.confirmed_by is not null
      union
      select revision.created_by
      from public.programming_revisions revision
      join public.programming programming on programming.id = revision.programming_id
      where programming.project_id = p_project_id
    );
$$;

alter function public.get_programming_actor_labels(uuid) owner to postgres;
revoke all on function public.get_programming_actor_labels(uuid)
from public, anon;
grant execute on function public.get_programming_actor_labels(uuid)
to authenticated, service_role;

-- Deployment diagnostic: capture current status counts before any future data
-- cleanup. This migration deliberately performs no historical status rewrite.
do $$
declare
  v_counts jsonb;
begin
  select coalesce(jsonb_object_agg(status, quantity), '{}'::jsonb)
  into v_counts
  from (
    select status::text status, count(*) quantity
    from public.programming group by status
  ) current_counts;
  raise notice 'PROGRAMMING_STATUS_COUNTS_BEFORE_PHASE1=%', v_counts;
end;
$$;

commit;

-- Live QA after manual execution:
--   * inspect NOTICE PROGRAMMING_STATUS_COUNTS_BEFORE_PHASE1;
--   * a manual or batch create persists PENDING_CONFIRMATION, never DRAFT;
--   * a date before today (Project timezone) is rejected;
--   * a pending record is editable through the calendar day before delivery;
--   * direct confirmation copies requested_quantity to confirmed_quantity;
--   * one invalid bulk row rolls back every row in that batch;
--   * historical DRAFT rows remain unchanged and queryable.
