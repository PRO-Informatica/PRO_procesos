-- 051_programming_lines.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Adds homogeneous repeated quantity/unit lines to Programming while keeping
-- the existing requested_quantity and unit_code columns as synchronized
-- compatibility rollups. Existing create_programming callers remain valid
-- through a one-line wrapper.

begin;

-- ============================================================
-- 1. PRECONDITIONS
-- ============================================================

do $$
begin
  if to_regclass('public.programming') is null
     or to_regclass('public.units_of_measure') is null
     or to_regclass('public.projects') is null
     or to_regclass('public.suppliers') is null
     or to_regclass('public.project_suppliers') is null
     or to_regclass('public.audit_events') is null then
    raise exception 'PROGRAMMING_LINES_REQUIRED_RELATION_MISSING';
  end if;

  if to_regclass('public.programming_lines') is not null then
    raise exception 'PROGRAMMING_LINES_ALREADY_EXISTS';
  end if;

  if to_regprocedure(
    'public.create_programming(uuid,uuid,timestamptz,numeric,text,text,boolean,uuid,text)'
  ) is null then
    raise exception 'CREATE_PROGRAMMING_LEGACY_SIGNATURE_MISSING';
  end if;
end;
$$;

-- ============================================================
-- 2. PROGRAMMING LINES
-- ============================================================

create table public.programming_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  programming_id uuid not null,
  quantity numeric(12,3) not null,
  unit_code text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint programming_lines_programming_project_fk
    foreign key (programming_id, project_id)
    references public.programming(id, project_id)
    on delete restrict,

  constraint programming_lines_unit_code_fk
    foreign key (unit_code)
    references public.units_of_measure(code)
    on delete restrict,

  constraint programming_lines_quantity_ck
    check (quantity > 0),

  constraint programming_lines_position_ck
    check (position > 0),

  constraint programming_lines_position_uq
    unique (programming_id, position)
);

create index idx_programming_lines_project
on public.programming_lines(project_id);

-- ============================================================
-- 3. DEFENSIVE BACKFILL
-- ============================================================

-- Each legacy programming becomes one line using only its existing scalar
-- quantity and unit. No product identity or other data is invented.
insert into public.programming_lines (
  project_id,
  programming_id,
  quantity,
  unit_code,
  position
)
select
  p.project_id,
  p.id,
  p.requested_quantity,
  p.unit_code,
  1
from public.programming p;

do $$
begin
  if exists (
    select 1
    from public.programming p
    left join public.programming_lines pl
      on pl.programming_id = p.id
     and pl.project_id = p.project_id
    group by p.id
    having count(pl.id) = 0
  ) then
    raise exception 'PROGRAMMING_LINES_BACKFILL_INCOMPLETE';
  end if;
end;
$$;

-- ============================================================
-- 4. LINE GUARD
-- ============================================================

create or replace function app_private.guard_programming_line()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_programming_id uuid;
  v_project_id uuid;
  v_status public.programming_status;
begin
  if tg_op = 'DELETE' then
    v_programming_id := old.programming_id;
    v_project_id := old.project_id;
  else
    v_programming_id := new.programming_id;
    v_project_id := new.project_id;
  end if;

  if tg_op = 'UPDATE'
     and (new.programming_id, new.project_id) is distinct from
         (old.programming_id, old.project_id) then
    raise exception 'PROGRAMMING_LINE_REPARENT_NOT_ALLOWED';
  end if;

  select p.status
  into v_status
  from public.programming p
  where p.id = v_programming_id
    and p.project_id = v_project_id;

  if not found then
    raise exception 'PROGRAMMING_NOT_FOUND';
  end if;

  if v_status not in ('DRAFT', 'PENDING_CONFIRMATION') then
    raise exception 'PROGRAMMING_LINES_LOCKED';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if not exists (
      select 1
      from public.units_of_measure u
      where u.code = btrim(new.unit_code)
        and u.active = true
    ) then
      raise exception 'INVALID_OR_INACTIVE_UNIT_OF_MEASURE';
    end if;

    new.unit_code := btrim(new.unit_code);

    if tg_op = 'UPDATE' then
      new.updated_at := now();
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

alter function app_private.guard_programming_line()
owner to postgres;

revoke all
on function app_private.guard_programming_line()
from public;

create trigger programming_lines_guard
before insert or update or delete
on public.programming_lines
for each row
execute function app_private.guard_programming_line();

-- ============================================================
-- 5. ROLLUP SYNCHRONIZATION
-- ============================================================

create or replace function app_private.sync_programming_line_rollup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_programming_id uuid;
  v_line_count integer;
  v_total_quantity numeric(12,3);
  v_unit_count integer;
  v_unit_code text;
begin
  if tg_op = 'DELETE' then
    v_programming_id := old.programming_id;
  else
    v_programming_id := new.programming_id;
  end if;

  select
    count(*)::integer,
    sum(pl.quantity)::numeric(12,3),
    count(distinct pl.unit_code)::integer,
    min(pl.unit_code)
  into
    v_line_count,
    v_total_quantity,
    v_unit_count,
    v_unit_code
  from public.programming_lines pl
  where pl.programming_id = v_programming_id;

  if v_line_count = 0 then
    raise exception 'PROGRAMMING_REQUIRES_LINE';
  end if;

  if v_unit_count <> 1 then
    raise exception 'PROGRAMMING_MIXED_UNITS_NOT_SUPPORTED';
  end if;

  update public.programming
  set requested_quantity = v_total_quantity,
      unit_code = v_unit_code,
      updated_at = now()
  where id = v_programming_id;

  if not found then
    raise exception 'PROGRAMMING_NOT_FOUND';
  end if;

  -- The return value of an AFTER trigger is ignored.
  return null;
end;
$$;

alter function app_private.sync_programming_line_rollup()
owner to postgres;

revoke all
on function app_private.sync_programming_line_rollup()
from public;

create trigger programming_lines_rollup
after insert or update or delete
on public.programming_lines
for each row
execute function app_private.sync_programming_line_rollup();

-- ============================================================
-- 6. LEGACY SCALAR DIVERGENCE GUARD
-- ============================================================

create or replace function app_private.guard_programming_line_rollup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_line_count integer;
  v_total_quantity numeric(12,3);
  v_unit_count integer;
  v_unit_code text;
begin
  select
    count(*)::integer,
    sum(pl.quantity)::numeric(12,3),
    count(distinct pl.unit_code)::integer,
    min(pl.unit_code)
  into
    v_line_count,
    v_total_quantity,
    v_unit_count,
    v_unit_code
  from public.programming_lines pl
  where pl.programming_id = new.id;

  -- Parent creation intentionally happens before its lines inside the RPC.
  -- This UPDATE-only guard therefore does not block the temporary state.
  if v_line_count = 0 then
    return new;
  end if;

  if v_unit_count <> 1 then
    raise exception 'PROGRAMMING_MIXED_UNITS_NOT_SUPPORTED';
  end if;

  if new.requested_quantity is distinct from v_total_quantity
     or btrim(new.unit_code) is distinct from v_unit_code then
    raise exception 'PROGRAMMING_LINE_ROLLUP_MISMATCH';
  end if;

  new.unit_code := btrim(new.unit_code);
  return new;
end;
$$;

alter function app_private.guard_programming_line_rollup()
owner to postgres;

revoke all
on function app_private.guard_programming_line_rollup()
from public;

create trigger programming_line_rollup_guard
before update of requested_quantity, unit_code
on public.programming
for each row
execute function app_private.guard_programming_line_rollup();

-- No immediate parent INSERT trigger is added. Creation is transactional and
-- restricted to the RPCs below; authenticated browser users receive no direct
-- INSERT/UPDATE/DELETE access to programming_lines. Deleting the final line is
-- rejected by sync_programming_line_rollup().

-- ============================================================
-- 7. RLS / GRANTS
-- ============================================================

alter table public.programming_lines
enable row level security;

create policy programming_lines_select
on public.programming_lines
for select
to authenticated
using (
  app_private.is_project_member(project_id)
  or app_private.has_project_permission(
    project_id,
    'programming.view'
  )
);

create policy platform_admin_read_programming_lines
on public.programming_lines
for select
to authenticated
using (
  app_private.is_platform_admin()
);

revoke all
on public.programming_lines
from public, anon, authenticated;

grant select
on public.programming_lines
to authenticated;

grant all
on public.programming_lines
to service_role;

-- Browser clients receive no INSERT/UPDATE/DELETE policies. Mutations remain
-- transactional RPC operations.

-- ============================================================
-- 8. MULTI-LINE CREATION RPC
-- ============================================================

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
  v_unit_count integer;
  v_unit_code text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.status = 'ACTIVE'
  ) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if not app_private.has_project_permission(
    p_project_id,
    'programming.create'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if not exists (
    select 1
    from public.project_suppliers ps
    join public.suppliers s
      on s.id = ps.supplier_id
     and s.company_id = ps.company_id
    where ps.project_id = p_project_id
      and ps.supplier_id = p_supplier_id
      and ps.active = true
      and s.active = true
  ) then
    raise exception 'SUPPLIER_NOT_AVAILABLE';
  end if;

  if p_scheduled_at is null then
    raise exception 'PROGRAMMING_SCHEDULE_REQUIRED';
  end if;

  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'PROGRAMMING_REQUIRES_LINE';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) item(value)
    where jsonb_typeof(item.value) <> 'object'
       or jsonb_typeof(item.value -> 'quantity') <> 'number'
       or (item.value ->> 'quantity')::numeric <= 0
       or jsonb_typeof(item.value -> 'unit_code') <> 'string'
       or nullif(btrim(item.value ->> 'unit_code'), '') is null
  ) then
    raise exception 'INVALID_PROGRAMMING_LINE';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) item(value)
    left join public.units_of_measure u
      on u.code = btrim(item.value ->> 'unit_code')
     and u.active = true
    where u.code is null
  ) then
    raise exception 'INVALID_OR_INACTIVE_UNIT_OF_MEASURE';
  end if;

  select
    count(*)::integer,
    sum((item.value ->> 'quantity')::numeric)::numeric(12,3),
    count(distinct btrim(item.value ->> 'unit_code'))::integer,
    min(btrim(item.value ->> 'unit_code'))
  into
    v_line_count,
    v_total_quantity,
    v_unit_count,
    v_unit_code
  from jsonb_array_elements(p_lines) item(value);

  if v_unit_count <> 1 then
    raise exception 'PROGRAMMING_MIXED_UNITS_NOT_SUPPORTED';
  end if;

  insert into public.programming (
    project_id,
    supplier_id,
    created_by,
    scheduled_at,
    requested_quantity,
    unit_code,
    placement_group,
    requires_pumping,
    estimated_work_item_id,
    status,
    notes
  )
  values (
    p_project_id,
    p_supplier_id,
    v_actor,
    p_scheduled_at,
    v_total_quantity,
    v_unit_code,
    nullif(btrim(p_placement_group), ''),
    coalesce(p_requires_pumping, false),
    p_work_item_id,
    'DRAFT',
    nullif(btrim(p_notes), '')
  )
  returning id into v_programming_id;

  insert into public.programming_lines (
    project_id,
    programming_id,
    quantity,
    unit_code,
    position
  )
  select
    p_project_id,
    v_programming_id,
    (item.value ->> 'quantity')::numeric(12,3),
    btrim(item.value ->> 'unit_code'),
    item.position::integer
  from jsonb_array_elements(p_lines)
       with ordinality as item(value, position);

  insert into public.audit_events (
    actor_user_id,
    project_id,
    entity_type,
    entity_id,
    action,
    new_values
  )
  values (
    v_actor,
    p_project_id,
    'programming',
    v_programming_id,
    'PROGRAMMING_CREATED',
    jsonb_build_object(
      'supplier_id', p_supplier_id,
      'scheduled_at', p_scheduled_at,
      'line_count', v_line_count,
      'requested_quantity', v_total_quantity,
      'unit_code', v_unit_code,
      'status', 'DRAFT'
    )
  );

  return v_programming_id;
end;
$$;

alter function public.create_programming_with_lines(
  uuid,
  uuid,
  timestamptz,
  jsonb,
  text,
  text,
  boolean,
  uuid
)
owner to postgres;

revoke all
on function public.create_programming_with_lines(
  uuid,
  uuid,
  timestamptz,
  jsonb,
  text,
  text,
  boolean,
  uuid
)
from public, anon;

grant execute
on function public.create_programming_with_lines(
  uuid,
  uuid,
  timestamptz,
  jsonb,
  text,
  text,
  boolean,
  uuid
)
to authenticated, service_role;

-- ============================================================
-- 9. LEGACY SINGLE-LINE WRAPPER
-- ============================================================

create or replace function public.create_programming(
  p_project_id uuid,
  p_supplier_id uuid,
  p_scheduled_at timestamptz,
  p_requested_quantity numeric,
  p_unit_code text,
  p_placement_group text default null,
  p_requires_pumping boolean default false,
  p_work_item_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  return public.create_programming_with_lines(
    p_project_id,
    p_supplier_id,
    p_scheduled_at,
    jsonb_build_array(
      jsonb_build_object(
        'quantity', p_requested_quantity,
        'unit_code', p_unit_code
      )
    ),
    p_notes,
    p_placement_group,
    p_requires_pumping,
    p_work_item_id
  );
end;
$$;

alter function public.create_programming(
  uuid,
  uuid,
  timestamptz,
  numeric,
  text,
  text,
  boolean,
  uuid,
  text
)
owner to postgres;

revoke all
on function public.create_programming(
  uuid,
  uuid,
  timestamptz,
  numeric,
  text,
  text,
  boolean,
  uuid,
  text
)
from public, anon;

grant execute
on function public.create_programming(
  uuid,
  uuid,
  timestamptz,
  numeric,
  text,
  text,
  boolean,
  uuid,
  text
)
to authenticated, service_role;

-- ============================================================
-- 10. INTENTIONALLY UNCHANGED
-- ============================================================

-- confirmed_quantity remains an aggregate scalar. The existing
-- confirm_programming() behavior remains valid:
--   confirmed_quantity = coalesce(confirmed_quantity, requested_quantity)
--
-- This migration intentionally does not modify:
--   public.confirm_programming(uuid)
--   public.close_programming(uuid)
--   public.programming_revisions
--   public.register_dispatch_with_lines(...)
--   dashboard queries

commit;
