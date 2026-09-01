-- 058_dispatch_guide_corrections.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Operational Phase 7, Migration D only.
-- Adds immutable Dispatch Guide revisions and one optimistic-locking command
-- for correcting a REGISTERED Dispatch Guide without changing Programming.
--
-- Intentionally excluded:
--   * correction UI
--   * document or incident mutation
--   * batch, invoice or reconciliation mutation
--   * Weekly Batches / Operational Phase 8

begin;

-- ============================================================
-- 1. PRECONDITIONS / LEGACY MUTATION AUDIT
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
    'profiles',
    'units_of_measure',
    'suppliers',
    'project_suppliers',
    'projects',
    'supplier_templates',
    'supplier_template_versions',
    'batch_guides',
    'guide_invoices',
    'audit_events'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'DISPATCH_CORRECTION_REQUIRED_RELATION_MISSING: %', v_table;
    end if;
  end loop;

  if to_regtype('public.dispatch_result') is null then
    raise exception 'DISPATCH_CORRECTION_RESULT_TYPE_MISSING';
  end if;

  if to_regprocedure(
    'app_private.has_project_permission(uuid,text)'
  ) is null
     or to_regprocedure(
       'app_private.is_platform_admin()'
     ) is null
     or to_regprocedure(
       'app_private.sync_dispatch_guide_line_rollup()'
     ) is null then
    raise exception 'DISPATCH_CORRECTION_REQUIRED_HELPER_MISSING';
  end if;

  if to_regclass('public.dispatch_guide_revisions') is not null
     or to_regclass('public.dispatch_guide_revision_lines') is not null then
    raise exception 'DISPATCH_GUIDE_REVISION_RELATION_ALREADY_EXISTS';
  end if;

  if to_regprocedure(
    'app_private.snapshot_dispatch_guide(uuid,uuid,text,text)'
  ) is not null
     or to_regprocedure(
       'public.correct_dispatch_guide_with_lines(uuid,integer,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,numeric,numeric,uuid,jsonb,text)'
     ) is not null then
    raise exception 'DISPATCH_GUIDE_CORRECTION_FUNCTION_ALREADY_EXISTS';
  end if;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'dispatches'
      and c.column_name = 'version'
      and c.is_nullable = 'NO'
  ) then
    raise exception 'DISPATCH_CORRECTION_VERSION_COLUMN_NOT_ALIGNED';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c
      on c.oid = t.tgrelid
    join pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'dispatch_guide_lines'
      and t.tgname = 'dispatch_guide_lines_rollup'
      and t.tgenabled <> 'D'
      and not t.tgisinternal
  ) then
    raise exception 'DISPATCH_GUIDE_LINE_ROLLUP_TRIGGER_NOT_ALIGNED';
  end if;

  -- Live discovery found no command that changes dispatches.result, guide
  -- fields or guide lines. The sole guide UPDATE is the private trigger helper
  -- that derives the documented rollup. Abort if drift introduces a second
  -- path instead of silently leaving a correction bypass.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    cross join lateral (
      select lower(pg_get_functiondef(p.oid)) as definition
    ) source
    where n.nspname in ('public', 'app_private')
      and p.prokind = 'f'
      and (
        source.definition ~
          'update[[:space:]]+public[.]dispatches[[:space:]]+set[^;]*result[[:space:]]*='
        or source.definition ~
          '(update[[:space:]]+public[.]dispatch_guide_lines|delete[[:space:]]+from[[:space:]]+public[.]dispatch_guide_lines)'
        or (
          source.definition ~
            'update[[:space:]]+public[.]dispatch_guides[[:space:]]+set'
          and not (
            n.nspname = 'app_private'
            and p.proname = 'sync_dispatch_guide_line_rollup'
            and pg_get_function_identity_arguments(p.oid) = ''
          )
        )
      )
  ) then
    raise exception 'DISPATCH_GUIDE_LEGACY_MUTATION_BYPASS_REQUIRES_REVIEW';
  end if;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in (
        'dispatches',
        'dispatch_guides',
        'dispatch_guide_lines'
      )
      and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (
        'anon'::name = any(p.roles)
        or 'authenticated'::name = any(p.roles)
        or 'public'::name = any(p.roles)
      )
  ) then
    raise exception 'DISPATCH_GUIDE_BROWSER_MUTATION_POLICY_REQUIRES_REVIEW';
  end if;

  if exists (
    select 1
    from (
      values
        ('dispatches'),
        ('dispatch_guides'),
        ('dispatch_guide_lines')
    ) expected(table_name)
    cross join lateral (
      values
        ('INSERT'),
        ('UPDATE'),
        ('DELETE'),
        ('TRUNCATE'),
        ('REFERENCES'),
        ('TRIGGER')
    ) mutation(privilege_name)
    where has_table_privilege(
      'authenticated',
      format('public.%I', expected.table_name),
      mutation.privilege_name
    )
       or has_table_privilege(
         'anon',
         format('public.%I', expected.table_name),
         mutation.privilege_name
       )
  ) then
    raise exception 'DISPATCH_GUIDE_BROWSER_MUTATION_GRANT_REQUIRES_REVIEW';
  end if;

  if exists (
    select 1
    from public.dispatch_guides dg
    where not exists (
      select 1
      from public.dispatch_guide_lines dgl
      where dgl.guide_id = dg.id
        and dgl.project_id = dg.project_id
    )
  ) then
    raise exception 'DISPATCH_GUIDE_BASELINE_WITHOUT_LINES_REQUIRES_REVIEW';
  end if;

  if exists (
    select 1
    from public.dispatch_guides dg
    join public.dispatches d
      on d.id = dg.dispatch_id
     and d.project_id = dg.project_id
     and d.supplier_id = dg.supplier_id
    where d.result is null
       or dg.template_version_id is null
  ) then
    raise exception 'DISPATCH_GUIDE_BASELINE_CONTEXT_REQUIRES_REVIEW';
  end if;
end;
$$;

-- ============================================================
-- 2. IMMUTABLE GUIDE REVISION SNAPSHOTS
-- ============================================================

create table public.dispatch_guide_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  dispatch_id uuid not null,
  guide_id uuid not null,
  programming_id uuid not null,
  supplier_id uuid not null,
  revision_no integer not null,
  dispatch_version integer not null,
  guide_number text not null,
  order_number text,
  guide_date date not null,
  quantity numeric(12,3) not null,
  dispatched_quantity numeric(12,3) not null,
  received_quantity numeric(12,3) not null,
  returned_quantity numeric(12,3) not null,
  unit_code text not null,
  load_at timestamptz,
  arrival_at timestamptz,
  departure_at timestamptz,
  received_by uuid not null,
  received_by_name text not null,
  result public.dispatch_result not null,
  template_version_id uuid not null,
  provider_extra_data jsonb not null,
  actor_user_id uuid not null,
  action text not null,
  change_reason text,
  created_at timestamptz not null default now(),

  constraint dispatch_guide_revisions_dispatch_context_fk
    foreign key (dispatch_id, project_id, supplier_id)
    references public.dispatches(id, project_id, supplier_id)
    on delete restrict,

  constraint dispatch_guide_revisions_guide_context_fk
    foreign key (guide_id, project_id, supplier_id)
    references public.dispatch_guides(id, project_id, supplier_id)
    on delete restrict,

  constraint dispatch_guide_revisions_programming_context_fk
    foreign key (programming_id, project_id, supplier_id)
    references public.programming(id, project_id, supplier_id)
    on delete restrict,

  constraint dispatch_guide_revisions_unit_code_fk
    foreign key (unit_code)
    references public.units_of_measure(code)
    on delete restrict,

  constraint dispatch_guide_revisions_received_by_fk
    foreign key (received_by)
    references public.profiles(id)
    on delete restrict,

  constraint dispatch_guide_revisions_actor_fk
    foreign key (actor_user_id)
    references public.profiles(id)
    on delete restrict,

  constraint dispatch_guide_revisions_template_version_fk
    foreign key (template_version_id)
    references public.supplier_template_versions(id)
    on delete restrict,

  constraint dispatch_guide_revisions_revision_no_ck
    check (revision_no > 0),

  constraint dispatch_guide_revisions_dispatch_version_ck
    check (dispatch_version > 0),

  constraint dispatch_guide_revisions_receiver_name_ck
    check (nullif(btrim(received_by_name), '') is not null),

  constraint dispatch_guide_revisions_provider_data_ck
    check (jsonb_typeof(provider_extra_data) = 'object'),

  constraint dispatch_guide_revisions_action_reason_ck
    check (
      (
        action = 'DISPATCH_GUIDE_BASELINE'
        and change_reason is null
      )
      or (
        action = 'DISPATCH_GUIDE_CORRECTED'
        and nullif(btrim(change_reason), '') is not null
      )
    ),

  constraint dispatch_guide_revisions_result_quantities_ck
    check (
      quantity > 0
      and dispatched_quantity >= 0
      and received_quantity >= 0
      and returned_quantity >= 0
      and received_quantity + returned_quantity <= dispatched_quantity
      and case result
        when 'COMPLETE' then
          dispatched_quantity = quantity
          and received_quantity = dispatched_quantity
          and returned_quantity = 0
        when 'PARTIAL' then
          dispatched_quantity > 0
          and received_quantity > 0
          and received_quantity < dispatched_quantity
          and returned_quantity = dispatched_quantity - received_quantity
        when 'RETURNED' then
          dispatched_quantity > 0
          and received_quantity = 0
          and returned_quantity = dispatched_quantity
        when 'REJECTED' then
          dispatched_quantity > 0
          and received_quantity = 0
          and returned_quantity = dispatched_quantity
        when 'NOT_DISPATCHED' then
          dispatched_quantity = 0
          and received_quantity = 0
          and returned_quantity = 0
        when 'CANCELLED' then
          dispatched_quantity = 0
          and received_quantity = 0
          and returned_quantity = 0
        else false
      end
    ),

  constraint dispatch_guide_revisions_dispatch_revision_uq
    unique (dispatch_id, revision_no),

  constraint dispatch_guide_revisions_id_project_uq
    unique (id, project_id)
);

create unique index dispatch_guide_revisions_one_baseline_uq
on public.dispatch_guide_revisions(dispatch_id)
where action = 'DISPATCH_GUIDE_BASELINE';

create index idx_dispatch_guide_revisions_guide
on public.dispatch_guide_revisions(guide_id, revision_no);

create table public.dispatch_guide_revision_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  revision_id uuid not null,
  quantity numeric(12,3) not null,
  unit_code text not null,
  product_code text not null,
  product_description text not null,
  position integer not null,
  created_at timestamptz not null default now(),

  constraint dispatch_guide_revision_lines_revision_fk
    foreign key (revision_id, project_id)
    references public.dispatch_guide_revisions(id, project_id)
    on delete restrict,

  constraint dispatch_guide_revision_lines_unit_code_fk
    foreign key (unit_code)
    references public.units_of_measure(code)
    on delete restrict,

  constraint dispatch_guide_revision_lines_quantity_ck
    check (quantity > 0),

  constraint dispatch_guide_revision_lines_position_ck
    check (position > 0),

  constraint dispatch_guide_revision_lines_product_code_ck
    check (nullif(btrim(product_code), '') is not null),

  constraint dispatch_guide_revision_lines_product_description_ck
    check (nullif(btrim(product_description), '') is not null),

  constraint dispatch_guide_revision_lines_position_uq
    unique (revision_id, position)
);

create index idx_dispatch_guide_revision_lines_project
on public.dispatch_guide_revision_lines(project_id, revision_id);

-- ============================================================
-- 3. IMMUTABILITY, RLS AND READ-ONLY BROWSER GRANTS
-- ============================================================

create function app_private.prevent_dispatch_guide_revision_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  raise exception 'DISPATCH_GUIDE_REVISION_IMMUTABLE';
end;
$$;

alter function app_private.prevent_dispatch_guide_revision_mutation()
owner to postgres;

revoke all
on function app_private.prevent_dispatch_guide_revision_mutation()
from public, anon, authenticated;

create trigger dispatch_guide_revisions_immutable
before update or delete
on public.dispatch_guide_revisions
for each row
execute function app_private.prevent_dispatch_guide_revision_mutation();

create trigger dispatch_guide_revision_lines_immutable
before update or delete
on public.dispatch_guide_revision_lines
for each row
execute function app_private.prevent_dispatch_guide_revision_mutation();

alter table public.dispatch_guide_revisions
enable row level security;

alter table public.dispatch_guide_revision_lines
enable row level security;

create policy dispatch_guide_revisions_select
on public.dispatch_guide_revisions
for select
to authenticated
using (
  app_private.has_project_permission(
    project_id,
    'dispatch.view'
  )
);

create policy platform_admin_read_dispatch_guide_revisions
on public.dispatch_guide_revisions
for select
to authenticated
using (
  app_private.is_platform_admin()
);

create policy dispatch_guide_revision_lines_select
on public.dispatch_guide_revision_lines
for select
to authenticated
using (
  app_private.has_project_permission(
    project_id,
    'dispatch.view'
  )
);

create policy platform_admin_read_dispatch_guide_revision_lines
on public.dispatch_guide_revision_lines
for select
to authenticated
using (
  app_private.is_platform_admin()
);

revoke all privileges
on table
  public.dispatch_guide_revisions,
  public.dispatch_guide_revision_lines
from public, anon, authenticated;

grant select
on table
  public.dispatch_guide_revisions,
  public.dispatch_guide_revision_lines
to authenticated;

grant all privileges
on table
  public.dispatch_guide_revisions,
  public.dispatch_guide_revision_lines
to service_role;

-- ============================================================
-- 4. IMMUTABLE SNAPSHOT HELPER
-- ============================================================

create function app_private.snapshot_dispatch_guide(
  p_dispatch_id uuid,
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
  v_dispatch public.dispatches%rowtype;
  v_guide public.dispatch_guides%rowtype;
  v_revision_id uuid;
  v_revision_no integer;
  v_line_count integer;
  v_action text := nullif(btrim(p_action), '');
  v_change_reason text := nullif(btrim(p_change_reason), '');
begin
  if p_actor is null then
    raise exception 'DISPATCH_GUIDE_SNAPSHOT_ACTOR_REQUIRED';
  end if;

  if v_action is null
     or v_action not in (
       'DISPATCH_GUIDE_BASELINE',
       'DISPATCH_GUIDE_CORRECTED'
     ) then
    raise exception 'DISPATCH_GUIDE_SNAPSHOT_ACTION_INVALID';
  end if;

  if v_action = 'DISPATCH_GUIDE_BASELINE'
     and v_change_reason is not null then
    raise exception 'DISPATCH_GUIDE_BASELINE_REASON_NOT_ALLOWED';
  end if;

  if v_action = 'DISPATCH_GUIDE_CORRECTED'
     and v_change_reason is null then
    raise exception 'DISPATCH_CORRECTION_REASON_REQUIRED';
  end if;

  select d.*
  into v_dispatch
  from public.dispatches d
  where d.id = p_dispatch_id
  for update;

  if not found then
    raise exception 'DISPATCH_NOT_FOUND';
  end if;

  select dg.*
  into strict v_guide
  from public.dispatch_guides dg
  where dg.dispatch_id = v_dispatch.id
    and dg.project_id = v_dispatch.project_id
    and dg.supplier_id = v_dispatch.supplier_id;

  if v_dispatch.result is null
     or v_guide.template_version_id is null then
    raise exception 'DISPATCH_GUIDE_SNAPSHOT_CONTEXT_INVALID';
  end if;

  select count(*)::integer
  into v_line_count
  from public.dispatch_guide_lines dgl
  where dgl.guide_id = v_guide.id
    and dgl.project_id = v_guide.project_id;

  if v_line_count = 0 then
    raise exception 'DISPATCH_GUIDE_REQUIRES_PRODUCT_LINE';
  end if;

  if v_action = 'DISPATCH_GUIDE_BASELINE'
     and exists (
       select 1
       from public.dispatch_guide_revisions dgr
       where dgr.dispatch_id = v_dispatch.id
         and dgr.action = 'DISPATCH_GUIDE_BASELINE'
     ) then
    raise exception 'DISPATCH_GUIDE_BASELINE_ALREADY_EXISTS';
  end if;

  select coalesce(max(dgr.revision_no), 0) + 1
  into v_revision_no
  from public.dispatch_guide_revisions dgr
  where dgr.dispatch_id = v_dispatch.id;

  insert into public.dispatch_guide_revisions (
    project_id,
    dispatch_id,
    guide_id,
    programming_id,
    supplier_id,
    revision_no,
    dispatch_version,
    guide_number,
    order_number,
    guide_date,
    quantity,
    dispatched_quantity,
    received_quantity,
    returned_quantity,
    unit_code,
    load_at,
    arrival_at,
    departure_at,
    received_by,
    received_by_name,
    result,
    template_version_id,
    provider_extra_data,
    actor_user_id,
    action,
    change_reason
  )
  values (
    v_dispatch.project_id,
    v_dispatch.id,
    v_guide.id,
    v_dispatch.programming_id,
    v_dispatch.supplier_id,
    v_revision_no,
    v_dispatch.version,
    v_guide.guide_number,
    v_guide.order_number,
    v_guide.guide_date,
    v_guide.quantity,
    v_guide.dispatched_quantity,
    v_guide.received_quantity,
    v_guide.returned_quantity,
    v_guide.unit_code,
    v_guide.load_at,
    v_guide.arrival_at,
    v_guide.departure_at,
    v_guide.received_by,
    v_guide.received_by_name,
    v_dispatch.result,
    v_guide.template_version_id,
    v_guide.provider_extra_data,
    p_actor,
    v_action,
    v_change_reason
  )
  returning id into v_revision_id;

  insert into public.dispatch_guide_revision_lines (
    project_id,
    revision_id,
    quantity,
    unit_code,
    product_code,
    product_description,
    position
  )
  select
    dgl.project_id,
    v_revision_id,
    dgl.quantity,
    dgl.unit_code,
    dgl.product_code,
    dgl.product_description,
    dgl.position
  from public.dispatch_guide_lines dgl
  where dgl.guide_id = v_guide.id
    and dgl.project_id = v_guide.project_id
  order by dgl.position;

  return v_revision_id;
exception
  when no_data_found then
    raise exception 'DISPATCH_GUIDE_NOT_FOUND';
  when too_many_rows then
    raise exception 'DISPATCH_GUIDE_CONTEXT_AMBIGUOUS';
end;
$$;

alter function app_private.snapshot_dispatch_guide(uuid, uuid, text, text)
owner to postgres;

revoke all
on function app_private.snapshot_dispatch_guide(uuid, uuid, text, text)
from public, anon, authenticated;

-- ============================================================
-- 5. BASELINE FOR GUIDES PRESENT AT MANUAL EXECUTION
-- ============================================================

-- Serialize the baseline with registration and line mutation. The snapshot
-- copies only the current state; it does not infer or fabricate prior states.
lock table public.dispatches in share row exclusive mode;
lock table public.dispatch_guides in share row exclusive mode;
lock table public.dispatch_guide_lines in share row exclusive mode;

do $$
declare
  v_guide record;
begin
  for v_guide in
    select dg.dispatch_id, dg.received_by
    from public.dispatch_guides dg
    order by dg.created_at, dg.id
  loop
    perform app_private.snapshot_dispatch_guide(
      v_guide.dispatch_id,
      v_guide.received_by,
      'DISPATCH_GUIDE_BASELINE',
      null
    );
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.dispatch_guides dg
    left join public.dispatch_guide_revisions dgr
      on dgr.guide_id = dg.id
     and dgr.dispatch_id = dg.dispatch_id
     and dgr.action = 'DISPATCH_GUIDE_BASELINE'
    group by dg.id
    having count(dgr.id) <> 1
  ) then
    raise exception 'DISPATCH_GUIDE_BASELINE_INCOMPLETE';
  end if;

  if exists (
    select 1
    from public.dispatch_guide_revisions dgr
    where dgr.action = 'DISPATCH_GUIDE_BASELINE'
      and (
        select count(*)
        from public.dispatch_guide_revision_lines dgrl
        where dgrl.revision_id = dgr.id
      ) <> (
        select count(*)
        from public.dispatch_guide_lines dgl
        where dgl.guide_id = dgr.guide_id
          and dgl.project_id = dgr.project_id
      )
  ) then
    raise exception 'DISPATCH_GUIDE_BASELINE_LINES_INCOMPLETE';
  end if;
end;
$$;

-- ============================================================
-- 6. CANONICAL OPTIMISTIC-LOCKING CORRECTION RPC
-- ============================================================

create function public.correct_dispatch_guide_with_lines(
  p_dispatch_id uuid,
  p_expected_version integer,
  p_guide_number text,
  p_order_number text,
  p_guide_date date,
  p_received_by_name text,
  p_lines jsonb,
  p_load_at timestamptz,
  p_arrival_at timestamptz,
  p_departure_at timestamptz,
  p_result public.dispatch_result,
  p_dispatched_quantity numeric,
  p_received_quantity numeric,
  p_template_version_id uuid,
  p_provider_extra_data jsonb,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_guide public.dispatch_guides%rowtype;
  v_company_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
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
  v_result_changed boolean;
  v_new_version integer;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select d.*
  into v_dispatch
  from public.dispatches d
  where d.id = p_dispatch_id
  for update;

  if not found then
    raise exception 'DISPATCH_NOT_FOUND';
  end if;

  if not app_private.has_project_permission(
    v_dispatch.project_id,
    'dispatch.modify'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if p_expected_version is null then
    raise exception 'DISPATCH_EXPECTED_VERSION_REQUIRED';
  end if;

  if v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;

  if v_dispatch.status <> 'REGISTERED' then
    raise exception 'DISPATCH_NOT_EDITABLE';
  end if;

  select dg.*
  into strict v_guide
  from public.dispatch_guides dg
  where dg.dispatch_id = v_dispatch.id
    and dg.project_id = v_dispatch.project_id
    and dg.supplier_id = v_dispatch.supplier_id
  for update;

  if exists (
    select 1
    from public.batch_guides bg
    where bg.guide_id = v_guide.id
      and bg.project_id = v_guide.project_id
  ) then
    raise exception 'DISPATCH_GUIDE_BATCH_LOCKED';
  end if;

  if exists (
    select 1
    from public.guide_invoices gi
    where gi.guide_id = v_guide.id
      and gi.project_id = v_guide.project_id
  ) then
    raise exception 'DISPATCH_GUIDE_INVOICE_LOCKED';
  end if;

  if v_reason is null then
    raise exception 'DISPATCH_CORRECTION_REASON_REQUIRED';
  end if;

  if char_length(v_reason) > 1000 then
    raise exception 'DISPATCH_CORRECTION_REASON_INVALID';
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
    where jsonb_typeof(item.value) is distinct from 'object'
       or jsonb_typeof(item.value -> 'quantity') is distinct from 'number'
       or (item.value ->> 'quantity')::numeric <= 0
       or jsonb_typeof(item.value -> 'unit_code') is distinct from 'string'
       or nullif(btrim(item.value ->> 'unit_code'), '') is null
       or jsonb_typeof(item.value -> 'product_code') is distinct from 'string'
       or nullif(btrim(item.value ->> 'product_code'), '') is null
       or jsonb_typeof(item.value -> 'product_description') is distinct from 'string'
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

  select p.company_id
  into v_company_id
  from public.projects p
  where p.id = v_dispatch.project_id
    and p.status = 'ACTIVE';

  if not found then
    raise exception 'DISPATCH_PROJECT_INACTIVE';
  end if;

  if not exists (
    select 1
    from public.suppliers s
    where s.id = v_dispatch.supplier_id
      and s.company_id = v_company_id
      and s.active = true
  ) then
    raise exception 'DISPATCH_SUPPLIER_INACTIVE';
  end if;

  if not exists (
    select 1
    from public.project_suppliers ps
    where ps.project_id = v_dispatch.project_id
      and ps.company_id = v_company_id
      and ps.supplier_id = v_dispatch.supplier_id
      and ps.active = true
  ) then
    raise exception 'DISPATCH_SUPPLIER_NOT_LINKED';
  end if;

  if v_template_version_id is null then
    select
      count(*)::integer,
      (array_agg(
        stv.id
        order by
          stv.published_at desc nulls last,
          stv.version desc,
          stv.id
      ))[1]
    into v_template_count, v_template_version_id
    from public.supplier_templates st
    join public.supplier_template_versions stv
      on stv.template_id = st.id
    where st.supplier_id = v_dispatch.supplier_id
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
      and st.supplier_id = v_dispatch.supplier_id
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

  -- A guide created after this migration receives its original-state baseline
  -- lazily, immediately before its first correction. Existing guides already
  -- received the same snapshot during the migration backfill above.
  if not exists (
    select 1
    from public.dispatch_guide_revisions dgr
    where dgr.dispatch_id = v_dispatch.id
      and dgr.action = 'DISPATCH_GUIDE_BASELINE'
  ) then
    perform app_private.snapshot_dispatch_guide(
      v_dispatch.id,
      v_guide.received_by,
      'DISPATCH_GUIDE_BASELINE',
      null
    );
  end if;

  -- Keep at least one line throughout the replacement so the existing AFTER
  -- ROW rollup trigger never observes an empty guide. Homogenize the old rows
  -- first so it also never observes mixed units during a unit-code change.
  update public.dispatch_guide_lines dgl
  set unit_code = v_unit_code
  where dgl.guide_id = v_guide.id
    and dgl.project_id = v_guide.project_id
    and dgl.unit_code is distinct from v_unit_code;

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
    v_guide.project_id,
    v_guide.id,
    (item.value ->> 'quantity')::numeric(12,3),
    btrim(item.value ->> 'unit_code'),
    btrim(item.value ->> 'product_code'),
    btrim(item.value ->> 'product_description'),
    item.position::integer
  from jsonb_array_elements(p_lines)
       with ordinality as item(value, position)
  on conflict on constraint dispatch_guide_lines_position_uq
  do update
  set quantity = excluded.quantity,
      unit_code = excluded.unit_code,
      product_code = excluded.product_code,
      product_description = excluded.product_description;

  delete from public.dispatch_guide_lines dgl
  where dgl.guide_id = v_guide.id
    and dgl.project_id = v_guide.project_id
    and dgl.position > v_line_count;

  if not exists (
    select 1
    from public.dispatch_guides dg
    where dg.id = v_guide.id
      and dg.quantity = v_total_quantity
      and dg.unit_code = v_unit_code
      and dg.product_code is not distinct from v_single_product_code
      and dg.product_description is not distinct from
          v_single_product_description
  ) then
    raise exception 'DISPATCH_GUIDE_LINE_ROLLUP_MISMATCH';
  end if;

  update public.dispatch_guides
  set template_version_id = v_template_version_id,
      guide_number = btrim(p_guide_number),
      order_number = nullif(btrim(p_order_number), ''),
      guide_date = p_guide_date,
      dispatched_quantity = v_dispatched_quantity,
      received_quantity = v_received_quantity,
      returned_quantity = v_returned_quantity,
      load_at = p_load_at,
      arrival_at = p_arrival_at,
      departure_at = p_departure_at,
      received_by_name = btrim(p_received_by_name),
      provider_extra_data = coalesce(p_provider_extra_data, '{}'::jsonb),
      updated_at = now()
  where id = v_guide.id;

  v_result_changed := v_dispatch.result is distinct from p_result;
  v_new_version := v_dispatch.version + 1;

  update public.dispatches
  set result = p_result,
      version = v_new_version,
      updated_at = now()
  where id = v_dispatch.id;

  perform app_private.snapshot_dispatch_guide(
    v_dispatch.id,
    v_actor,
    'DISPATCH_GUIDE_CORRECTED',
    v_reason
  );

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    new_values,
    comment
  )
  values (
    v_actor,
    v_company_id,
    v_dispatch.project_id,
    'dispatch_guide',
    v_guide.id,
    'GUIDE_CORRECTED',
    jsonb_build_object(
      'dispatch_id', v_dispatch.id,
      'guide_id', v_guide.id,
      'previous_version', v_dispatch.version,
      'new_version', v_new_version,
      'result_changed', v_result_changed,
      'reason', v_reason
    ),
    v_reason
  );

  if v_result_changed then
    insert into public.audit_events (
      actor_user_id,
      company_id,
      project_id,
      entity_type,
      entity_id,
      action,
      new_values,
      comment
    )
    values (
      v_actor,
      v_company_id,
      v_dispatch.project_id,
      'dispatch',
      v_dispatch.id,
      'DISPATCH_RESULT_CHANGED',
      jsonb_build_object(
        'dispatch_id', v_dispatch.id,
        'guide_id', v_guide.id,
        'previous_version', v_dispatch.version,
        'new_version', v_new_version,
        'result_changed', true,
        'previous_result', v_dispatch.result,
        'new_result', p_result,
        'reason', v_reason
      ),
      v_reason
    );
  end if;

  return v_new_version;
exception
  when no_data_found then
    raise exception 'DISPATCH_GUIDE_NOT_FOUND';
  when too_many_rows then
    raise exception 'DISPATCH_GUIDE_CONTEXT_AMBIGUOUS';
end;
$$;

alter function public.correct_dispatch_guide_with_lines(
  uuid,
  integer,
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
  jsonb,
  text
)
owner to postgres;

revoke all
on function public.correct_dispatch_guide_with_lines(
  uuid,
  integer,
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
  jsonb,
  text
)
from public, anon;

grant execute
on function public.correct_dispatch_guide_with_lines(
  uuid,
  integer,
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
  jsonb,
  text
)
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
    'public.correct_dispatch_guide_with_lines(uuid,integer,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,numeric,numeric,uuid,jsonb,text)'
  ) is null then
    raise exception 'DISPATCH_GUIDE_CORRECTION_SIGNATURE_MISSING';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.correct_dispatch_guide_with_lines(uuid,integer,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,numeric,numeric,uuid,jsonb,text)',
    'EXECUTE'
  )
     or has_function_privilege(
       'anon',
       'public.correct_dispatch_guide_with_lines(uuid,integer,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,numeric,numeric,uuid,jsonb,text)',
       'EXECUTE'
     ) then
    raise exception 'DISPATCH_GUIDE_CORRECTION_RPC_GRANT_NOT_ALIGNED';
  end if;

  if has_function_privilege(
    'authenticated',
    'app_private.snapshot_dispatch_guide(uuid,uuid,text,text)',
    'EXECUTE'
  )
     or has_function_privilege(
       'anon',
       'app_private.snapshot_dispatch_guide(uuid,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception 'DISPATCH_GUIDE_SNAPSHOT_HELPER_EXPOSED';
  end if;

  foreach v_table in array array[
    'dispatch_guide_revisions',
    'dispatch_guide_revision_lines'
  ]
  loop
    if not has_table_privilege(
      'authenticated',
      format('public.%I', v_table),
      'SELECT'
    ) then
      raise exception 'DISPATCH_GUIDE_REVISION_AUTH_SELECT_MISSING: %',
        v_table;
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
          'DISPATCH_GUIDE_REVISION_AUTH_MUTATION_REMAINS: %.%',
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
        raise exception 'DISPATCH_GUIDE_REVISION_ANON_PRIVILEGE_REMAINS: %.%',
          v_table,
          v_privilege;
      end if;

      if not has_table_privilege(
        'service_role',
        format('public.%I', v_table),
        v_privilege
      ) then
        raise exception 'DISPATCH_GUIDE_REVISION_SERVICE_PRIVILEGE_MISSING: %.%',
          v_table,
          v_privilege;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in (
        'dispatch_guide_revisions',
        'dispatch_guide_revision_lines'
      )
      and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (
        'anon'::name = any(p.roles)
        or 'authenticated'::name = any(p.roles)
        or 'public'::name = any(p.roles)
      )
  ) then
    raise exception 'DISPATCH_GUIDE_REVISION_BROWSER_MUTATION_POLICY_PRESENT';
  end if;

  if exists (
    select 1
    from (
      values
        ('dispatch_guide_revisions', 'dispatch_guide_revisions_select'),
        ('dispatch_guide_revision_lines', 'dispatch_guide_revision_lines_select')
    ) expected(table_name, policy_name)
    where not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = expected.table_name
        and p.policyname = expected.policy_name
        and p.cmd = 'SELECT'
        and 'authenticated'::name = any(p.roles)
        and position('dispatch.view' in coalesce(p.qual, '')) > 0
        and position('is_project_member' in coalesce(p.qual, '')) = 0
    )
  ) then
    raise exception 'DISPATCH_GUIDE_REVISION_OPERATIONAL_POLICY_NOT_ALIGNED';
  end if;

  if exists (
    select 1
    from (
      values
        ('dispatch_guide_revisions'),
        ('dispatch_guide_revision_lines')
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
    raise exception 'DISPATCH_GUIDE_REVISION_PLATFORM_ADMIN_POLICY_MISSING';
  end if;

  if exists (
    select 1
    from (
      values
        ('dispatch_guide_revisions', 'dispatch_guide_revisions_immutable'),
        ('dispatch_guide_revision_lines', 'dispatch_guide_revision_lines_immutable')
    ) expected(table_name, trigger_name)
    where not exists (
      select 1
      from pg_trigger t
      join pg_class c
        on c.oid = t.tgrelid
      join pg_namespace n
        on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = expected.table_name
        and t.tgname = expected.trigger_name
        and t.tgenabled <> 'D'
        and not t.tgisinternal
    )
  ) then
    raise exception 'DISPATCH_GUIDE_REVISION_IMMUTABILITY_TRIGGER_MISSING';
  end if;

  if exists (
    select 1
    from public.dispatch_guides dg
    left join public.dispatch_guide_revisions dgr
      on dgr.guide_id = dg.id
     and dgr.dispatch_id = dg.dispatch_id
     and dgr.action = 'DISPATCH_GUIDE_BASELINE'
    group by dg.id
    having count(dgr.id) <> 1
  ) then
    raise exception 'DISPATCH_GUIDE_BASELINE_LOST';
  end if;

  -- After adding the canonical RPC, these are the only allowed mutation paths:
  -- the private rollup helper and this correction function. Any future path
  -- makes the migration fail under drift review instead of becoming a bypass.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    cross join lateral (
      select lower(pg_get_functiondef(p.oid)) as definition
    ) source
    where n.nspname in ('public', 'app_private')
      and p.prokind = 'f'
      and (
        source.definition ~
          'update[[:space:]]+public[.]dispatches[[:space:]]+set[^;]*result[[:space:]]*='
        or source.definition ~
          '(update[[:space:]]+public[.]dispatch_guide_lines|delete[[:space:]]+from[[:space:]]+public[.]dispatch_guide_lines)'
        or source.definition ~
          'update[[:space:]]+public[.]dispatch_guides[[:space:]]+set'
      )
      and p.oid <>
        'app_private.sync_dispatch_guide_line_rollup()'::regprocedure
      and p.oid <>
        'public.correct_dispatch_guide_with_lines(uuid,integer,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,numeric,numeric,uuid,jsonb,text)'::regprocedure
  ) then
    raise exception 'DISPATCH_GUIDE_MUTATION_BYPASS_PRESENT';
  end if;

  if exists (
    select 1
    from (
      values
        ('dispatch_guide_revisions'),
        ('dispatch_guide_revision_lines')
    ) expected(table_name)
    where not exists (
      select 1
      from pg_class c
      join pg_namespace n
        on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = expected.table_name
        and c.relrowsecurity is true
    )
  ) then
    raise exception 'DISPATCH_GUIDE_REVISION_RLS_LOST';
  end if;
end;
$$;

-- ============================================================
-- 8. QA PLAN — RUN ONLY AFTER MANUAL EXECUTION
-- ============================================================

-- Run live QA in deliberately reversible transactions and restore all rows:
--   * basic correction changes guide fields and increments dispatch.version;
--   * line add/update/remove preserves positions and the documented rollup;
--   * COMPLETE -> PARTIAL and PARTIAL -> COMPLETE preserve 055 invariants;
--   * RETURNED -> REJECTED remains valid with received_quantity = 0;
--   * reject mixed units, inactive units and invalid physical quantities;
--   * reject inactive, unpublished, wrong-supplier and wrong-company templates;
--   * reject a stale p_expected_version with DISPATCH_VERSION_CONFLICT;
--   * reject users without dispatch.modify and PLATFORM_ADMIN without it;
--   * reject any guide with active or historical batch_guides association;
--   * reject any guide with a guide_invoices association;
--   * confirm Programming.status and Programming.version never change;
--   * confirm guide documents, incidents, invoices and batches never change;
--   * confirm exactly one baseline and one resultant corrected snapshot;
--   * confirm snapshot lines exactly match the resultant guide lines;
--   * reject UPDATE and DELETE on both revision tables, including service_role;
--   * confirm GUIDE_CORRECTED and conditional DISPATCH_RESULT_CHANGED audits;
--   * confirm audit metadata has the six minimum fields and no full snapshot;
--   * confirm dispatch.view reads revisions without project membership bypass;
--   * confirm member without dispatch.view reads zero revision rows;
--   * confirm PLATFORM_ADMIN global reads remain independent and anon reads 0;
--   * confirm authenticated SELECT-only, anon none and RPC EXECUTE grants;
--   * rollback QA rows and compare Dispatch, Guide, line, revision and audit
--     counts before/after for a clean result.

-- UI follow-up only after manual execution and live QA approval:
--   * add "Corregir guía" on /dispatches/[id];
--   * show only with dispatch.modify, REGISTERED, no batch and no invoice;
--   * reuse RegisterDispatchDialog components where practical.
-- No UI change is included in this migration.

commit;
