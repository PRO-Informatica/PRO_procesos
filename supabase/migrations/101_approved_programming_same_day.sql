-- 101_approved_programming_same_day.sql
-- Approved workbook imports may confirm an earlier time on the current
-- project-local day. Manual confirmation keeps its existing time rule.

begin;

do $$
begin
  if to_regprocedure('app_private.guard_programming_future_schedule()') is null
     or to_regprocedure('public.create_programming_batch(uuid,jsonb)') is null
     or to_regprocedure('app_private.confirm_programming_core(uuid,uuid,text)') is null
     or to_regclass('public.projects') is null then
    raise exception 'APPROVED_PROGRAMMING_SAME_DAY_REQUIRED_CONTRACT_MISSING';
  end if;
end;
$$;

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
  v_confirmation_source text := current_setting(
    'app.programming_confirmation_source', true
  );
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
     and v_confirmation_source is distinct from 'APPROVED_MIXTO_WORKBOOK'
     and new.scheduled_at <= clock_timestamp() then
    raise exception 'PROGRAMMING_SCHEDULE_MUST_BE_FUTURE';
  end if;

  return new;
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
      v_item.value ->> 'notes'
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

comment on function public.create_programming_batch(uuid,jsonb) is
  'Atomically creates approved workbook rows; current project-local day is allowed regardless of time.';

commit;
