-- 055_dispatch_registration_physical_quantities.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Operational Phase 7, Migration A only.
-- Adds explicit physical quantities to Dispatch Guide registration, validates
-- supplier/template context, snapshots the first CONFIRMED -> IN_EXECUTION
-- transition, and makes Programming closure use physically received quantity.
--
-- Intentionally excluded:
--   * incidents and incident_types access
--   * documents, upload and storage policies
--   * guide/result correction and guide revisions
--   * batches, invoices and reconciliation

begin;

-- ============================================================
-- 1. PRECONDITIONS / DRIFT GUARDS
-- ============================================================

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'dispatches',
    'dispatch_guides',
    'dispatch_guide_lines',
    'programming',
    'programming_lines',
    'suppliers',
    'project_suppliers',
    'projects',
    'supplier_templates',
    'supplier_template_versions',
    'supplier_template_fields',
    'audit_events'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'DISPATCH_REGISTRATION_REQUIRED_RELATION_MISSING: %', v_table;
    end if;
  end loop;

  if to_regprocedure(
    'public.register_dispatch_with_lines(uuid,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,uuid,jsonb)'
  ) is null then
    raise exception 'DISPATCH_REGISTER_WITH_LINES_EXPECTED_SIGNATURE_MISSING';
  end if;

  if to_regprocedure(
    'public.register_dispatch(uuid,text,text,date,numeric,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,uuid,jsonb)'
  ) is null then
    raise exception 'DISPATCH_REGISTER_LEGACY_SIGNATURE_MISSING';
  end if;

  if to_regprocedure(
    'public.close_programming(uuid,integer,text)'
  ) is null then
    raise exception 'CLOSE_PROGRAMMING_EXPECTED_SIGNATURE_MISSING';
  end if;

  if to_regprocedure(
    'app_private.snapshot_programming(uuid,uuid,text,text)'
  ) is null then
    raise exception 'PROGRAMMING_SNAPSHOT_HELPER_MISSING';
  end if;

  if to_regprocedure(
    'app_private.has_project_permission(uuid,text)'
  ) is null then
    raise exception 'HAS_PROJECT_PERMISSION_SIGNATURE_MISSING';
  end if;

  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'dispatch_guides'
      and c.column_name in (
        'dispatched_quantity',
        'received_quantity',
        'returned_quantity'
      )
  ) then
    raise exception 'DISPATCH_PHYSICAL_QUANTITY_COLUMN_ALREADY_EXISTS';
  end if;

  -- Discovery found only independent PLATFORM_ADMIN reads on these catalogs.
  -- Abort on drift instead of layering another permissive operational policy.
  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in (
        'supplier_templates',
        'supplier_template_versions',
        'supplier_template_fields'
      )
      and p.cmd = 'SELECT'
      and position('is_platform_admin' in coalesce(p.qual, '')) = 0
  ) then
    raise exception 'DISPATCH_TEMPLATE_OPERATIONAL_POLICY_REQUIRES_MANUAL_REVIEW';
  end if;

  if exists (
    select 1
    from (
      values
        ('supplier_templates'),
        ('supplier_template_versions'),
        ('supplier_template_fields')
    ) expected(table_name)
    where not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = expected.table_name
        and p.cmd = 'SELECT'
        and position('is_platform_admin' in coalesce(p.qual, '')) > 0
    )
  ) then
    raise exception 'DISPATCH_TEMPLATE_PLATFORM_ADMIN_READ_POLICY_MISSING';
  end if;
end;
$$;

-- Prevent registration from racing the no-invention backfill check. The live
-- database had zero guides during discovery; any row now requires review.
lock table public.dispatch_guides in access exclusive mode;

do $$
begin
  if exists (select 1 from public.dispatch_guides) then
    raise exception 'DISPATCH_PHYSICAL_QUANTITY_BACKFILL_REQUIRES_MANUAL_REVIEW';
  end if;
end;
$$;

-- ============================================================
-- 2. PHYSICAL QUANTITIES
-- ============================================================

alter table public.dispatch_guides
add column dispatched_quantity numeric(12,3) not null,
add column received_quantity numeric(12,3) not null,
add column returned_quantity numeric(12,3) not null;

alter table public.dispatch_guides
add constraint dispatch_guides_physical_quantities_ck
check (
  dispatched_quantity >= 0
  and received_quantity >= 0
  and returned_quantity >= 0
  and received_quantity + returned_quantity <= dispatched_quantity
);

-- quantity remains the documented rollup of dispatch_guide_lines.quantity.
-- Result-specific physical invariants are enforced by the canonical RPC. A
-- later correction RPC must preserve the same invariants when it is designed.

-- ============================================================
-- 3. MINIMUM OPERATIONAL TEMPLATE READ
-- ============================================================

create or replace function app_private.can_read_dispatch_template(
  p_supplier_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select exists (
    select 1
    from public.project_suppliers ps
    join public.projects p
      on p.id = ps.project_id
     and p.company_id = ps.company_id
    join public.suppliers s
      on s.id = ps.supplier_id
     and s.company_id = ps.company_id
    where ps.supplier_id = p_supplier_id
      and ps.active = true
      and p.status = 'ACTIVE'
      and s.active = true
      and app_private.has_project_permission(
        ps.project_id,
        'dispatch.view'
      )
  );
$$;

alter function app_private.can_read_dispatch_template(uuid)
owner to postgres;

revoke all
on function app_private.can_read_dispatch_template(uuid)
from public, anon;

grant execute
on function app_private.can_read_dispatch_template(uuid)
to authenticated, service_role;

create policy supplier_templates_select_dispatch_access
on public.supplier_templates
for select
to authenticated
using (
  active = true
  and document_type::text = 'DISPATCH_GUIDE'
  and app_private.can_read_dispatch_template(supplier_id)
);

create policy supplier_template_versions_select_dispatch_access
on public.supplier_template_versions
for select
to authenticated
using (
  status::text = 'PUBLISHED'
  and exists (
    select 1
    from public.supplier_templates st
    where st.id = supplier_template_versions.template_id
      and st.active = true
      and st.document_type::text = 'DISPATCH_GUIDE'
      and app_private.can_read_dispatch_template(st.supplier_id)
  )
);

create policy supplier_template_fields_select_dispatch_access
on public.supplier_template_fields
for select
to authenticated
using (
  exists (
    select 1
    from public.supplier_template_versions stv
    join public.supplier_templates st
      on st.id = stv.template_id
    where stv.id = supplier_template_fields.template_version_id
      and stv.status::text = 'PUBLISHED'
      and st.active = true
      and st.document_type::text = 'DISPATCH_GUIDE'
      and app_private.can_read_dispatch_template(st.supplier_id)
  )
);

revoke all privileges
on table
  public.supplier_templates,
  public.supplier_template_versions,
  public.supplier_template_fields
from public, anon, authenticated;

grant select
on table
  public.supplier_templates,
  public.supplier_template_versions,
  public.supplier_template_fields
to authenticated;

grant all privileges
on table
  public.supplier_templates,
  public.supplier_template_versions,
  public.supplier_template_fields
to service_role;

-- ============================================================
-- 4. REPLACE CANONICAL REGISTRATION SIGNATURE
-- ============================================================

-- Drop both callers inside this transaction so the old defaulted overload
-- cannot conflict with the new canonical signature. Rollback restores both.
drop function public.register_dispatch(
  uuid,
  text,
  text,
  date,
  numeric,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  uuid,
  jsonb
);

drop function public.register_dispatch_with_lines(
  uuid,
  text,
  text,
  date,
  text,
  jsonb,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  uuid,
  jsonb
);

create function public.register_dispatch_with_lines(
  p_programming_id uuid,
  p_guide_number text,
  p_order_number text,
  p_guide_date date,
  p_received_by_name text,
  p_lines jsonb,
  p_load_at timestamptz,
  p_arrival_at timestamptz,
  p_departure_at timestamptz,
  p_result public.dispatch_result,
  p_dispatched_quantity numeric default null,
  p_received_quantity numeric default null,
  p_template_version_id uuid default null,
  p_provider_extra_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_project_id uuid;
  v_company_id uuid;
  v_supplier_id uuid;
  v_programming_status public.programming_status;
  v_dispatch_id uuid;
  v_guide_id uuid;
  v_line_count integer;
  v_total_quantity numeric(12,3);
  v_unit_count integer;
  v_unit_code text;
  v_single_product_code text;
  v_single_product_description text;
  v_dispatched_quantity numeric(12,3);
  v_received_quantity numeric(12,3);
  v_returned_quantity numeric(12,3);
  v_template_version_id uuid := p_template_version_id;
  v_template_count integer;
  v_programming_version integer;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if nullif(btrim(p_guide_number), '') is null then
    raise exception 'GUIDE_NUMBER_REQUIRED';
  end if;

  if p_guide_date is null then
    raise exception 'GUIDE_DATE_REQUIRED';
  end if;

  if nullif(btrim(p_received_by_name), '') is null then
    raise exception 'RECEIVER_NAME_REQUIRED';
  end if;

  if p_provider_extra_data is not null
     and jsonb_typeof(p_provider_extra_data) <> 'object' then
    raise exception 'DISPATCH_PROVIDER_EXTRA_DATA_INVALID';
  end if;

  if (p_load_at is not null
      and p_arrival_at is not null
      and p_load_at > p_arrival_at)
     or (p_arrival_at is not null
         and p_departure_at is not null
         and p_arrival_at > p_departure_at)
     or (p_load_at is not null
         and p_departure_at is not null
         and p_load_at > p_departure_at) then
    raise exception 'DISPATCH_INVALID_TIME_SEQUENCE';
  end if;

  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'DISPATCH_LINES_REQUIRED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) item(value)
    where jsonb_typeof(item.value) <> 'object'
       or jsonb_typeof(item.value -> 'quantity') <> 'number'
       or (item.value ->> 'quantity')::numeric <= 0
       or jsonb_typeof(item.value -> 'unit_code') <> 'string'
       or nullif(btrim(item.value ->> 'unit_code'), '') is null
       or jsonb_typeof(item.value -> 'product_code') <> 'string'
       or nullif(btrim(item.value ->> 'product_code'), '') is null
       or jsonb_typeof(item.value -> 'product_description') <> 'string'
       or nullif(btrim(item.value ->> 'product_description'), '') is null
  ) then
    raise exception 'INVALID_DISPATCH_GUIDE_PRODUCT_LINE';
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
    min(btrim(item.value ->> 'unit_code')),
    case when count(*) = 1
      then min(btrim(item.value ->> 'product_code'))
    end,
    case when count(*) = 1
      then min(btrim(item.value ->> 'product_description'))
    end
  into
    v_line_count,
    v_total_quantity,
    v_unit_count,
    v_unit_code,
    v_single_product_code,
    v_single_product_description
  from jsonb_array_elements(p_lines) item(value);

  if v_unit_count <> 1 then
    raise exception 'DISPATCH_MIXED_UNITS_NOT_SUPPORTED';
  end if;

  select
    p.project_id,
    p.supplier_id,
    p.status,
    project.company_id
  into
    v_project_id,
    v_supplier_id,
    v_programming_status,
    v_company_id
  from public.programming p
  join public.projects project
    on project.id = p.project_id
  where p.id = p_programming_id
  for update of p;

  if not found
     or v_programming_status not in ('CONFIRMED', 'IN_EXECUTION') then
    raise exception 'DISPATCH_PROGRAMMING_INVALID_STATE';
  end if;

  if not app_private.has_project_permission(
    v_project_id,
    'dispatch.create'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if not exists (
    select 1
    from public.suppliers s
    where s.id = v_supplier_id
      and s.company_id = v_company_id
      and s.active = true
  ) then
    raise exception 'DISPATCH_SUPPLIER_INACTIVE';
  end if;

  if not exists (
    select 1
    from public.project_suppliers ps
    where ps.project_id = v_project_id
      and ps.company_id = v_company_id
      and ps.supplier_id = v_supplier_id
      and ps.active = true
  ) then
    raise exception 'DISPATCH_SUPPLIER_NOT_LINKED';
  end if;

  if v_template_version_id is null then
    select count(*)::integer, min(stv.id)
    into v_template_count, v_template_version_id
    from public.supplier_templates st
    join public.supplier_template_versions stv
      on stv.template_id = st.id
    where st.supplier_id = v_supplier_id
      and st.active = true
      and st.document_type::text = 'DISPATCH_GUIDE'
      and stv.status::text = 'PUBLISHED';

    if v_template_count = 0 then
      raise exception 'DISPATCH_TEMPLATE_INVALID';
    end if;

    if v_template_count > 1 then
      raise exception 'DISPATCH_TEMPLATE_AMBIGUOUS';
    end if;
  elsif not exists (
    select 1
    from public.supplier_template_versions stv
    join public.supplier_templates st
      on st.id = stv.template_id
    join public.suppliers s
      on s.id = st.supplier_id
    where stv.id = v_template_version_id
      and st.supplier_id = v_supplier_id
      and s.company_id = v_company_id
      and s.active = true
      and st.active = true
      and st.document_type::text = 'DISPATCH_GUIDE'
      and stv.status::text = 'PUBLISHED'
  ) then
    raise exception 'DISPATCH_TEMPLATE_INVALID';
  end if;

  if p_result is null then
    raise exception 'DISPATCH_RESULT_QUANTITY_MISMATCH';
  end if;

  case p_result
    when 'COMPLETE' then
      v_dispatched_quantity := coalesce(
        p_dispatched_quantity,
        v_total_quantity
      )::numeric(12,3);
      v_received_quantity := coalesce(
        p_received_quantity,
        v_dispatched_quantity
      )::numeric(12,3);
      v_returned_quantity := 0;

      if v_dispatched_quantity is distinct from v_total_quantity
         or v_received_quantity is distinct from v_dispatched_quantity then
        raise exception 'DISPATCH_RESULT_QUANTITY_MISMATCH';
      end if;

    when 'PARTIAL' then
      v_dispatched_quantity := coalesce(
        p_dispatched_quantity,
        v_total_quantity
      )::numeric(12,3);
      v_received_quantity := p_received_quantity::numeric(12,3);

      if v_dispatched_quantity <= 0
         or v_received_quantity is null
         or v_received_quantity <= 0
         or v_received_quantity >= v_dispatched_quantity then
        raise exception 'DISPATCH_RESULT_QUANTITY_MISMATCH';
      end if;

      v_returned_quantity := (
        v_dispatched_quantity - v_received_quantity
      )::numeric(12,3);

    when 'RETURNED', 'REJECTED' then
      v_dispatched_quantity := coalesce(
        p_dispatched_quantity,
        v_total_quantity
      )::numeric(12,3);
      v_received_quantity := coalesce(
        p_received_quantity,
        0
      )::numeric(12,3);
      v_returned_quantity := v_dispatched_quantity;

      if v_dispatched_quantity <= 0
         or v_received_quantity <> 0 then
        raise exception 'DISPATCH_RESULT_QUANTITY_MISMATCH';
      end if;

    when 'NOT_DISPATCHED', 'CANCELLED' then
      v_dispatched_quantity := coalesce(
        p_dispatched_quantity,
        0
      )::numeric(12,3);
      v_received_quantity := coalesce(
        p_received_quantity,
        0
      )::numeric(12,3);
      v_returned_quantity := 0;

      if v_dispatched_quantity <> 0
         or v_received_quantity <> 0 then
        raise exception 'DISPATCH_RESULT_QUANTITY_MISMATCH';
      end if;

    else
      raise exception 'DISPATCH_RESULT_QUANTITY_MISMATCH';
  end case;

  insert into public.dispatches (
    project_id,
    supplier_id,
    programming_id,
    status,
    result,
    created_by
  )
  values (
    v_project_id,
    v_supplier_id,
    p_programming_id,
    'REGISTERED',
    p_result,
    v_actor
  )
  returning id into v_dispatch_id;

  insert into public.dispatch_guides (
    project_id,
    supplier_id,
    dispatch_id,
    template_version_id,
    guide_number,
    order_number,
    guide_date,
    quantity,
    dispatched_quantity,
    received_quantity,
    returned_quantity,
    unit_code,
    product_code,
    product_description,
    load_at,
    arrival_at,
    departure_at,
    received_by,
    received_by_name,
    provider_extra_data
  )
  values (
    v_project_id,
    v_supplier_id,
    v_dispatch_id,
    v_template_version_id,
    btrim(p_guide_number),
    nullif(btrim(p_order_number), ''),
    p_guide_date,
    v_total_quantity,
    v_dispatched_quantity,
    v_received_quantity,
    v_returned_quantity,
    v_unit_code,
    v_single_product_code,
    v_single_product_description,
    p_load_at,
    p_arrival_at,
    p_departure_at,
    v_actor,
    btrim(p_received_by_name),
    coalesce(p_provider_extra_data, '{}'::jsonb)
  )
  returning id into v_guide_id;

  insert into public.dispatch_guide_lines (
    project_id,
    guide_id,
    quantity,
    unit_code,
    product_code,
    product_description,
    position
  )
  select
    v_project_id,
    v_guide_id,
    (item.value ->> 'quantity')::numeric(12,3),
    btrim(item.value ->> 'unit_code'),
    btrim(item.value ->> 'product_code'),
    btrim(item.value ->> 'product_description'),
    item.position::integer
  from jsonb_array_elements(p_lines)
       with ordinality as item(value, position);

  update public.programming
  set status = 'IN_EXECUTION',
      version = version + 1,
      updated_at = now()
  where id = p_programming_id
    and status = 'CONFIRMED'
  returning version into v_programming_version;

  if found then
    perform app_private.snapshot_programming(
      p_programming_id,
      v_actor,
      'PROGRAMMING_IN_EXECUTION',
      null
    );
  end if;

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
    v_project_id,
    'dispatch',
    v_dispatch_id,
    'DISPATCH_REGISTERED',
    jsonb_build_object(
      'guide_id', v_guide_id,
      'guide_number', btrim(p_guide_number),
      'received_by_name', btrim(p_received_by_name),
      'product_line_count', v_line_count,
      'documented_quantity', v_total_quantity,
      'dispatched_quantity', v_dispatched_quantity,
      'received_quantity', v_received_quantity,
      'returned_quantity', v_returned_quantity,
      'unit_code', v_unit_code,
      'result', p_result,
      'template_version_id', v_template_version_id,
      'programming_transition_version', v_programming_version
    )
  );

  return v_dispatch_id;
end;
$$;

alter function public.register_dispatch_with_lines(
  uuid,
  text,
  text,
  date,
  text,
  jsonb,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  numeric,
  numeric,
  uuid,
  jsonb
)
owner to postgres;

revoke all
on function public.register_dispatch_with_lines(
  uuid,
  text,
  text,
  date,
  text,
  jsonb,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  numeric,
  numeric,
  uuid,
  jsonb
)
from public, anon;

grant execute
on function public.register_dispatch_with_lines(
  uuid,
  text,
  text,
  date,
  text,
  jsonb,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  numeric,
  numeric,
  uuid,
  jsonb
)
to authenticated, service_role;

-- ============================================================
-- 5. SAFE LEGACY SINGLE-LINE WRAPPER
-- ============================================================

create function public.register_dispatch(
  p_programming_id uuid,
  p_guide_number text,
  p_order_number text,
  p_guide_date date,
  p_quantity numeric,
  p_unit_code text,
  p_product_code text,
  p_product_description text,
  p_load_at timestamptz,
  p_arrival_at timestamptz,
  p_departure_at timestamptz,
  p_result public.dispatch_result,
  p_template_version_id uuid default null,
  p_provider_extra_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_receiver_name text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- The legacy signature has no accepted quantity, so PARTIAL cannot be
  -- represented without inventing data. Use the canonical RPC instead.
  if p_result = 'PARTIAL' then
    raise exception 'DISPATCH_LEGACY_PARTIAL_REQUIRES_CANONICAL_RPC';
  end if;

  select nullif(btrim(full_name), '')
  into v_receiver_name
  from public.profiles
  where id = v_actor
    and active = true;

  if v_receiver_name is null then
    raise exception 'RECEIVER_NAME_REQUIRED';
  end if;

  return public.register_dispatch_with_lines(
    p_programming_id,
    p_guide_number,
    p_order_number,
    p_guide_date,
    v_receiver_name,
    jsonb_build_array(
      jsonb_build_object(
        'quantity', p_quantity,
        'unit_code', p_unit_code,
        'product_code', p_product_code,
        'product_description', p_product_description
      )
    ),
    p_load_at,
    p_arrival_at,
    p_departure_at,
    p_result,
    null,
    null,
    p_template_version_id,
    p_provider_extra_data
  );
end;
$$;

alter function public.register_dispatch(
  uuid,
  text,
  text,
  date,
  numeric,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  uuid,
  jsonb
)
owner to postgres;

revoke all
on function public.register_dispatch(
  uuid,
  text,
  text,
  date,
  numeric,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  uuid,
  jsonb
)
from public, anon;

grant execute
on function public.register_dispatch(
  uuid,
  text,
  text,
  date,
  numeric,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  uuid,
  jsonb
)
to authenticated, service_role;

-- ============================================================
-- 6. PROGRAMMING CLOSE USES PHYSICALLY RECEIVED QUANTITY
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

  select coalesce(sum(dg.received_quantity), 0)::numeric(12,3)
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
-- 7. FINAL SAFETY ASSERTIONS
-- ============================================================

do $$
declare
  v_table text;
  v_privilege text;
begin
  if to_regprocedure(
    'public.register_dispatch_with_lines(uuid,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,numeric,numeric,uuid,jsonb)'
  ) is null then
    raise exception 'DISPATCH_REGISTER_WITH_LINES_CANONICAL_SIGNATURE_MISSING';
  end if;

  if to_regprocedure(
    'public.register_dispatch_with_lines(uuid,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,uuid,jsonb)'
  ) is not null then
    raise exception 'DISPATCH_REGISTER_WITH_LINES_OLD_SIGNATURE_REMAINS';
  end if;

  if to_regprocedure(
    'public.register_dispatch(uuid,text,text,date,numeric,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,uuid,jsonb)'
  ) is null then
    raise exception 'DISPATCH_REGISTER_LEGACY_SIGNATURE_LOST';
  end if;

  foreach v_table in array array[
    'supplier_templates',
    'supplier_template_versions',
    'supplier_template_fields'
  ]
  loop
    if not has_table_privilege(
      'authenticated',
      format('public.%I', v_table),
      'SELECT'
    ) then
      raise exception 'DISPATCH_TEMPLATE_AUTHENTICATED_SELECT_MISSING: %', v_table;
    end if;

    foreach v_privilege in array array[
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]
    loop
      if has_table_privilege(
        'authenticated',
        format('public.%I', v_table),
        v_privilege
      ) then
        raise exception
          'DISPATCH_TEMPLATE_AUTHENTICATED_MUTATION_PRIVILEGE_REMAINS: %.%',
          v_table,
          v_privilege;
      end if;
    end loop;

    foreach v_privilege in array array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]
    loop
      if has_table_privilege(
        'anon',
        format('public.%I', v_table),
        v_privilege
      ) then
        raise exception
          'DISPATCH_TEMPLATE_ANON_PRIVILEGE_REMAINS: %.%',
          v_table,
          v_privilege;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from (
      values
        ('supplier_templates', 'supplier_templates_select_dispatch_access'),
        ('supplier_template_versions', 'supplier_template_versions_select_dispatch_access'),
        ('supplier_template_fields', 'supplier_template_fields_select_dispatch_access')
    ) expected(table_name, policy_name)
    where not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = expected.table_name
        and p.policyname = expected.policy_name
        and p.cmd = 'SELECT'
        and 'authenticated'::name = any(p.roles)
    )
  ) then
    raise exception 'DISPATCH_TEMPLATE_OPERATIONAL_POLICY_MISSING';
  end if;

  if exists (
    select 1
    from (
      values
        ('supplier_templates'),
        ('supplier_template_versions'),
        ('supplier_template_fields')
    ) expected(table_name)
    where not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = expected.table_name
        and p.cmd = 'SELECT'
        and position('is_platform_admin' in coalesce(p.qual, '')) > 0
    )
  ) then
    raise exception 'DISPATCH_TEMPLATE_PLATFORM_ADMIN_READ_POLICY_LOST';
  end if;
end;
$$;

-- UI/query follow-up after manual execution:
--   * Dispatch and Programming metrics must sum dispatch_guides.received_quantity.
--   * Registration UI must call the 14-argument canonical signature.
--   * PARTIAL must send p_received_quantity; returned quantity is derived.
--   * No UI change is included in this migration.

commit;
