-- 045_default_dispatch_guide_template.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
-- Platform Phase 5: fixed/default Dispatch Guide template with repeated products.
--
-- Promoted from:
--   supabase/proposals/20260829_dispatch_guide_lines.sql
--
-- Validated from read-only discovery against project
-- jeyjblxfqqlypxiaznad on 2026-08-29.
--
-- Compatibility strategy:
--   * dispatch_guides.quantity remains available to existing invoicing/batch RPCs.
--   * dispatch_guide_lines is the product source of truth.
--   * a DB trigger derives the compatibility quantity/unit/product summary on the
--     dispatch_guides row after every line mutation.
--   * current PRODUCT matching remains total-vs-total. Product-code matching is
--     intentionally NOT introduced by this migration.

begin;

-- ============================================================
-- 1. PRECONDITIONS / NON-DESTRUCTIVE BACKFILL SAFETY
-- ============================================================

do $$
begin
  if to_regclass('public.dispatch_guides') is null
    or to_regclass('public.dispatches') is null
    or to_regclass('public.programming') is null
    or to_regclass('public.units_of_measure') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.audit_events') is null then
    raise exception 'MISSING_DISPATCH_GUIDE_DEPENDENCY';
  end if;

  if to_regprocedure(
    'public.register_dispatch(uuid,text,text,date,numeric,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,uuid,jsonb)'
  ) is null then
    raise exception 'REGISTER_DISPATCH_SIGNATURE_NOT_FOUND';
  end if;

  if to_regclass('public.dispatch_guide_lines') is not null then
    raise exception 'DISPATCH_GUIDE_LINES_ALREADY_EXISTS';
  end if;

  -- Never invent missing historical product data or receiver names.
  if exists (
    select 1
    from public.dispatch_guides g
    left join public.profiles p on p.id = g.received_by
    where g.quantity is null
       or g.quantity <= 0
       or nullif(btrim(g.unit_code), '') is null
       or nullif(btrim(g.product_code), '') is null
       or nullif(btrim(g.product_description), '') is null
       or nullif(btrim(p.full_name), '') is null
  ) then
    raise exception 'DISPATCH_GUIDE_BACKFILL_REQUIRES_MANUAL_DATA_REVIEW';
  end if;
end;
$$;

-- ============================================================
-- 2. RECEIVER NAME SNAPSHOT
-- ============================================================

alter table public.dispatch_guides
add column received_by_name text;

update public.dispatch_guides g
set received_by_name = btrim(p.full_name)
from public.profiles p
where p.id = g.received_by;

alter table public.dispatch_guides
alter column received_by_name set not null;

alter table public.dispatch_guides
add constraint dispatch_guides_received_by_name_ck
check (nullif(btrim(received_by_name), '') is not null);

-- received_by remains the authenticated profile that registered the guide.
-- received_by_name is the immutable business snapshot shown on the guide.

-- ============================================================
-- 3. REPEATED PRODUCT LINES
-- ============================================================

create table public.dispatch_guide_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  guide_id uuid not null,
  quantity numeric(12,3) not null,
  unit_code text not null,
  product_code text not null,
  product_description text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dispatch_guide_lines_guide_project_fk
    foreign key (guide_id, project_id)
    references public.dispatch_guides(id, project_id)
    on delete restrict,

  constraint dispatch_guide_lines_unit_code_fk
    foreign key (unit_code)
    references public.units_of_measure(code)
    on delete restrict,

  constraint dispatch_guide_lines_quantity_ck
    check (quantity > 0),

  constraint dispatch_guide_lines_position_ck
    check (position > 0),

  constraint dispatch_guide_lines_product_code_ck
    check (nullif(btrim(product_code), '') is not null),

  constraint dispatch_guide_lines_product_description_ck
    check (nullif(btrim(product_description), '') is not null),

  constraint dispatch_guide_lines_position_uq
    unique (guide_id, position)
);

create index idx_dispatch_guide_lines_project
on public.dispatch_guide_lines(project_id);

-- ============================================================
-- 4. DB-LEVEL ROLLUP / COMPATIBILITY INVARIANT
-- ============================================================

create or replace function app_private.guard_dispatch_guide_line()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op = 'UPDATE'
     and (new.guide_id, new.project_id) is distinct from
         (old.guide_id, old.project_id) then
    raise exception 'DISPATCH_GUIDE_LINE_REPARENT_NOT_ALLOWED';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

alter function app_private.guard_dispatch_guide_line()
owner to postgres;

revoke all
on function app_private.guard_dispatch_guide_line()
from public;

create trigger dispatch_guide_lines_guard
before insert or update
on public.dispatch_guide_lines
for each row
execute function app_private.guard_dispatch_guide_line();

create or replace function app_private.sync_dispatch_guide_line_rollup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_guide_id uuid := coalesce(new.guide_id, old.guide_id);
  v_line_count integer;
  v_total_quantity numeric(12,3);
  v_unit_count integer;
  v_unit_code text;
  v_product_code text;
  v_product_description text;
begin
  select
    count(*)::integer,
    sum(l.quantity)::numeric(12,3),
    count(distinct l.unit_code)::integer,
    min(l.unit_code),
    case when count(*) = 1 then min(l.product_code) end,
    case when count(*) = 1 then min(l.product_description) end
  into
    v_line_count,
    v_total_quantity,
    v_unit_count,
    v_unit_code,
    v_product_code,
    v_product_description
  from public.dispatch_guide_lines l
  where l.guide_id = v_guide_id;

  if v_line_count = 0 then
    raise exception 'DISPATCH_GUIDE_REQUIRES_PRODUCT_LINE';
  end if;

  -- The current invoice rule compares one guide total with one invoice total.
  -- Until unit conversion/product matching is defined, adding unlike units is
  -- rejected instead of summing semantically incompatible quantities.
  if v_unit_count <> 1 then
    raise exception 'DISPATCH_GUIDE_MIXED_UNITS_NOT_SUPPORTED';
  end if;

  update public.dispatch_guides
  set quantity = v_total_quantity,
      unit_code = v_unit_code,
      product_code = v_product_code,
      product_description = v_product_description,
      updated_at = now()
  where id = v_guide_id;

  -- The return value of an AFTER trigger is ignored.
  return null;
end;
$$;

alter function app_private.sync_dispatch_guide_line_rollup()
owner to postgres;

revoke all
on function app_private.sync_dispatch_guide_line_rollup()
from public;

create trigger dispatch_guide_lines_rollup
after insert or update or delete
on public.dispatch_guide_lines
for each row
execute function app_private.sync_dispatch_guide_line_rollup();

-- ============================================================
-- 5. HISTORICAL BACKFILL
-- ============================================================

-- Read-only discovery found zero current dispatch_guides on 2026-08-29.
-- This remains intentionally safe if rows are added before execution: one
-- historical guide becomes one line using only existing, non-invented values.
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
  g.project_id,
  g.id,
  g.quantity,
  g.unit_code,
  btrim(g.product_code),
  btrim(g.product_description),
  1
from public.dispatch_guides g;

-- ============================================================
-- 6. RLS / GRANTS
-- ============================================================

alter table public.dispatch_guide_lines
enable row level security;

create policy dispatch_guide_lines_select
on public.dispatch_guide_lines
for select
to authenticated
using (app_private.is_project_member(project_id));

create policy platform_admin_read_dispatch_guide_lines
on public.dispatch_guide_lines
for select
to authenticated
using (app_private.is_platform_admin());

revoke all
on public.dispatch_guide_lines
from public, anon, authenticated;

grant select
on public.dispatch_guide_lines
to authenticated;

grant all
on public.dispatch_guide_lines
to service_role;

-- Browser clients do not receive INSERT/UPDATE/DELETE policies.
-- Mutations must remain transactional RPC operations.

-- ============================================================
-- 7. MULTI-LINE REGISTRATION RPC
-- ============================================================

create or replace function public.register_dispatch_with_lines(
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
  v_supplier_id uuid;
  v_dispatch_id uuid;
  v_guide_id uuid;
  v_line_count integer;
  v_total_quantity numeric(12,3);
  v_unit_count integer;
  v_unit_code text;
  v_single_product_code text;
  v_single_product_description text;
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

  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'DISPATCH_GUIDE_REQUIRES_PRODUCT_LINE';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) item(value)
    where nullif(item.value ->> 'quantity', '') is null
       or (item.value ->> 'quantity')::numeric <= 0
       or nullif(btrim(item.value ->> 'unit_code'), '') is null
       or nullif(btrim(item.value ->> 'product_code'), '') is null
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
    case when count(*) = 1 then min(btrim(item.value ->> 'product_code')) end,
    case when count(*) = 1 then min(btrim(item.value ->> 'product_description')) end
  into
    v_line_count,
    v_total_quantity,
    v_unit_count,
    v_unit_code,
    v_single_product_code,
    v_single_product_description
  from jsonb_array_elements(p_lines) item(value);

  if v_unit_count <> 1 then
    raise exception 'DISPATCH_GUIDE_MIXED_UNITS_NOT_SUPPORTED';
  end if;

  select project_id, supplier_id
  into v_project_id, v_supplier_id
  from public.programming
  where id = p_programming_id
    and status in ('CONFIRMED', 'IN_EXECUTION')
  for update;

  if not found then
    raise exception 'PROGRAMMING_NOT_READY_FOR_DISPATCH';
  end if;

  if not app_private.has_project_permission(
    v_project_id,
    'dispatch.create'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

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
    p_template_version_id,
    btrim(p_guide_number),
    nullif(btrim(p_order_number), ''),
    p_guide_date,
    v_total_quantity,
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
    and status = 'CONFIRMED';

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
      'total_quantity', v_total_quantity,
      'unit_code', v_unit_code
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
  uuid,
  jsonb
)
from public;

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
  uuid,
  jsonb
)
to authenticated;

-- ============================================================
-- 8. LEGACY SINGLE-PRODUCT RPC COMPATIBILITY
-- ============================================================

-- Existing callers remain valid. Their scalar product is converted to one
-- line, and the authenticated profile name is used as the receiver snapshot.
create or replace function public.register_dispatch(
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

-- Existing ACL for register_dispatch is intentionally left unchanged in this
-- proposal. Authorization remains enforced inside the RPC through auth.uid()
-- and app_private.has_project_permission(...).

-- ============================================================
-- 9. INTENTIONALLY UNCHANGED
-- ============================================================

-- No replacement is proposed for:
--   public.evaluate_guide_invoice_match(...)
--   public.review_invoice(...)
--   app_private.guide_ready_for_batch(...)
--   public.add_guide_to_batch(...)
--   public.rollover_weekly_batch(...)
--
-- They continue reading dispatch_guides.quantity, which is now maintained as
-- the DB-derived sum of dispatch_guide_lines.quantity.

commit;
