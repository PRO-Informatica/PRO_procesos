-- 085_phase3_legacy_cleanup.sql
-- APPLIED SUCCESSFULLY — EXECUTED ON 2026-09-03.
--
-- Phase 3, part C: remove the Guide/Order-based batch and reconciliation
-- architecture after its consumers have moved to Dispatch-level models.

begin;

do $$
begin
  if to_regclass('public.batch_dispatches') is null
     or to_regclass('public.dispatch_reconciliations') is null
     or to_regclass('public.dispatch_reconciliation_attempts') is null
     or to_regclass('public.invoice_extractions') is null
     or to_regclass('public.permissions') is null
     or to_regclass('public.role_permissions') is null
     or to_regtype('public.invoice_status') is null
     or to_regclass('public.batch_guides') is null
     or to_regclass('public.guide_invoices') is null
     or to_regclass('public.reconciliation_orders') is null
     or to_regclass('public.reconciliation_order_invoices') is null
     or to_regclass('public.reconciliation_order_lines') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'dispatch_guides'
         and column_name = 'order_number'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'dispatch_guides'
         and column_name = 'supplier_id'
     ) then
    raise exception 'PHASE3_REPLACEMENT_ARCHITECTURE_MISSING';
  end if;
end;
$$;

-- Remove only triggers backed by the approved legacy helpers. This includes
-- triggers attached to tables that remain valid in Phase 3, such as invoices
-- and dispatch_guide_lines, so dropping the legacy tables alone is not enough.
do $$
declare
  v_trigger record;
begin
  for v_trigger in
    select table_namespace.nspname table_schema,
      relation.relname table_name,
      trigger.tgname trigger_name
    from pg_catalog.pg_trigger trigger
    join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc procedure on procedure.oid = trigger.tgfoid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = procedure.pronamespace
    where not trigger.tgisinternal
      and function_namespace.nspname = 'app_private'
      and procedure.proname = any(array[
        'sync_reconciliation_order_change',
        'guard_mixto_listo_order_assignment',
        'audit_reconciliation_order_completion',
        'transfer_reconciliation_order_on_rollover',
        'trigger_programming_completion_from_order',
        'enforce_guide_invoice_period',
        'enforce_invoice_date_period'
      ])
  loop
    execute format('drop trigger %I on %I.%I',
      v_trigger.trigger_name, v_trigger.table_schema, v_trigger.table_name);
  end loop;
end;
$$;

-- Drop old RPC/helper consumers by name. All approved functions are supplied
-- to one DROP statement so dependencies among them do not depend on catalog
-- iteration order. No CASCADE: an unplanned dependent object stops deployment.
do $$
declare
  v_functions text;
begin
  select string_agg(
    format('%I.%I(%s)', namespace.nspname, procedure.proname,
      pg_get_function_identity_arguments(procedure.oid)),
    ', ' order by namespace.nspname, procedure.proname, procedure.oid
  )
  into v_functions
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'app_private')
      and procedure.prokind = 'f'
      and procedure.proname = any(array[
        'add_guide_to_batch',
        'remove_guide_from_batch',
        'submit_batch_for_review',
        'validate_batch',
        'request_batch_authorization',
        'authorize_batch',
        'return_batch',
        'reopen_batch',
        'prepare_batch_invoice_upload',
        'prepare_order_invoice_upload',
        'prepare_order_service_invoice_upload',
        'finalize_order_service_invoice_upload',
        'assign_invoice_to_reconciliation_order',
        'start_reconciliation_order_validation',
        'close_reconciliation_order',
        'request_order_product_reinvoicing',
        'reconcile_batch_invoice',
        'evaluate_guide_invoice_match',
        'review_invoice',
        'enforce_guide_invoice_period',
        'enforce_invoice_date_period',
        'prepare_mixto_listo_invoice_intake',
        'finalize_mixto_listo_invoice_upload',
        'fail_mixto_listo_invoice_upload',
        'register_mixto_listo_invoice_extraction',
        'confirm_mixto_listo_invoice_intake',
        'discard_mixto_listo_invoice_intake',
        'register_invoice_extraction_proposal',
        'confirm_invoice_extraction',
        'ensure_reconciliation_orders_for_batch',
        'recalculate_reconciliation_order',
        'sync_reconciliation_order_change',
        'transfer_reconciliation_order_on_rollover',
        'audit_reconciliation_order_completion',
        'reconciliation_order_lifecycle',
        'guard_mixto_listo_order_assignment',
        'mixto_listo_order_from_pca',
        'normalize_reconciliation_order_number',
        'guide_ready_for_batch',
        'sync_programming_completion_from_order',
        'trigger_programming_completion_from_order',
        'correct_dispatch_guide_order_number',
        'correct_dispatch_guide_with_lines'
      ]);

  if v_functions is not null then
    execute 'drop function ' || v_functions;
  end if;
end;
$$;

-- Abort before destructive DDL when an unplanned database view still reads a
-- legacy aggregate. Known guide mutation RPCs are replaced later in this same
-- transaction; every other application/SQL consumer must already be migrated.
do $$
declare
  v_dependents text;
begin
  select string_agg(distinct dependency.view_schema || '.' || dependency.view_name, ', ')
  into v_dependents
  from (
    select usage.view_schema, usage.view_name
    from information_schema.view_table_usage usage
    where usage.table_schema = 'public'
      and usage.table_name in (
        'batch_guides',
        'guide_invoices',
        'reconciliation_orders',
        'reconciliation_order_invoices',
        'reconciliation_order_lines'
      )
    union
    select usage.view_schema, usage.view_name
    from information_schema.view_column_usage usage
    where usage.table_schema = 'public'
      and usage.table_name = 'dispatch_guides'
      and usage.column_name in ('order_number', 'supplier_id')
  ) dependency;

  if v_dependents is not null then
    raise exception 'PHASE3_LEGACY_VIEW_DEPENDENCIES_REMAIN:%', v_dependents;
  end if;
end;
$$;

-- DROP without CASCADE is the final dependency guard: any remaining FK,
-- view, materialized view or other tracked object aborts the transaction.
drop table if exists public.invoice_extraction_validations;
drop table if exists public.invoice_discrepancies;
drop table if exists public.invoice_reviews;
drop table if exists public.mixto_listo_invoice_intakes;
drop table if exists public.reconciliation_order_lines;
drop table if exists public.reconciliation_order_invoices;
drop table if exists public.reconciliation_orders;
drop table if exists public.guide_invoices;
drop table if exists public.batch_authorizations;
drop table if exists public.batch_documents;
drop table if exists public.batch_guides;

delete from public.role_permissions
where permission_id in (
  select id from public.permissions where code = 'batch.add_guide'
);
delete from public.permissions where code = 'batch.add_guide';

-- Baseline functions can depend on legacy enums through their signatures even
-- when their bodies are not present in this repository. Discover those exact
-- catalog dependencies, remove any triggers backed by them, and drop all such
-- routines together. This keeps the cleanup complete without using CASCADE.
do $$
declare
  v_trigger record;
  v_functions text;
  v_procedures text;
begin
  for v_trigger in
    select table_namespace.nspname table_schema,
      relation.relname table_name,
      trigger.tgname trigger_name
    from pg_catalog.pg_trigger trigger
    join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = relation.relnamespace
    where not trigger.tgisinternal
      and trigger.tgfoid in (
        select distinct procedure.oid
        from pg_catalog.pg_proc procedure
        join pg_catalog.pg_namespace function_namespace
          on function_namespace.oid = procedure.pronamespace
        join pg_catalog.pg_depend dependency
          on dependency.classid = 'pg_proc'::regclass
         and dependency.objid = procedure.oid
         and dependency.refclassid = 'pg_type'::regclass
        join pg_catalog.pg_type legacy_type
          on legacy_type.oid = dependency.refobjid
        join pg_catalog.pg_namespace type_namespace
          on type_namespace.oid = legacy_type.typnamespace
        where function_namespace.nspname in ('public', 'app_private')
          and type_namespace.nspname = 'public'
          and legacy_type.typname = any(array[
            'mixto_listo_invoice_intake_status',
            'order_line_reconciliation_status',
            'order_reconciliation_status',
            'order_document_status',
            'review_decision',
            'discrepancy_type',
            'authorization_action',
            'invoice_status'
          ])
      )
  loop
    execute format('drop trigger %I on %I.%I',
      v_trigger.trigger_name, v_trigger.table_schema, v_trigger.table_name);
  end loop;

  select string_agg(
    format('%I.%I(%s)', function_namespace.nspname, procedure.proname,
      pg_get_function_identity_arguments(procedure.oid)),
    ', ' order by function_namespace.nspname, procedure.proname, procedure.oid
  ) filter (where procedure.prokind = 'f'),
  string_agg(
    format('%I.%I(%s)', function_namespace.nspname, procedure.proname,
      pg_get_function_identity_arguments(procedure.oid)),
    ', ' order by function_namespace.nspname, procedure.proname, procedure.oid
  ) filter (where procedure.prokind = 'p')
  into v_functions, v_procedures
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace function_namespace
    on function_namespace.oid = procedure.pronamespace
  where function_namespace.nspname in ('public', 'app_private')
    and procedure.oid in (
      select dependency.objid
      from pg_catalog.pg_depend dependency
      join pg_catalog.pg_type legacy_type
        on legacy_type.oid = dependency.refobjid
      join pg_catalog.pg_namespace type_namespace
        on type_namespace.oid = legacy_type.typnamespace
      where dependency.classid = 'pg_proc'::regclass
        and dependency.refclassid = 'pg_type'::regclass
        and type_namespace.nspname = 'public'
        and legacy_type.typname = any(array[
          'mixto_listo_invoice_intake_status',
          'order_line_reconciliation_status',
          'order_reconciliation_status',
          'order_document_status',
          'review_decision',
          'discrepancy_type',
          'authorization_action',
          'invoice_status'
        ])
    );

  if v_functions is not null then
    execute 'drop function ' || v_functions;
  end if;
  if v_procedures is not null then
    execute 'drop procedure ' || v_procedures;
  end if;
end;
$$;

drop type if exists public.mixto_listo_invoice_intake_status;
drop type if exists public.order_line_reconciliation_status;
drop type if exists public.order_reconciliation_status;
drop type if exists public.order_document_status;
drop type if exists public.review_decision;
drop type if exists public.discrepancy_type;
drop type if exists public.authorization_action;

alter table public.invoices alter column status drop default;
create type public.invoice_status_phase3 as enum (
  'REGISTERED', 'SUPERSEDED', 'NON_PROCEEDING', 'CANCELLED'
);
alter table public.invoices
  alter column status type public.invoice_status_phase3
  using (
    case
      when status::text in ('SUPERSEDED', 'NON_PROCEEDING', 'CANCELLED')
        then status::text
      else 'REGISTERED'
    end
  )::public.invoice_status_phase3;
drop type public.invoice_status;
alter type public.invoice_status_phase3 rename to invoice_status;
alter table public.invoices alter column status set default 'REGISTERED';

drop trigger if exists dispatch_guide_order_number_guard
on public.dispatch_guides;
drop function if exists app_private.guard_dispatch_guide_order_number();

alter table public.dispatch_guides drop column order_number;
alter table public.dispatch_guides drop column supplier_id;

-- Dispatch is now the only source of truth for Pedido / Control Operación.
create or replace function public.update_dispatch(
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
  if p_expected_version is null then
    raise exception 'DISPATCH_VERSION_REQUIRED';
  end if;

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

-- Guide mutations now depend on their parent Dispatch for supplier/order data.
-- Being inside a Batch does not lock an IN_EXECUTION Dispatch.
create or replace function public.create_dispatch_guide_with_lines(
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
  select * into v_dispatch from public.dispatches
  where id = p_dispatch_id for update;
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
  select * into v_programming from public.programming
  where id = v_dispatch.programming_id;
  select validated.line_count, validated.total_quantity, validated.unit_code
  into v_count, v_total, v_unit
  from app_private.validate_dispatch_guide_lines_payload(p_lines) validated;
  if v_unit is distinct from v_programming.unit_code then
    raise exception 'DISPATCH_PROGRAMMING_UNIT_MISMATCH';
  end if;
  begin
    insert into public.dispatch_guides(
      id, project_id, dispatch_id, guide_number, guide_date,
      quantity, unit_code, created_by
    ) values (
      v_guide_id, v_dispatch.project_id, v_dispatch.id,
      btrim(p_guide_number), p_guide_date, v_total, v_unit, v_actor
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
    btrim(item.value ->> 'product_description'), item.position::integer
  from jsonb_array_elements(p_lines)
       with ordinality item(value, position);
  update public.dispatches set version = version + 1, updated_at = now()
  where id = v_dispatch.id;
  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id, action, new_values
  ) values (
    v_actor, v_dispatch.project_id, 'dispatch_guide', v_guide_id,
    'DISPATCH_GUIDE_ADDED', jsonb_build_object(
      'dispatch_id', v_dispatch.id, 'guide_number', btrim(p_guide_number),
      'product_count', v_count, 'quantity', v_total, 'unit_code', v_unit
    )
  );
  return jsonb_build_object(
    'guide_id', v_guide_id,
    'dispatch_version', v_dispatch.version + 1
  );
end;
$$;

create or replace function public.update_dispatch_guide_with_lines(
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
  v_count integer;
  v_total numeric(12,3);
  v_unit text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(btrim(p_guide_number), '') is null then
    raise exception 'GUIDE_NUMBER_REQUIRED';
  end if;
  if p_guide_date is null then raise exception 'GUIDE_DATE_REQUIRED'; end if;
  select * into v_guide from public.dispatch_guides where id = p_guide_id;
  if not found then raise exception 'DISPATCH_GUIDE_NOT_FOUND'; end if;
  select * into v_dispatch from public.dispatches
  where id = v_guide.dispatch_id for update;
  if not app_private.has_project_permission(
    v_dispatch.project_id, 'dispatch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  select unit_code into v_programming_unit from public.programming
  where id = v_dispatch.programming_id;
  select validated.line_count, validated.total_quantity, validated.unit_code
  into v_count, v_total, v_unit
  from app_private.validate_dispatch_guide_lines_payload(p_lines) validated;
  if v_unit is distinct from v_programming_unit then
    raise exception 'DISPATCH_PROGRAMMING_UNIT_MISMATCH';
  end if;
  begin
    update public.dispatch_guides
    set guide_number = btrim(p_guide_number), guide_date = p_guide_date,
        quantity = v_total, unit_code = v_unit, updated_at = now()
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
    btrim(item.value ->> 'product_description'), item.position::integer
  from jsonb_array_elements(p_lines) with ordinality item(value, position)
  on conflict on constraint dispatch_guide_lines_position_uq do update
  set quantity = excluded.quantity, unit_code = excluded.unit_code,
      product_code = excluded.product_code,
      product_description = excluded.product_description;
  delete from public.dispatch_guide_lines
  where guide_id = v_guide.id and position > v_count;
  update public.dispatches set version = version + 1, updated_at = now()
  where id = v_dispatch.id;
  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id,
    action, old_values, new_values
  ) values (
    v_actor, v_dispatch.project_id, 'dispatch_guide', v_guide.id,
    'DISPATCH_GUIDE_UPDATED',
    jsonb_build_object('guide_number', v_guide.guide_number,
      'guide_date', v_guide.guide_date, 'quantity', v_guide.quantity),
    jsonb_build_object('guide_number', btrim(p_guide_number),
      'guide_date', p_guide_date, 'product_count', v_count,
      'quantity', v_total, 'unit_code', v_unit)
  );
  return v_dispatch.version + 1;
end;
$$;

create or replace function public.delete_dispatch_guide(
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
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_guide from public.dispatch_guides where id = p_guide_id;
  if not found then raise exception 'DISPATCH_GUIDE_NOT_FOUND'; end if;
  select * into v_dispatch from public.dispatches
  where id = v_guide.dispatch_id for update;
  if not app_private.has_project_permission(
    v_dispatch.project_id, 'dispatch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  if exists (select 1 from public.guide_documents where guide_id = v_guide.id)
  then raise exception 'DISPATCH_GUIDE_HAS_EVIDENCE'; end if;
  delete from public.dispatch_guides where id = v_guide.id;
  update public.dispatches set version = version + 1, updated_at = now()
  where id = v_dispatch.id;
  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id,
    action, old_values, new_values
  ) values (
    v_actor, v_dispatch.project_id, 'dispatch_guide', v_guide.id,
    'DISPATCH_GUIDE_DELETED', jsonb_build_object(
      'dispatch_id', v_dispatch.id, 'guide_number', v_guide.guide_number,
      'quantity', v_guide.quantity, 'unit_code', v_guide.unit_code
    ), jsonb_build_object('dispatch_version', v_dispatch.version + 1)
  );
  return v_dispatch.version + 1;
end;
$$;

alter function public.create_dispatch_guide_with_lines(
  uuid,integer,text,date,jsonb
) owner to postgres;
alter function public.update_dispatch_guide_with_lines(
  uuid,integer,text,date,jsonb
) owner to postgres;
alter function public.delete_dispatch_guide(uuid,integer) owner to postgres;

do $$
declare
  v_relations text;
  v_columns text;
  v_routines text;
begin
  select string_agg(name, ', ' order by name)
  into v_relations
  from unnest(array[
    'batch_guides',
    'guide_invoices',
    'reconciliation_orders',
    'reconciliation_order_invoices',
    'reconciliation_order_lines'
  ]) name
  where to_regclass('public.' || name) is not null;

  select string_agg(column_name, ', ' order by column_name)
  into v_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'dispatch_guides'
    and column_name in ('order_number', 'supplier_id');

  select string_agg(
    format('%I.%I(%s)', namespace.nspname, procedure.proname,
      pg_get_function_identity_arguments(procedure.oid)),
    ', ' order by namespace.nspname, procedure.proname, procedure.oid
  )
  into v_routines
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('public', 'app_private')
    and procedure.prokind in ('f', 'p')
    and (
      lower(pg_get_functiondef(procedure.oid)) ~
        '(batch_guides|guide_invoices|reconciliation_orders|reconciliation_order_invoices|reconciliation_order_lines)'
      or lower(pg_get_functiondef(procedure.oid)) ~
        '(dispatch_guides|guide|dg)[[:space:]]*\.[[:space:]]*(order_number|supplier_id)'
    );

  if v_relations is not null or v_columns is not null
     or v_routines is not null then
    raise exception
      'PHASE3_LEGACY_CLEANUP_INCOMPLETE relations=[%] columns=[%] routines=[%]',
      coalesce(v_relations, ''), coalesce(v_columns, ''),
      coalesce(v_routines, '');
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * Guide-level batch/invoice/order architecture no longer exists;
--   * dispatch_guides no longer duplicates order_number or supplier_id;
--   * Fase 2 can still add/edit/delete Guides while Dispatch is IN_EXECUTION;
--   * all Phase 3 consumers use Dispatch as their aggregate root.
