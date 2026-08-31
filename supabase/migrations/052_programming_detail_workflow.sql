-- 052_programming_detail_workflow.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Operational Phase 5: versioned Programming Detail workflow.
-- Adds immutable multi-line revisions and transactional, permission-checked
-- commands for edit, submit, correction, confirmation, cancellation and close.
--
-- Intentionally excluded:
--   * Dispatch/Dispatch Guide changes (including register_dispatch_with_lines)
--   * dispatch_guide_lines RLS alignment
--   * incidents, batches, invoices, roles and permission definitions
--   * new programming statuses or per-line confirmed quantities

begin;

-- ============================================================
-- 1. PRECONDITIONS
-- ============================================================

do $$
begin
  if to_regclass('public.programming') is null
     or to_regclass('public.programming_lines') is null
     or to_regclass('public.programming_revisions') is null
     or to_regclass('public.dispatches') is null
     or to_regclass('public.dispatch_guides') is null
     or to_regclass('public.units_of_measure') is null
     or to_regclass('public.project_suppliers') is null
     or to_regclass('public.suppliers') is null
     or to_regclass('public.audit_events') is null then
    raise exception 'PROGRAMMING_DETAIL_REQUIRED_RELATION_MISSING';
  end if;

  if to_regclass('public.programming_revision_lines') is not null then
    raise exception 'PROGRAMMING_REVISION_LINES_ALREADY_EXISTS';
  end if;

  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'programming_revisions'
      and c.column_name = 'action'
  ) then
    raise exception 'PROGRAMMING_REVISION_ACTION_ALREADY_EXISTS';
  end if;

  -- Phase 4 discovery found no revision rows. Abort rather than assigning a
  -- fabricated action to rows that may have appeared since that review.
  if exists (select 1 from public.programming_revisions) then
    raise exception 'PROGRAMMING_REVISIONS_EXISTING_ROWS_REQUIRE_MANUAL_REVIEW';
  end if;

  if to_regprocedure(
    'public.create_programming_with_lines(uuid,uuid,timestamp with time zone,jsonb,text,text,boolean,uuid)'
  ) is null
     or to_regprocedure('public.confirm_programming(uuid)') is null
     or to_regprocedure('public.close_programming(uuid)') is null then
    raise exception 'PROGRAMMING_DETAIL_EXPECTED_RPC_SIGNATURE_MISSING';
  end if;

  if exists (
    select 1
    from public.programming p
    where not exists (
      select 1
      from public.programming_lines pl
      where pl.programming_id = p.id
        and pl.project_id = p.project_id
    )
  ) then
    raise exception 'PROGRAMMING_WITHOUT_LINES_REQUIRES_MANUAL_REVIEW';
  end if;
end;
$$;

-- ============================================================
-- 2. REVISION ACTION + COMPOSITE IDENTITY
-- ============================================================

alter table public.programming_revisions
add column action text;

alter table public.programming_revisions
add constraint programming_revisions_action_ck
check (nullif(btrim(action), '') is not null);

-- Supports an integrity-preserving composite FK from revision lines.
alter table public.programming_revisions
add constraint programming_revisions_id_programming_uq
unique (id, programming_id);

-- ============================================================
-- 3. IMMUTABLE REVISION LINES
-- ============================================================

create table public.programming_revision_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  programming_id uuid not null,
  revision_id uuid not null,
  quantity numeric(12,3) not null,
  unit_code text not null,
  position integer not null,
  created_at timestamptz not null default now(),

  constraint programming_revision_lines_revision_programming_fk
    foreign key (revision_id, programming_id)
    references public.programming_revisions(id, programming_id)
    on delete restrict,

  constraint programming_revision_lines_programming_project_fk
    foreign key (programming_id, project_id)
    references public.programming(id, project_id)
    on delete restrict,

  constraint programming_revision_lines_unit_code_fk
    foreign key (unit_code)
    references public.units_of_measure(code)
    on delete restrict,

  constraint programming_revision_lines_quantity_ck
    check (quantity > 0),

  constraint programming_revision_lines_position_ck
    check (position > 0),

  constraint programming_revision_lines_position_uq
    unique (revision_id, position)
);

create index idx_programming_revision_lines_programming
on public.programming_revision_lines(programming_id, revision_id);

create or replace function app_private.prevent_programming_revision_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  raise exception 'PROGRAMMING_REVISION_IMMUTABLE';
end;
$$;

alter function app_private.prevent_programming_revision_mutation()
owner to postgres;

revoke all
on function app_private.prevent_programming_revision_mutation()
from public;

create trigger programming_revisions_immutable
before update or delete
on public.programming_revisions
for each row
execute function app_private.prevent_programming_revision_mutation();

create trigger programming_revision_lines_immutable
before update or delete
on public.programming_revision_lines
for each row
execute function app_private.prevent_programming_revision_mutation();

-- ============================================================
-- 4. REVISION LINES RLS / GRANTS
-- ============================================================

alter table public.programming_revision_lines
enable row level security;

create policy programming_revision_lines_select
on public.programming_revision_lines
for select
to authenticated
using (
  app_private.is_project_member(project_id)
  or app_private.has_project_permission(
    project_id,
    'programming.view'
  )
);

create policy platform_admin_read_programming_revision_lines
on public.programming_revision_lines
for select
to authenticated
using (
  app_private.is_platform_admin()
);

revoke all
on public.programming_revision_lines
from public, anon, authenticated;

grant select
on public.programming_revision_lines
to authenticated;

grant all
on public.programming_revision_lines
to service_role;

-- Browser clients receive no direct INSERT/UPDATE/DELETE access.

-- ============================================================
-- 5. SHARED LINE PAYLOAD VALIDATION
-- ============================================================

create or replace function app_private.validate_programming_lines_payload(
  p_lines jsonb
)
returns table (
  line_count integer,
  total_quantity numeric(12,3),
  unit_code text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_unit_count integer;
begin
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
       or (item.value ->> 'quantity')::numeric(12,3) <= 0
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
    line_count,
    total_quantity,
    v_unit_count,
    unit_code
  from jsonb_array_elements(p_lines) item(value);

  if v_unit_count <> 1 then
    raise exception 'PROGRAMMING_MIXED_UNITS_NOT_SUPPORTED';
  end if;

  return next;
end;
$$;

alter function app_private.validate_programming_lines_payload(jsonb)
owner to postgres;

revoke all
on function app_private.validate_programming_lines_payload(jsonb)
from public;

-- ============================================================
-- 6. IMMUTABLE SNAPSHOT HELPER
-- ============================================================

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
  v_line_count integer;
begin
  if p_actor is null then
    raise exception 'PROGRAMMING_SNAPSHOT_ACTOR_REQUIRED';
  end if;

  if nullif(btrim(p_action), '') is null then
    raise exception 'PROGRAMMING_SNAPSHOT_ACTION_REQUIRED';
  end if;

  select p.*
  into v_programming
  from public.programming p
  where p.id = p_programming_id;

  if not found then
    raise exception 'PROGRAMMING_NOT_FOUND';
  end if;

  select count(*)::integer
  into v_line_count
  from public.programming_lines pl
  where pl.programming_id = v_programming.id
    and pl.project_id = v_programming.project_id;

  if v_line_count = 0 then
    raise exception 'PROGRAMMING_REQUIRES_LINE';
  end if;

  select coalesce(max(pr.revision_no), 0) + 1
  into v_revision_no
  from public.programming_revisions pr
  where pr.programming_id = v_programming.id;

  insert into public.programming_revisions (
    programming_id,
    revision_no,
    programming_version,
    scheduled_at,
    supplier_id,
    requested_quantity,
    confirmed_quantity,
    unit_code,
    placement_group,
    requires_pumping,
    estimated_work_item_id,
    status,
    notes,
    confirmed_at,
    confirmed_by,
    change_reason,
    action,
    created_by
  )
  values (
    v_programming.id,
    v_revision_no,
    v_programming.version,
    v_programming.scheduled_at,
    v_programming.supplier_id,
    v_programming.requested_quantity,
    v_programming.confirmed_quantity,
    v_programming.unit_code,
    v_programming.placement_group,
    v_programming.requires_pumping,
    v_programming.estimated_work_item_id,
    v_programming.status,
    v_programming.notes,
    v_programming.confirmed_at,
    v_programming.confirmed_by,
    nullif(btrim(p_change_reason), ''),
    btrim(p_action),
    p_actor
  )
  returning id into v_revision_id;

  insert into public.programming_revision_lines (
    project_id,
    programming_id,
    revision_id,
    quantity,
    unit_code,
    position
  )
  select
    pl.project_id,
    pl.programming_id,
    v_revision_id,
    pl.quantity,
    pl.unit_code,
    pl.position
  from public.programming_lines pl
  where pl.programming_id = v_programming.id
    and pl.project_id = v_programming.project_id
  order by pl.position;

  return v_revision_id;
end;
$$;

alter function app_private.snapshot_programming(uuid, uuid, text, text)
owner to postgres;

revoke all
on function app_private.snapshot_programming(uuid, uuid, text, text)
from public;

-- ============================================================
-- 7. EXPLICIT BASELINE FOR CURRENT PROGRAMMING
-- ============================================================

do $$
declare
  v_programming record;
begin
  for v_programming in
    select p.id, p.created_by
    from public.programming p
    order by p.created_at, p.id
  loop
    perform app_private.snapshot_programming(
      v_programming.id,
      v_programming.created_by,
      'PROGRAMMING_BASELINE',
      null
    );
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.programming p
    left join public.programming_revisions pr
      on pr.programming_id = p.id
     and pr.action = 'PROGRAMMING_BASELINE'
    group by p.id
    having count(pr.id) <> 1
  ) then
    raise exception 'PROGRAMMING_BASELINE_INCOMPLETE';
  end if;

  if exists (
    select 1
    from public.programming_revisions pr
    where pr.action = 'PROGRAMMING_BASELINE'
      and (
        select count(*)
        from public.programming_revision_lines prl
        where prl.revision_id = pr.id
      ) <> (
        select count(*)
        from public.programming_lines pl
        where pl.programming_id = pr.programming_id
      )
  ) then
    raise exception 'PROGRAMMING_BASELINE_LINES_INCOMPLETE';
  end if;
end;
$$;

alter table public.programming_revisions
alter column action set not null;

-- ============================================================
-- 8. CREATE PROGRAMMING + INITIAL SNAPSHOT
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

  select validated.line_count, validated.total_quantity, validated.unit_code
  into v_line_count, v_total_quantity, v_unit_code
  from app_private.validate_programming_lines_payload(p_lines) validated;

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

  perform app_private.snapshot_programming(
    v_programming_id,
    v_actor,
    'PROGRAMMING_CREATED',
    null
  );

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
      'status', 'DRAFT',
      'version', 1
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

-- The legacy create_programming(...) wrapper remains compatible and now
-- receives PROGRAMMING_CREATED snapshots through this canonical function.

-- ============================================================
-- 9. UPDATE DRAFT WITH HOMOGENEOUS LINES
-- ============================================================

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
  v_line_count integer;
  v_total_quantity numeric(12,3);
  v_unit_code text;
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
    'programming.modify'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if v_programming.version <> p_expected_version then
    raise exception 'PROGRAMMING_VERSION_CONFLICT';
  end if;

  if v_programming.status <> 'DRAFT' then
    raise exception 'PROGRAMMING_NOT_EDITABLE';
  end if;

  if p_scheduled_at is null then
    raise exception 'PROGRAMMING_SCHEDULE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.project_suppliers ps
    join public.suppliers s
      on s.id = ps.supplier_id
     and s.company_id = ps.company_id
    where ps.project_id = v_programming.project_id
      and ps.supplier_id = p_supplier_id
      and ps.active = true
      and s.active = true
  ) then
    raise exception 'SUPPLIER_NOT_AVAILABLE';
  end if;

  select validated.line_count, validated.total_quantity, validated.unit_code
  into v_line_count, v_total_quantity, v_unit_code
  from app_private.validate_programming_lines_payload(p_lines) validated;

  -- Change every existing row to the new homogeneous unit in one statement.
  -- AFTER ROW rollup triggers then observe the statement's complete unit state,
  -- avoiding a temporary mixed-unit aggregate.
  update public.programming_lines pl
  set unit_code = v_unit_code
  where pl.programming_id = v_programming.id
    and pl.project_id = v_programming.project_id
    and pl.unit_code is distinct from v_unit_code;

  insert into public.programming_lines (
    project_id,
    programming_id,
    quantity,
    unit_code,
    position
  )
  select
    v_programming.project_id,
    v_programming.id,
    (item.value ->> 'quantity')::numeric(12,3),
    btrim(item.value ->> 'unit_code'),
    item.position::integer
  from jsonb_array_elements(p_lines)
       with ordinality as item(value, position)
  on conflict on constraint programming_lines_position_uq
  do update
  set quantity = excluded.quantity,
      unit_code = excluded.unit_code;

  -- At least positions 1..v_line_count now exist, so this cannot remove the
  -- final line and remains compatible with PROGRAMMING_REQUIRES_LINE.
  delete from public.programming_lines pl
  where pl.programming_id = v_programming.id
    and pl.project_id = v_programming.project_id
    and pl.position > v_line_count;

  if not exists (
    select 1
    from public.programming p
    where p.id = v_programming.id
      and p.requested_quantity = v_total_quantity
      and btrim(p.unit_code) = v_unit_code
  ) then
    raise exception 'PROGRAMMING_LINE_ROLLUP_MISMATCH';
  end if;

  update public.programming
  set supplier_id = p_supplier_id,
      scheduled_at = p_scheduled_at,
      notes = nullif(btrim(p_notes), ''),
      version = version + 1,
      updated_at = now()
  where id = v_programming.id;

  perform app_private.snapshot_programming(
    v_programming.id,
    v_actor,
    'PROGRAMMING_UPDATED',
    null
  );

  insert into public.audit_events (
    actor_user_id,
    project_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  )
  values (
    v_actor,
    v_programming.project_id,
    'programming',
    v_programming.id,
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

alter function public.update_programming_with_lines(
  uuid,
  integer,
  uuid,
  timestamptz,
  jsonb,
  text
)
owner to postgres;

revoke all
on function public.update_programming_with_lines(
  uuid,
  integer,
  uuid,
  timestamptz,
  jsonb,
  text
)
from public, anon;

grant execute
on function public.update_programming_with_lines(
  uuid,
  integer,
  uuid,
  timestamptz,
  jsonb,
  text
)
to authenticated, service_role;

-- ============================================================
-- 10. SUBMIT FOR CONFIRMATION
-- ============================================================

create or replace function public.submit_programming_for_confirmation(
  p_programming_id uuid,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_programming public.programming%rowtype;
  v_line_count integer;
  v_total_quantity numeric(12,3);
  v_unit_count integer;
  v_unit_code text;
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
    'programming.modify'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if v_programming.version <> p_expected_version then
    raise exception 'PROGRAMMING_VERSION_CONFLICT';
  end if;

  if v_programming.status <> 'DRAFT' then
    raise exception 'PROGRAMMING_NOT_DRAFT';
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
  where pl.programming_id = v_programming.id
    and pl.project_id = v_programming.project_id;

  if v_line_count = 0 then
    raise exception 'PROGRAMMING_REQUIRES_LINE';
  end if;

  if v_unit_count <> 1 then
    raise exception 'PROGRAMMING_MIXED_UNITS_NOT_SUPPORTED';
  end if;

  if v_programming.requested_quantity is distinct from v_total_quantity
     or btrim(v_programming.unit_code) is distinct from v_unit_code then
    raise exception 'PROGRAMMING_LINE_ROLLUP_MISMATCH';
  end if;

  if exists (
    select 1
    from public.programming_lines pl
    left join public.units_of_measure u
      on u.code = pl.unit_code
     and u.active = true
    where pl.programming_id = v_programming.id
      and pl.project_id = v_programming.project_id
      and u.code is null
  ) then
    raise exception 'INVALID_OR_INACTIVE_UNIT_OF_MEASURE';
  end if;

  update public.programming
  set status = 'PENDING_CONFIRMATION',
      confirmed_quantity = null,
      confirmed_at = null,
      confirmed_by = null,
      version = version + 1,
      updated_at = now()
  where id = v_programming.id;

  perform app_private.snapshot_programming(
    v_programming.id,
    v_actor,
    'PROGRAMMING_SUBMITTED',
    null
  );

  insert into public.audit_events (
    actor_user_id,
    project_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  )
  values (
    v_actor,
    v_programming.project_id,
    'programming',
    v_programming.id,
    'PROGRAMMING_SUBMITTED_FOR_CONFIRMATION',
    jsonb_build_object(
      'status', v_programming.status,
      'version', v_programming.version
    ),
    jsonb_build_object(
      'status', 'PENDING_CONFIRMATION',
      'version', v_programming.version + 1
    )
  );

  return v_programming.version + 1;
end;
$$;

alter function public.submit_programming_for_confirmation(uuid, integer)
owner to postgres;

revoke all
on function public.submit_programming_for_confirmation(uuid, integer)
from public, anon;

grant execute
on function public.submit_programming_for_confirmation(uuid, integer)
to authenticated, service_role;

-- ============================================================
-- 11. REQUEST CORRECTION / RETURN TO DRAFT
-- ============================================================

create or replace function public.return_programming_to_draft(
  p_programming_id uuid,
  p_expected_version integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_programming public.programming%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_expected_version is null then
    raise exception 'PROGRAMMING_EXPECTED_VERSION_REQUIRED';
  end if;

  if v_reason is null then
    raise exception 'PROGRAMMING_CORRECTION_REASON_REQUIRED';
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
    'programming.confirm'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if v_programming.version <> p_expected_version then
    raise exception 'PROGRAMMING_VERSION_CONFLICT';
  end if;

  if v_programming.status <> 'PENDING_CONFIRMATION' then
    raise exception 'PROGRAMMING_NOT_PENDING_CONFIRMATION';
  end if;

  update public.programming
  set status = 'DRAFT',
      confirmed_quantity = null,
      confirmed_at = null,
      confirmed_by = null,
      version = version + 1,
      updated_at = now()
  where id = v_programming.id;

  perform app_private.snapshot_programming(
    v_programming.id,
    v_actor,
    'PROGRAMMING_RETURNED_TO_DRAFT',
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
    'PROGRAMMING_RETURNED_TO_DRAFT',
    jsonb_build_object(
      'status', v_programming.status,
      'version', v_programming.version
    ),
    jsonb_build_object(
      'status', 'DRAFT',
      'version', v_programming.version + 1,
      'reason', v_reason
    ),
    v_reason
  );

  return v_programming.version + 1;
end;
$$;

alter function public.return_programming_to_draft(uuid, integer, text)
owner to postgres;

revoke all
on function public.return_programming_to_draft(uuid, integer, text)
from public, anon;

grant execute
on function public.return_programming_to_draft(uuid, integer, text)
to authenticated, service_role;

-- ============================================================
-- 12. VERSIONED AGGREGATE CONFIRMATION
-- ============================================================

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
  v_notes text := nullif(btrim(p_notes), '');
  v_confirmed_quantity numeric(12,3) := p_confirmed_quantity;
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
    'programming.confirm'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if v_programming.version <> p_expected_version then
    raise exception 'PROGRAMMING_VERSION_CONFLICT';
  end if;

  if v_programming.status <> 'PENDING_CONFIRMATION' then
    raise exception 'PROGRAMMING_NOT_PENDING_CONFIRMATION';
  end if;

  if v_confirmed_quantity is null
     or v_confirmed_quantity <= 0
     or v_confirmed_quantity > v_programming.requested_quantity then
    raise exception 'INVALID_PROGRAMMING_CONFIRMED_QUANTITY';
  end if;

  update public.programming
  set status = 'CONFIRMED',
      confirmed_quantity = v_confirmed_quantity,
      confirmed_at = now(),
      confirmed_by = v_actor,
      version = version + 1,
      updated_at = now()
  where id = v_programming.id;

  perform app_private.snapshot_programming(
    v_programming.id,
    v_actor,
    'PROGRAMMING_CONFIRMED',
    v_notes
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
    'PROGRAMMING_CONFIRMED',
    jsonb_build_object(
      'status', v_programming.status,
      'confirmed_quantity', v_programming.confirmed_quantity,
      'version', v_programming.version
    ),
    jsonb_build_object(
      'status', 'CONFIRMED',
      'confirmed_quantity', v_confirmed_quantity,
      'version', v_programming.version + 1,
      'notes', v_notes
    ),
    v_notes
  );

  return v_programming.version + 1;
end;
$$;

alter function public.confirm_programming(uuid, numeric, integer, text)
owner to postgres;

revoke all
on function public.confirm_programming(uuid, numeric, integer, text)
from public, anon;

grant execute
on function public.confirm_programming(uuid, numeric, integer, text)
to authenticated, service_role;

-- ============================================================
-- 13. VERSIONED CANCELLATION
-- ============================================================

create or replace function public.cancel_programming(
  p_programming_id uuid,
  p_expected_version integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_programming public.programming%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_expected_version is null then
    raise exception 'PROGRAMMING_EXPECTED_VERSION_REQUIRED';
  end if;

  if v_reason is null then
    raise exception 'PROGRAMMING_CANCELLATION_REASON_REQUIRED';
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
    'programming.cancel'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if v_programming.version <> p_expected_version then
    raise exception 'PROGRAMMING_VERSION_CONFLICT';
  end if;

  if v_programming.status not in (
    'DRAFT',
    'PENDING_CONFIRMATION',
    'CONFIRMED'
  ) then
    raise exception 'PROGRAMMING_CANNOT_BE_CANCELLED';
  end if;

  if v_programming.status = 'CONFIRMED'
     and exists (
       select 1
       from public.dispatches d
       where d.programming_id = v_programming.id
         and d.project_id = v_programming.project_id
     ) then
    raise exception 'PROGRAMMING_HAS_DISPATCHES';
  end if;

  update public.programming
  set status = 'CANCELLED',
      version = version + 1,
      updated_at = now()
  where id = v_programming.id;

  perform app_private.snapshot_programming(
    v_programming.id,
    v_actor,
    'PROGRAMMING_CANCELLED',
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
    'PROGRAMMING_CANCELLED',
    jsonb_build_object(
      'status', v_programming.status,
      'version', v_programming.version
    ),
    jsonb_build_object(
      'status', 'CANCELLED',
      'version', v_programming.version + 1,
      'reason', v_reason
    ),
    v_reason
  );

  return v_programming.version + 1;
end;
$$;

alter function public.cancel_programming(uuid, integer, text)
owner to postgres;

revoke all
on function public.cancel_programming(uuid, integer, text)
from public, anon;

grant execute
on function public.cancel_programming(uuid, integer, text)
to authenticated, service_role;

-- ============================================================
-- 14. VERSIONED EXPLICIT CLOSE
-- ============================================================

create or replace function public.close_programming(
  p_programming_id uuid,
  p_expected_version integer,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_programming public.programming%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_dispatch_count integer;
  v_dispatches_without_result integer;
  v_counted_dispatches_without_guide integer;
  v_target_quantity numeric(12,3);
  v_dispatched_quantity numeric(12,3);
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

  if v_programming.status <> 'IN_EXECUTION' then
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
  into v_counted_dispatches_without_guide
  from public.dispatches d
  where d.programming_id = v_programming.id
    and d.project_id = v_programming.project_id
    and d.result in ('COMPLETE', 'PARTIAL')
    and not exists (
      select 1
      from public.dispatch_guides dg
      where dg.dispatch_id = d.id
        and dg.project_id = d.project_id
    );

  if v_counted_dispatches_without_guide > 0 then
    raise exception 'PROGRAMMING_DISPATCH_GUIDE_MISSING';
  end if;

  v_target_quantity := coalesce(
    v_programming.confirmed_quantity,
    v_programming.requested_quantity
  );

  select coalesce(sum(dg.quantity), 0)::numeric(12,3)
  into v_dispatched_quantity
  from public.dispatches d
  join public.dispatch_guides dg
    on dg.dispatch_id = d.id
   and dg.project_id = d.project_id
  where d.programming_id = v_programming.id
    and d.project_id = v_programming.project_id
    and d.result in ('COMPLETE', 'PARTIAL');

  v_remaining := greatest(
    v_target_quantity - v_dispatched_quantity,
    0
  );
  v_excess := greatest(
    v_dispatched_quantity - v_target_quantity,
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
      'dispatched_quantity', v_dispatched_quantity,
      'remaining', v_remaining,
      'excess', v_excess,
      'reason', v_reason
    ),
    v_reason
  );

  return v_programming.version + 1;
end;
$$;

alter function public.close_programming(uuid, integer, text)
owner to postgres;

revoke all
on function public.close_programming(uuid, integer, text)
from public, anon;

grant execute
on function public.close_programming(uuid, integer, text)
to authenticated, service_role;

-- ============================================================
-- 15. REMOVE UNSAFE LEGACY COMMAND SIGNATURES
-- ============================================================

-- These signatures cannot enforce PENDING_CONFIRMATION, explicit quantities
-- and optimistic locking. There are no Phase 4 UI callers for either command.
drop function public.confirm_programming(uuid);
drop function public.close_programming(uuid);

-- ============================================================
-- 16. FINAL SAFETY ASSERTIONS
-- ============================================================

do $$
begin
  if to_regprocedure('public.confirm_programming(uuid)') is not null
     or to_regprocedure('public.close_programming(uuid)') is not null then
    raise exception 'PROGRAMMING_UNSAFE_LEGACY_SIGNATURE_REMAINS';
  end if;

  if to_regprocedure(
    'public.confirm_programming(uuid,numeric,integer,text)'
  ) is null
     or to_regprocedure(
       'public.close_programming(uuid,integer,text)'
     ) is null
     or to_regprocedure(
       'public.update_programming_with_lines(uuid,integer,uuid,timestamp with time zone,jsonb,text)'
     ) is null
     or to_regprocedure(
       'public.submit_programming_for_confirmation(uuid,integer)'
     ) is null
     or to_regprocedure(
       'public.return_programming_to_draft(uuid,integer,text)'
     ) is null
     or to_regprocedure(
       'public.cancel_programming(uuid,integer,text)'
     ) is null then
    raise exception 'PROGRAMMING_DETAIL_CANONICAL_SIGNATURE_MISSING';
  end if;
end;
$$;

-- Phase 7 dependency:
-- register_dispatch_with_lines(...) must call app_private.snapshot_programming(
--   p_programming_id,
--   auth.uid(),
--   'PROGRAMMING_IN_EXECUTION',
--   null
-- ) only when its UPDATE performs CONFIRMED -> IN_EXECUTION.
--
-- PARTIAL semantics for Phase 7:
-- dispatch_guides.quantity must contain the quantity actually accepted at the
-- project. A split accepted+returned quantity in one dispatch remains out of
-- scope until Dispatch Guide is designed.

commit;
