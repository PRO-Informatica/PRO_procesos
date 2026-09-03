-- 080_phase2_dispatch_architecture.sql
-- APPLIED CORRECTLY — EXECUTED ON 2026-09-03.
--
-- Installs the single Phase 2 operational model after migration 079:
-- Programming -> 0..1 Dispatch -> N Guides -> N Product lines.
-- Dispatch status and physical result are separate concepts. Batch and
-- reconciliation tables remain as Phase 3 integration points, but they no
-- longer control Dispatch status.

begin;

do $$
begin
  if exists (select 1 from public.programming)
     or exists (select 1 from public.dispatches)
     or exists (select 1 from public.dispatch_guides)
     or exists (select 1 from public.dispatch_guide_lines)
     or exists (select 1 from public.batches)
     or exists (select 1 from public.invoices)
     or exists (select 1 from public.reconciliation_orders) then
    raise exception 'PHASE2_ARCHITECTURE_REQUIRES_MIGRATION_079';
  end if;

  if to_regclass('public.dispatches') is null
     or to_regclass('public.dispatch_guides') is null
     or to_regclass('public.dispatch_guide_lines') is null
     or to_regclass('public.dispatch_incidents') is null
     or to_regclass('public.documents') is null
     or to_regclass('public.document_versions') is null
     or to_regclass('public.batch_guides') is null
     or to_regprocedure('app_private.has_project_permission(uuid,text)') is null
     or to_regprocedure(
       'app_private.snapshot_programming(uuid,uuid,text,text)'
     ) is null then
    raise exception 'PHASE2_ARCHITECTURE_REQUIRED_CONTRACT_MISSING';
  end if;
end;
$$;

-- ============================================================
-- 1. REMOVE THE OLD ONE-DISPATCH-PER-GUIDE CONTRACT
-- ============================================================

drop trigger if exists programming_completion_from_order
on public.reconciliation_orders;
drop function if exists app_private.trigger_programming_completion_from_order();
drop function if exists app_private.sync_programming_completion_from_order(uuid);

drop trigger if exists dispatch_guide_order_number_guard
on public.dispatch_guides;
drop function if exists app_private.guard_dispatch_guide_order_number();

drop trigger if exists dispatch_programming_unit_guard
on public.dispatch_guides;
drop function if exists app_private.guard_dispatch_programming_unit();

drop trigger if exists dispatch_programming_availability_guard
on public.dispatches;
drop function if exists app_private.guard_dispatch_programming_availability();
drop function if exists app_private.programming_dispatch_availability(uuid);

drop function if exists public.correct_dispatch_guide_order_number(
  uuid, integer, text, text
);
drop function if exists public.correct_dispatch_guide_with_lines(
  uuid, integer, text, text, date, text, jsonb,
  timestamptz, timestamptz, timestamptz,
  public.dispatch_result, numeric, numeric, uuid, jsonb, text
);
drop function if exists public.register_dispatch(
  uuid, text, text, date, numeric, text, text, text,
  timestamptz, timestamptz, timestamptz,
  public.dispatch_result, uuid, jsonb
);
drop function if exists public.register_dispatch_with_lines(
  uuid, text, text, date, text, jsonb,
  timestamptz, timestamptz, timestamptz,
  public.dispatch_result, numeric, numeric, uuid, jsonb
);

drop function if exists app_private.snapshot_dispatch_guide(
  uuid, uuid, text, text
);
drop trigger if exists dispatch_guide_revision_lines_immutable
on public.dispatch_guide_revision_lines;
drop trigger if exists dispatch_guide_revisions_immutable
on public.dispatch_guide_revisions;
drop function if exists app_private.prevent_dispatch_guide_revision_mutation();

drop table public.dispatch_guide_revision_lines;
drop table public.dispatch_guide_revisions;

-- The old dynamic Dispatch Guide template was not consumed by any other
-- application module. Remove its FK columns before removing the hierarchy.
alter table public.dispatch_guides
  drop column template_version_id,
  drop column provider_extra_data;

drop table public.supplier_template_fields;
drop table public.supplier_template_versions;
drop table public.supplier_templates;
drop function if exists app_private.can_read_dispatch_template(uuid);
drop type if exists public.template_field_type;
drop type if exists public.template_status;
drop type if exists public.template_document_type;

-- ============================================================
-- 2. ONE OPERATIONAL STATUS + ONE PHYSICAL RESULT
-- ============================================================

alter table public.dispatches alter column status drop default;
alter type public.dispatch_status rename to dispatch_status_phase1_legacy;
create type public.dispatch_status as enum ('IN_EXECUTION', 'COMPLETED');
alter table public.dispatches
  alter column status type public.dispatch_status
  using ('IN_EXECUTION'::public.dispatch_status),
  alter column status set default 'IN_EXECUTION';
drop type public.dispatch_status_phase1_legacy;

alter type public.dispatch_result rename to dispatch_result_phase1_legacy;
create type public.dispatch_result as enum ('DISPATCHED', 'NOT_DISPATCHED');
alter table public.dispatches
  alter column result type public.dispatch_result
  using (null::public.dispatch_result);
drop type public.dispatch_result_phase1_legacy;

-- ============================================================
-- 3. CANONICAL DISPATCH AND GUIDE SHAPE
-- ============================================================

alter table public.dispatches
  add column arrival_at timestamptz,
  add column departure_at timestamptz,
  add column received_by uuid,
  add column received_by_name text,
  add column order_number text,
  add column real_volume numeric(12,3),
  add column real_unit_code text,
  add column completed_at timestamptz,
  add column completed_by uuid,
  add constraint dispatches_received_by_fk
    foreign key (received_by) references public.profiles(id) on delete restrict,
  add constraint dispatches_completed_by_fk
    foreign key (completed_by) references public.profiles(id) on delete restrict,
  add constraint dispatches_real_unit_code_fk
    foreign key (real_unit_code)
    references public.units_of_measure(code) on delete restrict,
  add constraint dispatches_programming_uq unique (programming_id),
  add constraint dispatches_receiver_name_ck check (
    received_by_name is null
    or char_length(btrim(received_by_name)) between 1 and 160
  ),
  add constraint dispatches_order_number_ck check (
    order_number is null
    or char_length(btrim(order_number)) between 1 and 120
  ),
  add constraint dispatches_real_volume_ck check (
    real_volume is null or real_volume >= 0
  ),
  add constraint dispatches_time_sequence_ck check (
    arrival_at is null or departure_at is null or arrival_at <= departure_at
  ),
  add constraint dispatches_completion_shape_ck check (
    (
      status = 'IN_EXECUTION'
      and completed_at is null
      and completed_by is null
    )
    or (
      status = 'COMPLETED'
      and result is not null
      and completed_at is not null
      and completed_by is not null
    )
  ),
  add constraint dispatches_not_dispatched_volume_ck check (
    result is distinct from 'NOT_DISPATCHED'
    or real_volume = 0
  );

create index dispatches_project_operational_status_idx
on public.dispatches(project_id, status, created_at desc);

alter table public.dispatch_guides
  drop constraint if exists dispatch_guides_physical_quantities_ck,
  drop constraint if exists dispatch_guides_received_by_name_ck,
  -- supplier_id and order_number remain temporarily as Phase 3 integration
  -- projections. Phase 2 writes them from their Dispatch and never accepts
  -- independent Guide values. They can be removed when Phase 3 consumers are
  -- moved to dispatches.supplier_id/order_number.
  drop column product_code,
  drop column product_description,
  drop column load_at,
  drop column arrival_at,
  drop column departure_at,
  drop column received_by,
  drop column received_by_name,
  drop column dispatched_quantity,
  drop column received_quantity,
  drop column returned_quantity,
  add column created_by uuid not null,
  add constraint dispatch_guides_created_by_fk
    foreign key (created_by) references public.profiles(id) on delete restrict,
  add constraint dispatch_guides_dispatch_number_uq
    unique (dispatch_id, guide_number);

-- ============================================================
-- 4. GENERAL DISPATCH EVIDENCE, REUSING DOCUMENT STORAGE
-- ============================================================

create table public.dispatch_documents (
  project_id uuid not null,
  dispatch_id uuid not null,
  document_id uuid not null,
  purpose text not null default 'DISPATCH_EVIDENCE',
  constraint dispatch_documents_pkey primary key (dispatch_id, document_id),
  constraint dispatch_documents_dispatch_fk
    foreign key (dispatch_id, project_id)
    references public.dispatches(id, project_id) on delete cascade,
  constraint dispatch_documents_document_fk
    foreign key (document_id, project_id)
    references public.documents(id, project_id) on delete cascade,
  constraint dispatch_documents_purpose_ck check (
    purpose in ('DISPATCH_EVIDENCE', 'OPERATION_CONTROL', 'OTHER_SUPPORT')
  )
);

alter table public.dispatch_documents owner to postgres;
alter table public.dispatch_documents enable row level security;
alter table public.dispatch_documents force row level security;

create policy dispatch_documents_select
on public.dispatch_documents for select to authenticated
using (app_private.has_project_permission(project_id, 'dispatch.view'));

create policy platform_admin_read_dispatch_documents
on public.dispatch_documents for select to authenticated
using (app_private.is_platform_admin());

revoke all on table public.dispatch_documents from public, anon, authenticated;
grant select on table public.dispatch_documents to authenticated;
grant all on table public.dispatch_documents to service_role;

-- ============================================================
-- 5. PRODUCT-LINE VALIDATION AND GUIDE ROLLUP
-- ============================================================

create function app_private.validate_dispatch_guide_lines_payload(p_lines jsonb)
returns table(line_count integer, total_quantity numeric(12,3), unit_code text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0
     or jsonb_array_length(p_lines) > 100 then
    raise exception 'DISPATCH_GUIDE_LINES_REQUIRED';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) item(value)
    where jsonb_typeof(item.value) <> 'object'
       or jsonb_typeof(item.value -> 'quantity') <> 'number'
       or (item.value ->> 'quantity')::numeric <= 0
       or nullif(btrim(item.value ->> 'unit_code'), '') is null
       or nullif(btrim(item.value ->> 'product_code'), '') is null
       or nullif(btrim(item.value ->> 'product_description'), '') is null
       or char_length(btrim(item.value ->> 'product_code')) > 120
       or char_length(btrim(item.value ->> 'product_description')) > 500
  ) then
    raise exception 'DISPATCH_GUIDE_LINE_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) item(value)
    left join public.units_of_measure unit
      on unit.code = btrim(item.value ->> 'unit_code')
     and unit.active
    where unit.code is null
  ) then
    raise exception 'INVALID_OR_INACTIVE_UNIT_OF_MEASURE';
  end if;

  return query
  select count(*)::integer,
         sum((item.value ->> 'quantity')::numeric)::numeric(12,3),
         min(btrim(item.value ->> 'unit_code'))
  from jsonb_array_elements(p_lines) item(value)
  having count(distinct btrim(item.value ->> 'unit_code')) = 1;

  if not found then
    raise exception 'DISPATCH_GUIDE_MIXED_UNITS_NOT_SUPPORTED';
  end if;
end;
$$;

alter function app_private.validate_dispatch_guide_lines_payload(jsonb)
owner to postgres;
revoke all on function app_private.validate_dispatch_guide_lines_payload(jsonb)
from public, anon, authenticated, service_role;

create or replace function app_private.guard_dispatch_guide_line()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_status public.dispatch_status;
begin
  if tg_op = 'UPDATE'
     and (new.guide_id, new.project_id) is distinct from
         (old.guide_id, old.project_id) then
    raise exception 'DISPATCH_GUIDE_LINE_REPARENT_NOT_ALLOWED';
  end if;

  select dispatch.status into v_status
  from public.dispatch_guides guide
  join public.dispatches dispatch
    on dispatch.id = guide.dispatch_id
   and dispatch.project_id = guide.project_id
  where guide.id = coalesce(new.guide_id, old.guide_id);

  if v_status = 'COMPLETED' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$$;

create or replace function app_private.sync_dispatch_guide_line_rollup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_guide_id uuid := coalesce(new.guide_id, old.guide_id);
  v_count integer;
  v_total numeric(12,3);
  v_units integer;
  v_unit text;
begin
  select count(*)::integer, sum(line.quantity)::numeric(12,3),
         count(distinct line.unit_code)::integer, min(line.unit_code)
  into v_count, v_total, v_units, v_unit
  from public.dispatch_guide_lines line
  where line.guide_id = v_guide_id;

  if v_count = 0 then return null; end if;
  if v_units <> 1 then
    raise exception 'DISPATCH_GUIDE_MIXED_UNITS_NOT_SUPPORTED';
  end if;

  update public.dispatch_guides
  set quantity = v_total, unit_code = v_unit, updated_at = now()
  where id = v_guide_id;
  return null;
end;
$$;

-- ============================================================
-- 6. PROGRESSIVE DISPATCH RPC
-- ============================================================

create function public.start_dispatch(
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
  where programming.id = p_programming_id
    and project.status = 'ACTIVE'
  for update of programming;
  if not found then raise exception 'PROGRAMMING_NOT_FOUND'; end if;
  if v_programming.status not in ('CONFIRMED', 'IN_EXECUTION') then
    raise exception 'DISPATCH_PROGRAMMING_INVALID_STATE';
  end if;
  if not app_private.has_project_permission(
    v_programming.project_id, 'dispatch.create'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if exists (
    select 1 from public.dispatches dispatch
    where dispatch.programming_id = v_programming.id
  ) then raise exception 'PROGRAMMING_DISPATCH_ALREADY_EXISTS'; end if;

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
      and relation.supplier_id = v_programming.supplier_id
      and relation.active
  ) then raise exception 'DISPATCH_SUPPLIER_NOT_AVAILABLE'; end if;

  if v_receiver_name is null then
    select nullif(btrim(profile.full_name), '') into v_receiver_name
    from public.profiles profile where profile.id = v_actor and profile.active;
  end if;
  if v_receiver_name is null then raise exception 'RECEIVER_NAME_REQUIRED'; end if;

  begin
    insert into public.dispatches(
      project_id, supplier_id, programming_id, status, result, version,
      created_by, arrival_at, received_by, received_by_name
    ) values (
      v_programming.project_id, v_programming.supplier_id, v_programming.id,
      'IN_EXECUTION', null, 1, v_actor, p_arrival_at, v_actor, v_receiver_name
    ) returning id into v_dispatch_id;
  exception when unique_violation then
    raise exception 'PROGRAMMING_DISPATCH_ALREADY_EXISTS';
  end;

  if v_programming.status = 'CONFIRMED' then
    update public.programming
    set status = 'IN_EXECUTION', version = version + 1, updated_at = now()
    where id = v_programming.id;
    perform app_private.snapshot_programming(
      v_programming.id, v_actor, 'PROGRAMMING_IN_EXECUTION',
      'Despacho operativo iniciado.'
    );
  end if;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_programming.project_id, 'dispatch',
    v_dispatch_id, 'DISPATCH_STARTED', jsonb_build_object(
      'programming_id', v_programming.id,
      'status', 'IN_EXECUTION',
      'arrival_at', p_arrival_at,
      'received_by_name', v_receiver_name
    )
  );
  return v_dispatch_id;
end;
$$;

create function public.update_dispatch(
  p_dispatch_id uuid,
  p_expected_version integer,
  p_arrival_at timestamptz,
  p_departure_at timestamptz,
  p_received_by_name text,
  p_result public.dispatch_result,
  p_order_number text,
  p_real_volume numeric,
  p_real_unit_code text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_company_id uuid;
  v_receiver_name text := nullif(btrim(p_received_by_name), '');
  v_order_number text := nullif(btrim(p_order_number), '');
  v_unit text := nullif(btrim(p_real_unit_code), '');
  v_volume numeric(12,3) := p_real_volume;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_expected_version is null then raise exception 'DISPATCH_VERSION_REQUIRED'; end if;

  select dispatch.* into v_dispatch
  from public.dispatches dispatch
  where dispatch.id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(
    v_dispatch.project_id, 'dispatch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  if p_arrival_at is null then raise exception 'DISPATCH_ARRIVAL_REQUIRED'; end if;
  if p_departure_at is not null and p_departure_at < p_arrival_at then
    raise exception 'DISPATCH_INVALID_TIME_SEQUENCE';
  end if;
  if v_receiver_name is null then raise exception 'RECEIVER_NAME_REQUIRED'; end if;
  if v_volume is not null and v_volume < 0 then
    raise exception 'DISPATCH_REAL_VOLUME_INVALID';
  end if;
  if p_result = 'NOT_DISPATCHED' then v_volume := 0; end if;
  if v_unit is not null and not exists (
    select 1 from public.units_of_measure unit
    where unit.code = v_unit and unit.active
  ) then raise exception 'INVALID_OR_INACTIVE_UNIT_OF_MEASURE'; end if;

  update public.dispatches
  set arrival_at = p_arrival_at,
      departure_at = p_departure_at,
      received_by_name = v_receiver_name,
      result = p_result,
      order_number = v_order_number,
      real_volume = v_volume,
      real_unit_code = v_unit,
      version = version + 1,
      updated_at = now()
  where id = v_dispatch.id;

  -- Temporary Phase 3 projection. Dispatch is the source of truth.
  update public.dispatch_guides
  set order_number = v_order_number,
      updated_at = now()
  where dispatch_id = v_dispatch.id
    and order_number is distinct from v_order_number;

  select project.company_id into v_company_id
  from public.projects project where project.id = v_dispatch.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values
  ) values (
    v_actor, v_company_id, v_dispatch.project_id, 'dispatch',
    v_dispatch.id, 'DISPATCH_SAVED',
    jsonb_build_object(
      'arrival_at', v_dispatch.arrival_at,
      'departure_at', v_dispatch.departure_at,
      'result', v_dispatch.result,
      'order_number', v_dispatch.order_number,
      'real_volume', v_dispatch.real_volume,
      'real_unit_code', v_dispatch.real_unit_code,
      'version', v_dispatch.version
    ),
    jsonb_build_object(
      'arrival_at', p_arrival_at,
      'departure_at', p_departure_at,
      'result', p_result,
      'order_number', v_order_number,
      'real_volume', v_volume,
      'real_unit_code', v_unit,
      'version', v_dispatch.version + 1
    )
  );
  return v_dispatch.version + 1;
end;
$$;

create function public.create_dispatch_guide_with_lines(
  p_dispatch_id uuid,
  p_expected_version integer,
  p_guide_number text,
  p_guide_date date,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_programming public.programming%rowtype;
  v_company_id uuid;
  v_guide_id uuid := gen_random_uuid();
  v_count integer;
  v_total numeric(12,3);
  v_unit text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(btrim(p_guide_number), '') is null then
    raise exception 'GUIDE_NUMBER_REQUIRED';
  end if;
  if p_guide_date is null then raise exception 'GUIDE_DATE_REQUIRED'; end if;

  select dispatch.* into v_dispatch
  from public.dispatches dispatch where dispatch.id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(
    v_dispatch.project_id, 'dispatch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;

  select programming.* into v_programming
  from public.programming programming
  where programming.id = v_dispatch.programming_id
    and programming.project_id = v_dispatch.project_id;

  select validated.line_count, validated.total_quantity, validated.unit_code
  into v_count, v_total, v_unit
  from app_private.validate_dispatch_guide_lines_payload(p_lines) validated;
  if v_unit is distinct from v_programming.unit_code then
    raise exception 'DISPATCH_PROGRAMMING_UNIT_MISMATCH';
  end if;

  begin
    insert into public.dispatch_guides(
      id, project_id, supplier_id, dispatch_id, guide_number, order_number, guide_date,
      quantity, unit_code, created_by
    ) values (
      v_guide_id, v_dispatch.project_id, v_dispatch.supplier_id, v_dispatch.id,
      btrim(p_guide_number), v_dispatch.order_number, p_guide_date,
      v_total, v_unit, v_actor
    );
  exception when unique_violation then
    raise exception 'DISPATCH_GUIDE_NUMBER_ALREADY_EXISTS';
  end;

  insert into public.dispatch_guide_lines(
    project_id, guide_id, quantity, unit_code,
    product_code, product_description, position
  )
  select v_dispatch.project_id, v_guide_id,
         (item.value ->> 'quantity')::numeric(12,3),
         btrim(item.value ->> 'unit_code'),
         btrim(item.value ->> 'product_code'),
         btrim(item.value ->> 'product_description'),
         item.position::integer
  from jsonb_array_elements(p_lines)
       with ordinality as item(value, position);

  update public.dispatches
  set version = version + 1, updated_at = now()
  where id = v_dispatch.id;
  select project.company_id into v_company_id
  from public.projects project where project.id = v_dispatch.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_dispatch.project_id, 'dispatch_guide',
    v_guide_id, 'DISPATCH_GUIDE_ADDED', jsonb_build_object(
      'dispatch_id', v_dispatch.id,
      'guide_number', btrim(p_guide_number),
      'product_count', v_count,
      'quantity', v_total,
      'unit_code', v_unit,
      'dispatch_version', v_dispatch.version + 1
    )
  );
  return jsonb_build_object(
    'guide_id', v_guide_id,
    'dispatch_version', v_dispatch.version + 1
  );
end;
$$;

create function public.update_dispatch_guide_with_lines(
  p_guide_id uuid,
  p_expected_version integer,
  p_guide_number text,
  p_guide_date date,
  p_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_guide public.dispatch_guides%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_programming_unit text;
  v_company_id uuid;
  v_count integer;
  v_total numeric(12,3);
  v_unit text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(btrim(p_guide_number), '') is null then
    raise exception 'GUIDE_NUMBER_REQUIRED';
  end if;
  if p_guide_date is null then raise exception 'GUIDE_DATE_REQUIRED'; end if;

  select guide.* into v_guide
  from public.dispatch_guides guide where guide.id = p_guide_id;
  if not found then raise exception 'DISPATCH_GUIDE_NOT_FOUND'; end if;
  select dispatch.* into v_dispatch
  from public.dispatches dispatch where dispatch.id = v_guide.dispatch_id
  for update;
  if not app_private.has_project_permission(
    v_dispatch.project_id, 'dispatch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  if exists (
    select 1 from public.batch_guides relation
    where relation.guide_id = v_guide.id
  ) then raise exception 'DISPATCH_GUIDE_BATCH_LOCKED'; end if;

  select programming.unit_code into v_programming_unit
  from public.programming programming
  where programming.id = v_dispatch.programming_id;
  select validated.line_count, validated.total_quantity, validated.unit_code
  into v_count, v_total, v_unit
  from app_private.validate_dispatch_guide_lines_payload(p_lines) validated;
  if v_unit is distinct from v_programming_unit then
    raise exception 'DISPATCH_PROGRAMMING_UNIT_MISMATCH';
  end if;

  begin
    update public.dispatch_guides
    set guide_number = btrim(p_guide_number),
        guide_date = p_guide_date,
        quantity = v_total,
        unit_code = v_unit,
        updated_at = now()
    where id = v_guide.id;
  exception when unique_violation then
    raise exception 'DISPATCH_GUIDE_NUMBER_ALREADY_EXISTS';
  end;

  insert into public.dispatch_guide_lines(
    project_id, guide_id, quantity, unit_code,
    product_code, product_description, position
  )
  select v_dispatch.project_id, v_guide.id,
         (item.value ->> 'quantity')::numeric(12,3),
         btrim(item.value ->> 'unit_code'),
         btrim(item.value ->> 'product_code'),
         btrim(item.value ->> 'product_description'),
         item.position::integer
  from jsonb_array_elements(p_lines)
       with ordinality as item(value, position)
  on conflict on constraint dispatch_guide_lines_position_uq
  do update set quantity = excluded.quantity,
                unit_code = excluded.unit_code,
                product_code = excluded.product_code,
                product_description = excluded.product_description;

  delete from public.dispatch_guide_lines line
  where line.guide_id = v_guide.id and line.position > v_count;

  update public.dispatches
  set version = version + 1, updated_at = now()
  where id = v_dispatch.id;
  select project.company_id into v_company_id
  from public.projects project where project.id = v_dispatch.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values
  ) values (
    v_actor, v_company_id, v_dispatch.project_id, 'dispatch_guide',
    v_guide.id, 'DISPATCH_GUIDE_UPDATED',
    jsonb_build_object(
      'guide_number', v_guide.guide_number,
      'guide_date', v_guide.guide_date,
      'quantity', v_guide.quantity,
      'unit_code', v_guide.unit_code
    ),
    jsonb_build_object(
      'guide_number', btrim(p_guide_number),
      'guide_date', p_guide_date,
      'product_count', v_count,
      'quantity', v_total,
      'unit_code', v_unit,
      'dispatch_version', v_dispatch.version + 1
    )
  );
  return v_dispatch.version + 1;
end;
$$;

create function public.delete_dispatch_guide(
  p_guide_id uuid,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_guide public.dispatch_guides%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_company_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select guide.* into v_guide
  from public.dispatch_guides guide where guide.id = p_guide_id;
  if not found then raise exception 'DISPATCH_GUIDE_NOT_FOUND'; end if;
  select dispatch.* into v_dispatch
  from public.dispatches dispatch where dispatch.id = v_guide.dispatch_id
  for update;
  if not app_private.has_project_permission(
    v_dispatch.project_id, 'dispatch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  if exists (
    select 1 from public.batch_guides relation where relation.guide_id = v_guide.id
  ) then raise exception 'DISPATCH_GUIDE_BATCH_LOCKED'; end if;
  if exists (
    select 1 from public.guide_documents relation where relation.guide_id = v_guide.id
  ) then raise exception 'DISPATCH_GUIDE_HAS_EVIDENCE'; end if;

  delete from public.dispatch_guides where id = v_guide.id;
  update public.dispatches
  set version = version + 1, updated_at = now()
  where id = v_dispatch.id;
  select project.company_id into v_company_id
  from public.projects project where project.id = v_dispatch.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values
  ) values (
    v_actor, v_company_id, v_dispatch.project_id, 'dispatch_guide',
    v_guide.id, 'DISPATCH_GUIDE_DELETED',
    jsonb_build_object(
      'dispatch_id', v_dispatch.id,
      'guide_number', v_guide.guide_number,
      'quantity', v_guide.quantity,
      'unit_code', v_guide.unit_code
    ),
    jsonb_build_object('dispatch_version', v_dispatch.version + 1)
  );
  return v_dispatch.version + 1;
end;
$$;

create function public.complete_dispatch(
  p_dispatch_id uuid,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_programming public.programming%rowtype;
  v_company_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select dispatch.* into v_dispatch
  from public.dispatches dispatch where dispatch.id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(
    v_dispatch.project_id, 'dispatch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_ALREADY_COMPLETED';
  end if;
  if v_dispatch.result is null then
    raise exception 'DISPATCH_RESULT_REQUIRED';
  end if;

  select programming.* into v_programming
  from public.programming programming
  where programming.id = v_dispatch.programming_id
    and programming.project_id = v_dispatch.project_id
  for update;
  if not found then raise exception 'DISPATCH_PROGRAMMING_CONTEXT_INVALID'; end if;

  if v_dispatch.result = 'DISPATCHED' then
    if v_dispatch.arrival_at is null then
      raise exception 'DISPATCH_ARRIVAL_REQUIRED';
    end if;
    if v_dispatch.departure_at is null then
      raise exception 'DISPATCH_DEPARTURE_REQUIRED';
    end if;
    if nullif(btrim(v_dispatch.order_number), '') is null then
      raise exception 'DISPATCH_ORDER_NUMBER_REQUIRED';
    end if;
    if v_dispatch.real_volume is null or v_dispatch.real_volume <= 0 then
      raise exception 'DISPATCH_REAL_VOLUME_REQUIRED';
    end if;
    if v_dispatch.real_unit_code is null then
      raise exception 'DISPATCH_REAL_UNIT_REQUIRED';
    end if;
    if v_dispatch.real_unit_code is distinct from v_programming.unit_code then
      raise exception 'DISPATCH_PROGRAMMING_UNIT_MISMATCH';
    end if;
    if not exists (
      select 1 from public.dispatch_guides guide
      where guide.dispatch_id = v_dispatch.id
        and guide.project_id = v_dispatch.project_id
    ) then raise exception 'DISPATCH_GUIDE_REQUIRED'; end if;
    if exists (
      select 1 from public.dispatch_guides guide
      where guide.dispatch_id = v_dispatch.id
        and (
          nullif(btrim(guide.guide_number), '') is null
          or not exists (
            select 1 from public.dispatch_guide_lines line
            where line.guide_id = guide.id
              and line.project_id = guide.project_id
              and line.quantity > 0
              and nullif(btrim(line.product_code), '') is not null
              and nullif(btrim(line.product_description), '') is not null
          )
        )
    ) then raise exception 'DISPATCH_GUIDE_INCOMPLETE'; end if;
  else
    if v_dispatch.real_volume is distinct from 0 then
      raise exception 'NOT_DISPATCHED_REAL_VOLUME_MUST_BE_ZERO';
    end if;
    if not exists (
      select 1 from public.dispatch_incidents incident
      where incident.dispatch_id = v_dispatch.id
        and incident.project_id = v_dispatch.project_id
    ) then raise exception 'NOT_DISPATCHED_INCIDENT_REQUIRED'; end if;
  end if;

  update public.dispatches
  set status = 'COMPLETED',
      completed_at = now(),
      completed_by = v_actor,
      version = version + 1,
      updated_at = now()
  where id = v_dispatch.id;

  select project.company_id into v_company_id
  from public.projects project where project.id = v_dispatch.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values
  ) values (
    v_actor, v_company_id, v_dispatch.project_id, 'dispatch',
    v_dispatch.id, 'DISPATCH_COMPLETED',
    jsonb_build_object('status', v_dispatch.status, 'version', v_dispatch.version),
    jsonb_build_object(
      'status', 'COMPLETED',
      'result', v_dispatch.result,
      'order_number', v_dispatch.order_number,
      'real_volume', v_dispatch.real_volume,
      'real_unit_code', v_dispatch.real_unit_code,
      'version', v_dispatch.version + 1
    )
  );
  return v_dispatch.version + 1;
end;
$$;

-- Incidents remain independent from result, but become immutable together
-- with their Dispatch.
create or replace function public.register_dispatch_incident(
  p_dispatch_id uuid,
  p_incident_type_id uuid,
  p_responsibility public.responsibility_type,
  p_charge_applicability public.charge_applicability,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_company_id uuid;
  v_incident_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select dispatch.* into v_dispatch
  from public.dispatches dispatch where dispatch.id = p_dispatch_id;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  if not app_private.has_project_permission(
    v_dispatch.project_id, 'dispatch.register_incident'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  select project.company_id into v_company_id
  from public.projects project where project.id = v_dispatch.project_id;
  if not exists (
    select 1 from public.incident_types incident_type
    where incident_type.id = p_incident_type_id
      and incident_type.company_id = v_company_id
      and incident_type.active
  ) then raise exception 'DISPATCH_INCIDENT_TYPE_INVALID'; end if;
  if p_responsibility is null then
    raise exception 'DISPATCH_INCIDENT_RESPONSIBILITY_REQUIRED';
  end if;
  if p_charge_applicability is null then
    raise exception 'DISPATCH_INCIDENT_CHARGE_APPLICABILITY_REQUIRED';
  end if;

  insert into public.dispatch_incidents(
    project_id, dispatch_id, incident_type_id, responsibility,
    charge_applicability, notes, reported_by
  ) values (
    v_dispatch.project_id, v_dispatch.id, p_incident_type_id,
    p_responsibility, p_charge_applicability,
    nullif(btrim(p_notes), ''), v_actor
  ) returning id into v_incident_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_dispatch.project_id, 'dispatch_incident',
    v_incident_id, 'DISPATCH_INCIDENT_REPORTED', jsonb_build_object(
      'dispatch_id', v_dispatch.id,
      'incident_type_id', p_incident_type_id,
      'responsibility', p_responsibility,
      'charge_applicability', p_charge_applicability
    )
  );
  return v_incident_id;
end;
$$;

-- Defense in depth for callers other than the canonical RPC.
create function app_private.guard_completed_dispatch_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'COMPLETED' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.project_id, new.programming_id, new.supplier_id,
        new.created_by, new.received_by) is distinct from
       (old.id, old.project_id, old.programming_id, old.supplier_id,
        old.created_by, old.received_by) then
      raise exception 'DISPATCH_CONTEXT_IMMUTABLE';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger dispatch_completed_mutation_guard
before update or delete on public.dispatches
for each row execute function app_private.guard_completed_dispatch_mutation();

create function app_private.guard_dispatch_child_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_dispatch_id uuid;
  v_status public.dispatch_status;
begin
  if tg_table_name = 'dispatch_guides' then
    v_dispatch_id := case when tg_op = 'DELETE' then old.dispatch_id else new.dispatch_id end;
  elsif tg_table_name = 'dispatch_incidents' then
    v_dispatch_id := case when tg_op = 'DELETE' then old.dispatch_id else new.dispatch_id end;
  elsif tg_table_name = 'dispatch_documents' then
    v_dispatch_id := case when tg_op = 'DELETE' then old.dispatch_id else new.dispatch_id end;
  elsif tg_table_name = 'guide_documents' then
    select guide.dispatch_id into v_dispatch_id
    from public.dispatch_guides guide
    where guide.id = case when tg_op = 'DELETE' then old.guide_id else new.guide_id end;
  elsif tg_table_name = 'incident_documents' then
    select incident.dispatch_id into v_dispatch_id
    from public.dispatch_incidents incident
    where incident.id = case when tg_op = 'DELETE' then old.incident_id else new.incident_id end;
  end if;

  select dispatch.status into v_status
  from public.dispatches dispatch where dispatch.id = v_dispatch_id;
  if v_status = 'COMPLETED' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger dispatch_guides_completed_guard
before insert or update or delete on public.dispatch_guides
for each row execute function app_private.guard_dispatch_child_mutation();
create trigger dispatch_incidents_completed_guard
before insert or update or delete on public.dispatch_incidents
for each row execute function app_private.guard_dispatch_child_mutation();
create trigger dispatch_documents_completed_guard
before insert or update or delete on public.dispatch_documents
for each row execute function app_private.guard_dispatch_child_mutation();
create trigger guide_documents_completed_guard
before insert or update or delete on public.guide_documents
for each row execute function app_private.guard_dispatch_child_mutation();
create trigger incident_documents_completed_guard
before insert or update or delete on public.incident_documents
for each row execute function app_private.guard_dispatch_child_mutation();

-- ============================================================
-- 7. MULTIPLE EVIDENCE UPLOADS
-- ============================================================

create or replace function app_private.can_read_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select app_private.is_platform_admin() or exists (
    select 1 from public.documents document
    where document.id = p_document_id and (
      exists (
        select 1 from public.dispatch_documents relation
        where relation.document_id = document.id
          and relation.project_id = document.project_id
          and app_private.has_project_permission(relation.project_id, 'dispatch.view')
      ) or exists (
        select 1 from public.guide_documents relation
        where relation.document_id = document.id
          and relation.project_id = document.project_id
          and app_private.has_project_permission(relation.project_id, 'dispatch.view')
      ) or exists (
        select 1 from public.incident_documents relation
        where relation.document_id = document.id
          and relation.project_id = document.project_id
          and app_private.has_project_permission(relation.project_id, 'dispatch.view')
      ) or exists (
        select 1 from public.invoice_documents relation
        where relation.document_id = document.id
          and relation.project_id = document.project_id
          and app_private.has_project_permission(relation.project_id, 'invoice.view')
      ) or (
        not exists (select 1 from public.dispatch_documents x where x.document_id = document.id)
        and not exists (select 1 from public.guide_documents x where x.document_id = document.id)
        and not exists (select 1 from public.incident_documents x where x.document_id = document.id)
        and not exists (select 1 from public.invoice_documents x where x.document_id = document.id)
        and (
          app_private.is_project_member(document.project_id)
          or app_private.has_project_permission(document.project_id, 'document.view')
        )
      )
    )
  );
$$;

create or replace function app_private.resolve_dispatch_document_mutation(
  p_document_id uuid
)
returns table(project_id uuid, company_id uuid, context_type text, context_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_count integer;
  v_project_id uuid;
  v_company_id uuid;
  v_context_type text;
  v_context_id uuid;
begin
  select count(*)::integer, (array_agg(ctx.project_id))[1],
         (array_agg(ctx.context_type))[1], (array_agg(ctx.context_id))[1]
  into v_count, v_project_id, v_context_type, v_context_id
  from (
    select relation.project_id, 'DISPATCH'::text context_type,
           relation.dispatch_id context_id
    from public.dispatch_documents relation
    where relation.document_id = p_document_id
    union all
    select relation.project_id, 'GUIDE', relation.guide_id
    from public.guide_documents relation
    where relation.document_id = p_document_id
    union all
    select relation.project_id, 'INCIDENT', relation.incident_id
    from public.incident_documents relation
    where relation.document_id = p_document_id
    union all
    select relation.project_id, 'INVOICE', relation.invoice_id
    from public.invoice_documents relation
    where relation.document_id = p_document_id
  ) ctx;
  if v_count <> 1 then raise exception 'DOCUMENT_CONTEXT_INVALID'; end if;
  select project.company_id into v_company_id
  from public.projects project where project.id = v_project_id;
  if v_context_type in ('DISPATCH', 'GUIDE') and not app_private.has_project_permission(
    v_project_id, 'dispatch.modify'
  ) then raise exception 'DISPATCH_DOCUMENT_PERMISSION_DENIED';
  elsif v_context_type = 'INCIDENT' and not app_private.has_project_permission(
    v_project_id, 'dispatch.register_incident'
  ) then raise exception 'INCIDENT_DOCUMENT_PERMISSION_DENIED';
  elsif v_context_type = 'INVOICE' and not app_private.has_project_permission(
    v_project_id, 'invoice.create'
  ) then raise exception 'INVOICE_DOCUMENT_PERMISSION_DENIED';
  end if;
  return query select v_project_id, v_company_id, v_context_type, v_context_id;
end;
$$;

create function app_private.guard_completed_dispatch_document_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_document_id uuid := coalesce(new.document_id, old.document_id);
  v_status public.dispatch_status;
begin
  select dispatch.status into v_status
  from public.dispatches dispatch
  where dispatch.id = (
    select relation.dispatch_id
    from public.dispatch_documents relation
    where relation.document_id = v_document_id
    union all
    select guide.dispatch_id
    from public.guide_documents relation
    join public.dispatch_guides guide on guide.id = relation.guide_id
    where relation.document_id = v_document_id
    union all
    select incident.dispatch_id
    from public.incident_documents relation
    join public.dispatch_incidents incident on incident.id = relation.incident_id
    where relation.document_id = v_document_id
    limit 1
  );
  if v_status = 'COMPLETED' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger document_versions_completed_dispatch_guard
before insert or update or delete on public.document_versions
for each row execute function app_private.guard_completed_dispatch_document_version();

create function public.prepare_dispatch_document_upload(
  p_dispatch_id uuid,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_purpose text default 'DISPATCH_EVIDENCE',
  p_document_id uuid default null
)
returns table(
  document_id uuid, version_id uuid, version_number integer,
  storage_bucket text, storage_path text, file_name text,
  mime_type text, file_size bigint, upload_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_company_id uuid;
  v_document_id uuid := p_document_id;
  v_purpose text := upper(coalesce(nullif(btrim(p_purpose), ''), 'DISPATCH_EVIDENCE'));
  v_prepared record;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select dispatch.* into v_dispatch
  from public.dispatches dispatch where dispatch.id = p_dispatch_id;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  if not app_private.has_project_permission(
    v_dispatch.project_id, 'dispatch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_purpose not in ('DISPATCH_EVIDENCE', 'OPERATION_CONTROL', 'OTHER_SUPPORT') then
    raise exception 'DISPATCH_DOCUMENT_PURPOSE_INVALID';
  end if;
  select project.company_id into v_company_id
  from public.projects project where project.id = v_dispatch.project_id;

  if v_document_id is null then
    v_document_id := gen_random_uuid();
    insert into public.documents(id, project_id, category, created_by)
    values (v_document_id, v_dispatch.project_id, 'DISPATCH_EVIDENCE', v_actor);
    insert into public.dispatch_documents(
      project_id, dispatch_id, document_id, purpose
    ) values (
      v_dispatch.project_id, v_dispatch.id, v_document_id, v_purpose
    );
  elsif not exists (
    select 1 from public.dispatch_documents relation
    join public.documents document
      on document.id = relation.document_id
     and document.project_id = relation.project_id
    where relation.dispatch_id = v_dispatch.id
      and relation.document_id = v_document_id
  ) then raise exception 'DISPATCH_DOCUMENT_RETRY_CONTEXT_INVALID';
  end if;

  select prepared.* into v_prepared
  from app_private.prepare_document_upload_version(
    v_document_id, v_dispatch.project_id, v_actor,
    p_file_name, p_mime_type, p_file_size
  ) prepared;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_dispatch.project_id, 'document',
    v_document_id, 'DISPATCH_DOCUMENT_PREPARED', jsonb_build_object(
      'dispatch_id', v_dispatch.id,
      'version_id', v_prepared.version_id,
      'purpose', v_purpose,
      'mime_type', v_prepared.mime_type,
      'file_size', v_prepared.file_size
    )
  );
  return query select v_prepared.document_id, v_prepared.version_id,
    v_prepared.version_number, v_prepared.storage_bucket,
    v_prepared.storage_path, v_prepared.file_name,
    v_prepared.mime_type, v_prepared.file_size,
    v_prepared.upload_expires_at;
end;
$$;

create function public.remove_dispatch_evidence(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_context record;
  v_company_id uuid;
  v_paths jsonb;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select resolved.* into v_context
  from app_private.resolve_dispatch_document_mutation(p_document_id) resolved;
  if v_context.context_type = 'INVOICE' then
    raise exception 'DISPATCH_DOCUMENT_NOT_FOUND';
  end if;

  select dispatch.* into v_dispatch
  from public.dispatches dispatch
  where dispatch.id = case v_context.context_type
    when 'DISPATCH' then v_context.context_id
    when 'GUIDE' then (
      select guide.dispatch_id from public.dispatch_guides guide
      where guide.id = v_context.context_id
    )
    when 'INCIDENT' then (
      select incident.dispatch_id from public.dispatch_incidents incident
      where incident.id = v_context.context_id
    )
  end
  for update;
  if not found then raise exception 'DISPATCH_DOCUMENT_NOT_FOUND'; end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  if not app_private.has_project_permission(
    v_dispatch.project_id, 'dispatch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'bucket', version.storage_bucket, 'path', version.storage_path
  )), '[]'::jsonb) into v_paths
  from public.document_versions version
  where version.document_id = p_document_id;

  delete from public.documents where id = p_document_id;
  select project.company_id into v_company_id
  from public.projects project where project.id = v_dispatch.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values
  ) values (
    v_actor, v_company_id, v_dispatch.project_id, 'document',
    p_document_id, 'DISPATCH_DOCUMENT_REMOVED', jsonb_build_object(
      'dispatch_id', v_dispatch.id,
      'context_type', v_context.context_type,
      'context_id', v_context.context_id,
      'storage_objects', v_paths
    )
  );
  return jsonb_build_object('storage_objects', v_paths);
end;
$$;

-- ============================================================
-- 8. BATCH INTEGRATION WITHOUT DISPATCH-STATUS SIDE EFFECTS
-- ============================================================

create or replace function public.add_guide_to_batch(
  p_batch_id uuid,
  p_guide_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.batches%rowtype;
  v_guide public.dispatch_guides%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_company_id uuid;
  v_relation_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select batch.* into v_batch
  from public.batches batch where batch.id = p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.status not in ('DRAFT', 'ASSEMBLING') then
    raise exception 'BATCH_NOT_EDITABLE';
  end if;
  if not app_private.has_project_permission(
    v_batch.project_id, 'batch.add_guide'
  ) then raise exception 'PERMISSION_DENIED'; end if;

  select guide.* into v_guide
  from public.dispatch_guides guide
  where guide.id = p_guide_id and guide.project_id = v_batch.project_id
  for update;
  if not found then raise exception 'BATCH_GUIDE_CONTEXT_INVALID'; end if;
  select dispatch.* into v_dispatch
  from public.dispatches dispatch
  where dispatch.id = v_guide.dispatch_id
    and dispatch.project_id = v_guide.project_id;
  if not found then raise exception 'BATCH_DISPATCH_CONTEXT_INVALID'; end if;
  if v_dispatch.result = 'NOT_DISPATCHED' then
    raise exception 'BATCH_GUIDE_OPERATION_NOT_DISPATCHED';
  end if;
  if v_guide.guide_date < v_batch.period_start
     or v_guide.guide_date > v_batch.period_end then
    raise exception 'BATCH_GUIDE_DATE_OUTSIDE_WEEK';
  end if;
  if exists (
    select 1 from public.batch_guides relation
    where relation.guide_id = v_guide.id and relation.removed_at is null
  ) then raise exception 'GUIDE_ALREADY_IN_ACTIVE_BATCH'; end if;

  insert into public.batch_guides(
    project_id, batch_id, guide_id, added_by, assignment_source
  ) values (
    v_batch.project_id, v_batch.id, v_guide.id, v_actor, 'USER'
  ) returning id into v_relation_id;

  select project.company_id into v_company_id
  from public.projects project where project.id = v_batch.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_batch.project_id, 'batch_guide',
    v_relation_id, 'GUIDE_ADDED_TO_BATCH', jsonb_build_object(
      'batch_id', v_batch.id,
      'guide_id', v_guide.id,
      'dispatch_id', v_dispatch.id,
      'assignment_source', 'USER',
      'dispatch_status_unchanged', v_dispatch.status
    )
  );
  return v_relation_id;
exception when unique_violation then
  raise exception 'GUIDE_ALREADY_IN_ACTIVE_BATCH';
end;
$$;

create or replace function public.remove_guide_from_batch(
  p_batch_id uuid,
  p_guide_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.batches%rowtype;
  v_relation public.batch_guides%rowtype;
  v_dispatch_id uuid;
  v_company_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'BATCH_GUIDE_REMOVAL_REASON_INVALID';
  end if;
  select batch.* into v_batch
  from public.batches batch where batch.id = p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.status not in ('DRAFT', 'ASSEMBLING') then
    raise exception 'BATCH_NOT_EDITABLE';
  end if;
  if not app_private.has_project_permission(
    v_batch.project_id, 'batch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;

  select relation.* into v_relation
  from public.batch_guides relation
  where relation.batch_id = v_batch.id
    and relation.guide_id = p_guide_id
    and relation.project_id = v_batch.project_id
    and relation.removed_at is null
  for update;
  if not found then raise exception 'ACTIVE_BATCH_GUIDE_NOT_FOUND'; end if;
  select guide.dispatch_id into v_dispatch_id
  from public.dispatch_guides guide
  where guide.id = v_relation.guide_id
    and guide.project_id = v_relation.project_id;
  if not found then raise exception 'BATCH_GUIDE_CONTEXT_INVALID'; end if;

  update public.batch_guides
  set removed_at = now(),
      removed_by = v_actor,
      removal_reason = v_reason,
      rolled_to_batch_id = null,
      removal_metadata = coalesce(removal_metadata, '{}'::jsonb)
        || jsonb_build_object('source', 'HUMAN')
  where id = v_relation.id;

  select project.company_id into v_company_id
  from public.projects project where project.id = v_batch.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values, comment
  ) values (
    v_actor, v_company_id, v_batch.project_id, 'batch_guide',
    v_relation.id, 'GUIDE_REMOVED_FROM_BATCH',
    jsonb_build_object(
      'batch_id', v_batch.id,
      'guide_id', v_relation.guide_id,
      'dispatch_id', v_dispatch_id
    ),
    jsonb_build_object(
      'removal_source', 'HUMAN',
      'removal_reason', v_reason,
      'dispatch_status_unchanged', true
    ),
    v_reason
  );
  return v_relation.id;
end;
$$;

-- ============================================================
-- 9. OWNERSHIP, API ACCESS AND DEPLOYMENT ASSERTIONS
-- ============================================================

alter function app_private.guard_dispatch_guide_line() owner to postgres;
alter function app_private.sync_dispatch_guide_line_rollup() owner to postgres;
alter function app_private.guard_completed_dispatch_mutation() owner to postgres;
alter function app_private.guard_dispatch_child_mutation() owner to postgres;
alter function app_private.can_read_document(uuid) owner to postgres;
alter function app_private.resolve_dispatch_document_mutation(uuid) owner to postgres;
alter function app_private.guard_completed_dispatch_document_version()
owner to postgres;

alter function public.start_dispatch(uuid,timestamptz,text) owner to postgres;
alter function public.update_dispatch(
  uuid,integer,timestamptz,timestamptz,text,public.dispatch_result,text,numeric,text
) owner to postgres;
alter function public.create_dispatch_guide_with_lines(
  uuid,integer,text,date,jsonb
) owner to postgres;
alter function public.update_dispatch_guide_with_lines(
  uuid,integer,text,date,jsonb
) owner to postgres;
alter function public.delete_dispatch_guide(uuid,integer) owner to postgres;
alter function public.complete_dispatch(uuid,integer) owner to postgres;
alter function public.register_dispatch_incident(
  uuid,uuid,public.responsibility_type,public.charge_applicability,text
) owner to postgres;
alter function public.prepare_dispatch_document_upload(
  uuid,text,text,bigint,text,uuid
) owner to postgres;
alter function public.remove_dispatch_evidence(uuid) owner to postgres;
alter function public.add_guide_to_batch(uuid,uuid) owner to postgres;
alter function public.remove_guide_from_batch(uuid,uuid,text) owner to postgres;

revoke all on function public.start_dispatch(uuid,timestamptz,text)
from public, anon;
revoke all on function public.update_dispatch(
  uuid,integer,timestamptz,timestamptz,text,public.dispatch_result,text,numeric,text
) from public, anon;
revoke all on function public.create_dispatch_guide_with_lines(
  uuid,integer,text,date,jsonb
) from public, anon;
revoke all on function public.update_dispatch_guide_with_lines(
  uuid,integer,text,date,jsonb
) from public, anon;
revoke all on function public.delete_dispatch_guide(uuid,integer)
from public, anon;
revoke all on function public.complete_dispatch(uuid,integer)
from public, anon;
revoke all on function public.register_dispatch_incident(
  uuid,uuid,public.responsibility_type,public.charge_applicability,text
) from public, anon;
revoke all on function public.prepare_dispatch_document_upload(
  uuid,text,text,bigint,text,uuid
) from public, anon;
revoke all on function public.remove_dispatch_evidence(uuid)
from public, anon;
revoke all on function public.add_guide_to_batch(uuid,uuid)
from public, anon;
revoke all on function public.remove_guide_from_batch(uuid,uuid,text)
from public, anon;

grant execute on function public.start_dispatch(uuid,timestamptz,text)
to authenticated, service_role;
grant execute on function public.update_dispatch(
  uuid,integer,timestamptz,timestamptz,text,public.dispatch_result,text,numeric,text
) to authenticated, service_role;
grant execute on function public.create_dispatch_guide_with_lines(
  uuid,integer,text,date,jsonb
) to authenticated, service_role;
grant execute on function public.update_dispatch_guide_with_lines(
  uuid,integer,text,date,jsonb
) to authenticated, service_role;
grant execute on function public.delete_dispatch_guide(uuid,integer)
to authenticated, service_role;
grant execute on function public.complete_dispatch(uuid,integer)
to authenticated, service_role;
grant execute on function public.register_dispatch_incident(
  uuid,uuid,public.responsibility_type,public.charge_applicability,text
) to authenticated, service_role;
grant execute on function public.prepare_dispatch_document_upload(
  uuid,text,text,bigint,text,uuid
) to authenticated, service_role;
grant execute on function public.remove_dispatch_evidence(uuid)
to authenticated, service_role;
grant execute on function public.add_guide_to_batch(uuid,uuid)
to authenticated, service_role;
grant execute on function public.remove_guide_from_batch(uuid,uuid,text)
to authenticated, service_role;

revoke all on function app_private.guard_dispatch_guide_line()
from public, anon, authenticated, service_role;
revoke all on function app_private.sync_dispatch_guide_line_rollup()
from public, anon, authenticated, service_role;
revoke all on function app_private.guard_completed_dispatch_mutation()
from public, anon, authenticated, service_role;
revoke all on function app_private.guard_dispatch_child_mutation()
from public, anon, authenticated, service_role;
revoke all on function app_private.resolve_dispatch_document_mutation(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.guard_completed_dispatch_document_version()
from public, anon, authenticated, service_role;

do $$
declare
  v_statuses text[];
  v_results text[];
begin
  select array_agg(enumlabel order by enumsortorder) into v_statuses
  from pg_enum where enumtypid = 'public.dispatch_status'::regtype;
  select array_agg(enumlabel order by enumsortorder) into v_results
  from pg_enum where enumtypid = 'public.dispatch_result'::regtype;

  if v_statuses is distinct from array['IN_EXECUTION', 'COMPLETED']
     or v_results is distinct from array['DISPATCHED', 'NOT_DISPATCHED']
     or to_regclass('public.supplier_templates') is not null
     or to_regclass('public.dispatch_guide_revisions') is not null
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.dispatches'::regclass
         and conname = 'dispatches_programming_uq'
         and contype = 'u'
     )
     or position(
       'set status = ''BATCHED'''
       in pg_get_functiondef('public.add_guide_to_batch(uuid,uuid)'::regprocedure)
     ) > 0 then
    raise exception 'PHASE2_DISPATCH_ARCHITECTURE_NOT_ALIGNED';
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * a Programming creates at most one Dispatch;
--   * progressive saves never complete a Dispatch;
--   * an in-execution Dispatch accepts N Guides with N Product lines;
--   * DISPATCHED completion validates Guide, times, Order and Real Volume;
--   * NOT_DISPATCHED completion requires an Incident and Real Volume = 0;
--   * completed Dispatches and their children are immutable;
--   * Batch assignment/removal never changes dispatches.status;
--   * dispatch_documents reuses the existing Documents/Storage pipeline.
