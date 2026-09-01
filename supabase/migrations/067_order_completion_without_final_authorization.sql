-- 067_order_completion_without_final_authorization.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Makes PRODUCT reconciliation the direct Order completion authority.
-- SERVICE invoices remain private Order documents and are excluded from
-- quantity reconciliation. Weekly rollover keeps MATCHED Orders in their
-- original Batch and carries every pending Order to the following week.

begin;

-- ============================================================
-- 1. PRECONDITIONS / DRIFT GUARDS
-- ============================================================

do $$
begin
  if to_regclass('public.reconciliation_orders') is null
     or to_regclass('public.reconciliation_order_invoices') is null
     or to_regclass('public.mixto_listo_invoice_intakes') is null
     or to_regprocedure(
       'app_private.recalculate_reconciliation_order(uuid)'
     ) is null
     or to_regprocedure(
       'app_private.ensure_reconciliation_orders_for_batch(uuid)'
     ) is null
     or to_regprocedure(
       'app_private.prepare_document_upload_version(uuid,uuid,uuid,text,text,bigint)'
     ) is null
     or to_regprocedure('public.finalize_document_upload(uuid,uuid)') is null
     or to_regprocedure('public.preview_weekly_batch_rollover(uuid)') is null
     or to_regprocedure('public.rollover_weekly_batch(uuid)') is null then
    raise exception 'ORDER_COMPLETION_REQUIRED_CONTRACT_MISSING';
  end if;

  if to_regprocedure(
       'app_private.reconciliation_order_lifecycle(uuid)'
     ) is not null
     or to_regprocedure(
       'public.start_reconciliation_order_validation(uuid)'
     ) is not null
     or to_regprocedure(
       'public.prepare_order_service_invoice_upload(uuid,text,date,text,numeric,numeric,text,bigint,uuid)'
     ) is not null
     or to_regprocedure(
       'public.finalize_order_service_invoice_upload(uuid,uuid,uuid)'
     ) is not null
     or to_regprocedure(
       'public.request_order_product_reinvoicing(uuid,uuid)'
     ) is not null then
    raise exception 'ORDER_COMPLETION_CONTRACT_ALREADY_EXISTS';
  end if;
end;
$$;

-- ============================================================
-- 2. PRODUCT-ONLY RECONCILIATION
-- ============================================================

-- Migration 063 already owns the canonical comparison by code + unit_code.
-- Patch only its current-Invoice scopes so SERVICE never contributes lines,
-- document verification, supplier review or the PRODUCT invoice count.
do $$
declare
  v_signature regprocedure :=
    'app_private.recalculate_reconciliation_order(uuid)'::regprocedure;
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(v_signature) into v_definition;

  if position('and i.invoice_type = ''PRODUCT''' in v_definition) > 0 then
    raise exception 'ORDER_PRODUCT_ONLY_RECONCILIATION_ALREADY_APPLIED';
  end if;

  v_patched := regexp_replace(
    v_definition,
    'where roi\.reconciliation_order_id = v_order\.id([[:space:]]|\n)+and i\.status not in',
    'where roi.reconciliation_order_id = v_order.id
      and i.invoice_type = ''PRODUCT''
      and i.status not in',
    'g'
  );

  if v_patched = v_definition
     or position('and i.invoice_type = ''PRODUCT''' in v_patched) = 0 then
    raise exception 'ORDER_RECONCILIATION_DEFINITION_DRIFT';
  end if;

  execute v_patched;
end;
$$;

alter function app_private.recalculate_reconciliation_order(uuid)
owner to postgres;
revoke all on function app_private.recalculate_reconciliation_order(uuid)
from public, anon, authenticated;

-- ============================================================
-- 3. DERIVED ORDER LIFECYCLE + COMPLETION AUDIT
-- ============================================================

create function app_private.reconciliation_order_lifecycle(
  p_reconciliation_order_id uuid
)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select case
    when ro.reconciliation_status = 'MATCHED' then 'COMPLETED'
    when ro.reconciliation_status in (
      'PARTIAL', 'WITH_DIFFERENCES', 'REQUIRES_REVIEW'
    ) and product_state.has_current then 'REINVOICING'
    when ro.document_status = 'DOCUMENTS_LOADING' then 'VALIDATING'
    when guide_state.guide_count > 0 then 'READY_FOR_VALIDATION'
    else 'OPEN'
  end
  from public.reconciliation_orders ro
  cross join lateral (
    select count(*)::integer as guide_count
    from public.batch_guides bg
    join public.dispatch_guides dg
      on dg.id = bg.guide_id and dg.project_id = bg.project_id
    where bg.batch_id = ro.batch_id
      and bg.project_id = ro.project_id
      and bg.removed_at is null
      and app_private.normalize_reconciliation_order_number(dg.order_number)
          = ro.normalized_order_number
  ) guide_state
  cross join lateral (
    select exists (
      select 1
      from public.reconciliation_order_invoices roi
      join public.invoices i on i.id = roi.invoice_id
      where roi.reconciliation_order_id = ro.id
        and i.invoice_type = 'PRODUCT'
        and i.status not in ('SUPERSEDED', 'CANCELLED')
        and not exists (
          select 1 from public.invoices replacement
          where replacement.replaces_invoice_id = i.id
            and replacement.status not in ('SUPERSEDED', 'CANCELLED')
        )
    ) as has_current
  ) product_state
  where ro.id = p_reconciliation_order_id;
$$;

alter function app_private.reconciliation_order_lifecycle(uuid)
owner to postgres;
revoke all on function app_private.reconciliation_order_lifecycle(uuid)
from public, anon, authenticated;
grant execute on function app_private.reconciliation_order_lifecycle(uuid)
to service_role;

create function app_private.audit_reconciliation_order_completion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_company_id uuid;
begin
  if new.reconciliation_status = 'MATCHED'
     and old.reconciliation_status is distinct from new.reconciliation_status then
    select p.company_id into v_company_id
    from public.projects p where p.id = new.project_id;

    insert into public.audit_events(
      actor_user_id, company_id, project_id, entity_type,
      entity_id, action, old_values, new_values
    ) values
    (
      auth.uid(), v_company_id, new.project_id,
      'reconciliation_order', new.id, 'RECONCILIATION_MATCHED',
      jsonb_build_object(
        'reconciliation_status', old.reconciliation_status
      ),
      jsonb_build_object(
        'reconciliation_status', new.reconciliation_status,
        'effective_status', 'COMPLETED'
      )
    ),
    (
      auth.uid(), v_company_id, new.project_id,
      'reconciliation_order', new.id, 'ORDER_COMPLETED',
      null,
      jsonb_build_object(
        'batch_id', new.batch_id,
        'normalized_order_number', new.normalized_order_number,
        'completion_source', 'PRODUCT_RECONCILIATION'
      )
    );
  end if;
  return null;
end;
$$;

alter function app_private.audit_reconciliation_order_completion()
owner to postgres;
revoke all on function app_private.audit_reconciliation_order_completion()
from public, anon, authenticated, service_role;

create trigger reconciliation_order_completion_audit
after update of reconciliation_status
on public.reconciliation_orders
for each row
execute function app_private.audit_reconciliation_order_completion();

create function public.start_reconciliation_order_validation(
  p_reconciliation_order_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.reconciliation_orders%rowtype;
  v_company_id uuid;
  v_lifecycle text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select ro.* into v_order
  from public.reconciliation_orders ro
  where ro.id = p_reconciliation_order_id
  for update;
  if not found then raise exception 'RECONCILIATION_ORDER_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_order.project_id, 'invoice.match') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if not exists (
    select 1
    from public.batch_guides bg
    join public.dispatch_guides dg
      on dg.id = bg.guide_id and dg.project_id = bg.project_id
    where bg.batch_id = v_order.batch_id
      and bg.project_id = v_order.project_id
      and bg.removed_at is null
      and app_private.normalize_reconciliation_order_number(dg.order_number)
          = v_order.normalized_order_number
  ) then
    raise exception 'ORDER_GUIDES_REQUIRED';
  end if;

  v_lifecycle := app_private.reconciliation_order_lifecycle(v_order.id);
  if v_lifecycle = 'COMPLETED' then
    raise exception 'RECONCILIATION_ORDER_ALREADY_COMPLETED';
  end if;

  select p.company_id into v_company_id
  from public.projects p where p.id = v_order.project_id;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_order.project_id,
    'reconciliation_order', v_order.id, 'VALIDATION_STARTED',
    jsonb_build_object(
      'batch_id', v_order.batch_id,
      'normalized_order_number', v_order.normalized_order_number,
      'effective_status', v_lifecycle
    )
  );

  return 'VALIDATING';
end;
$$;

alter function public.start_reconciliation_order_validation(uuid)
owner to postgres;
revoke all on function public.start_reconciliation_order_validation(uuid)
from public, anon;
grant execute on function public.start_reconciliation_order_validation(uuid)
to authenticated, service_role;

-- ============================================================
-- 4. SERVICE: PRIVATE DOCUMENT, NO EXTRACTION, NO QUANTITY MATCH
-- ============================================================

create function public.prepare_order_service_invoice_upload(
  p_reconciliation_order_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_currency text,
  p_subtotal numeric,
  p_total numeric,
  p_file_name text,
  p_file_size bigint,
  p_replaces_invoice_id uuid default null
)
returns table(
  invoice_id uuid, document_id uuid, version_id uuid,
  version_number integer, storage_bucket text, storage_path text,
  file_name text, mime_type text, file_size bigint,
  upload_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.reconciliation_orders%rowtype;
  v_batch public.batches%rowtype;
  v_company_id uuid;
  v_supplier_id uuid;
  v_guide_count integer;
  v_invoice_id uuid := gen_random_uuid();
  v_document_id uuid := gen_random_uuid();
  v_prepared record;
  v_number text := nullif(btrim(p_invoice_number), '');
  v_currency text := upper(nullif(btrim(p_currency), ''));
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select ro.* into v_order
  from public.reconciliation_orders ro
  where ro.id = p_reconciliation_order_id
  for update;
  if not found then raise exception 'RECONCILIATION_ORDER_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_order.project_id, 'invoice.create') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if app_private.reconciliation_order_lifecycle(v_order.id) = 'COMPLETED' then
    raise exception 'RECONCILIATION_ORDER_ALREADY_COMPLETED';
  end if;

  select b.* into v_batch
  from public.batches b
  where b.id = v_order.batch_id and b.project_id = v_order.project_id;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.status not in (
    'DRAFT', 'ASSEMBLING', 'READY_FOR_REVIEW',
    'UNDER_REVIEW', 'NEEDS_CORRECTION', 'VALIDATED'
  ) then
    raise exception 'BATCH_INVOICE_NOT_EDITABLE';
  end if;

  if v_number is null or char_length(v_number) > 120 then
    raise exception 'INVOICE_NUMBER_INVALID';
  end if;
  if p_invoice_date is null
     or date_trunc('month', p_invoice_date)::date <> v_batch.accounting_period then
    raise exception 'INVOICE_ACCOUNTING_PERIOD_MISMATCH';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'INVOICE_CURRENCY_INVALID';
  end if;
  if p_subtotal is null or p_subtotal < 0
     or p_total is null or p_total <= 0 or p_subtotal > p_total then
    raise exception 'INVOICE_TOTALS_INVALID';
  end if;
  if lower(coalesce(p_file_name, '')) !~ '\.pdf$'
     or p_file_size is null or p_file_size <= 0 then
    raise exception 'INVOICE_DOCUMENT_PDF_REQUIRED';
  end if;

  select count(*)::integer,
         case when count(distinct dg.supplier_id) = 1
           then min(dg.supplier_id::text)::uuid end
  into v_guide_count, v_supplier_id
  from public.batch_guides bg
  join public.dispatch_guides dg
    on dg.id = bg.guide_id and dg.project_id = bg.project_id
  where bg.batch_id = v_order.batch_id
    and bg.project_id = v_order.project_id
    and bg.removed_at is null
    and app_private.normalize_reconciliation_order_number(dg.order_number)
        = v_order.normalized_order_number;
  if v_guide_count = 0 then raise exception 'ORDER_GUIDES_REQUIRED'; end if;
  if v_supplier_id is null then raise exception 'ORDER_SUPPLIER_REQUIRES_REVIEW'; end if;

  if p_replaces_invoice_id is not null and not exists (
    select 1
    from public.reconciliation_order_invoices roi
    join public.invoices i on i.id = roi.invoice_id
    where roi.reconciliation_order_id = v_order.id
      and i.id = p_replaces_invoice_id
      and i.invoice_type = 'SERVICE'
      and i.supplier_id = v_supplier_id
      and i.status not in ('SUPERSEDED', 'CANCELLED')
  ) then
    raise exception 'REPLACED_INVOICE_CONTEXT_INVALID';
  end if;

  select p.company_id into v_company_id
  from public.projects p
  where p.id = v_order.project_id and p.status = 'ACTIVE';
  if not found then raise exception 'BATCH_PROJECT_INACTIVE'; end if;

  insert into public.invoices(
    id, project_id, supplier_id, invoice_type, invoice_number,
    invoice_date, subtotal, total, currency, status,
    replaces_invoice_id, order_number, created_by
  ) values (
    v_invoice_id, v_order.project_id, v_supplier_id, 'SERVICE', v_number,
    p_invoice_date, p_subtotal, p_total, v_currency, 'REGISTERED',
    p_replaces_invoice_id, v_order.normalized_order_number, v_actor
  );

  insert into public.reconciliation_order_invoices(
    project_id, reconciliation_order_id, invoice_id,
    assigned_by, assignment_source
  ) values (
    v_order.project_id, v_order.id, v_invoice_id, v_actor, 'USER'
  );

  insert into public.guide_invoices(
    project_id, supplier_id, guide_id, invoice_id, linked_by
  )
  select v_order.project_id, v_supplier_id, dg.id, v_invoice_id, v_actor
  from public.batch_guides bg
  join public.dispatch_guides dg
    on dg.id = bg.guide_id and dg.project_id = bg.project_id
  where bg.batch_id = v_order.batch_id
    and bg.project_id = v_order.project_id
    and bg.removed_at is null
    and app_private.normalize_reconciliation_order_number(dg.order_number)
        = v_order.normalized_order_number;

  insert into public.documents(id, project_id, category, created_by)
  values (v_document_id, v_order.project_id, 'INVOICE', v_actor);
  insert into public.invoice_documents(
    project_id, invoice_id, document_id, purpose
  ) values (
    v_order.project_id, v_invoice_id, v_document_id, 'INVOICE'
  );

  select prepared.* into v_prepared
  from app_private.prepare_document_upload_version(
    v_document_id, v_order.project_id, v_actor,
    p_file_name, 'application/pdf', p_file_size
  ) prepared;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_order.project_id,
    'invoice', v_invoice_id, 'SERVICE_INVOICE_UPLOAD_PREPARED',
    jsonb_build_object(
      'reconciliation_order_id', v_order.id,
      'normalized_order_number', v_order.normalized_order_number,
      'guide_count', v_guide_count,
      'document_id', v_document_id,
      'version_id', v_prepared.version_id,
      'replaces_invoice_id', p_replaces_invoice_id
    )
  );

  return query select
    v_invoice_id, v_prepared.document_id, v_prepared.version_id,
    v_prepared.version_number, v_prepared.storage_bucket,
    v_prepared.storage_path, v_prepared.file_name,
    v_prepared.mime_type, v_prepared.file_size,
    v_prepared.upload_expires_at;
end;
$$;

alter function public.prepare_order_service_invoice_upload(
  uuid,text,date,text,numeric,numeric,text,bigint,uuid
) owner to postgres;
revoke all on function public.prepare_order_service_invoice_upload(
  uuid,text,date,text,numeric,numeric,text,bigint,uuid
) from public, anon;
grant execute on function public.prepare_order_service_invoice_upload(
  uuid,text,date,text,numeric,numeric,text,bigint,uuid
) to authenticated, service_role;

create function public.finalize_order_service_invoice_upload(
  p_invoice_id uuid,
  p_document_id uuid,
  p_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice public.invoices%rowtype;
  v_order_id uuid;
  v_company_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select i.*
  into v_invoice
  from public.invoices i
  join public.reconciliation_order_invoices roi on roi.invoice_id = i.id
  join public.invoice_documents idoc on idoc.invoice_id = i.id
  where i.id = p_invoice_id
    and i.invoice_type = 'SERVICE'
    and idoc.document_id = p_document_id
  for update of i;
  if not found then raise exception 'SERVICE_INVOICE_CONTEXT_INVALID'; end if;

  select roi.reconciliation_order_id into v_order_id
  from public.reconciliation_order_invoices roi
  where roi.invoice_id = v_invoice.id;

  if not app_private.has_project_permission(v_invoice.project_id, 'invoice.create') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_invoice.status <> 'REGISTERED' then
    raise exception 'SERVICE_INVOICE_UPLOAD_NOT_PENDING';
  end if;

  perform public.finalize_document_upload(p_document_id, p_version_id);

  update public.invoices
  set status = 'MATCHED', updated_at = now()
  where id = v_invoice.id;

  if v_invoice.replaces_invoice_id is not null then
    update public.invoices
    set status = 'SUPERSEDED', updated_at = now()
    where id = v_invoice.replaces_invoice_id
      and status not in ('SUPERSEDED', 'CANCELLED');
  end if;

  select p.company_id into v_company_id
  from public.projects p where p.id = v_invoice.project_id;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_invoice.project_id,
    'invoice', v_invoice.id, 'SERVICE_INVOICE_CONFIRMED',
    jsonb_build_object(
      'reconciliation_order_id', v_order_id,
      'document_id', p_document_id,
      'version_id', p_version_id,
      'replaces_invoice_id', v_invoice.replaces_invoice_id,
      'quantity_reconciliation', false
    )
  );

  perform app_private.recalculate_reconciliation_order(v_order_id);
  return v_invoice.id;
end;
$$;

alter function public.finalize_order_service_invoice_upload(uuid,uuid,uuid)
owner to postgres;
revoke all on function public.finalize_order_service_invoice_upload(uuid,uuid,uuid)
from public, anon;
grant execute on function public.finalize_order_service_invoice_upload(uuid,uuid,uuid)
to authenticated, service_role;

-- ============================================================
-- 5. EXPLICIT PRODUCT REINVOICING REQUEST
-- ============================================================

create function public.request_order_product_reinvoicing(
  p_reconciliation_order_id uuid,
  p_invoice_id uuid
)
returns public.invoice_status
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.reconciliation_orders%rowtype;
  v_invoice public.invoices%rowtype;
  v_company_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select ro.* into v_order
  from public.reconciliation_orders ro
  where ro.id = p_reconciliation_order_id
  for update;
  if not found then raise exception 'RECONCILIATION_ORDER_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_order.project_id, 'invoice.match') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_order.reconciliation_status = 'MATCHED' then
    raise exception 'RECONCILIATION_ORDER_ALREADY_COMPLETED';
  end if;

  select i.* into v_invoice
  from public.reconciliation_order_invoices roi
  join public.invoices i on i.id = roi.invoice_id
  where roi.reconciliation_order_id = v_order.id
    and i.id = p_invoice_id
    and i.invoice_type = 'PRODUCT'
    and i.status not in ('SUPERSEDED', 'CANCELLED')
  for update of i;
  if not found then raise exception 'PRODUCT_INVOICE_CONTEXT_INVALID'; end if;

  update public.invoices
  set status = 'REINVOICING', updated_at = now()
  where id = v_invoice.id;

  select p.company_id into v_company_id
  from public.projects p where p.id = v_order.project_id;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values
  ) values (
    v_actor, v_company_id, v_order.project_id,
    'invoice', v_invoice.id, 'REINVOICING_REQUESTED',
    jsonb_build_object('status', v_invoice.status),
    jsonb_build_object(
      'status', 'REINVOICING',
      'reconciliation_order_id', v_order.id,
      'normalized_order_number', v_order.normalized_order_number
    )
  );

  perform app_private.recalculate_reconciliation_order(v_order.id);
  return 'REINVOICING'::public.invoice_status;
end;
$$;

alter function public.request_order_product_reinvoicing(uuid,uuid)
owner to postgres;
revoke all on function public.request_order_product_reinvoicing(uuid,uuid)
from public, anon;
grant execute on function public.request_order_product_reinvoicing(uuid,uuid)
to authenticated, service_role;

-- ============================================================
-- 6. ORDER-AWARE WEEKLY ROLLOVER
-- ============================================================

create or replace function app_private.guide_ready_for_batch(
  p_guide_id uuid,
  p_batch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select coalesce((
    select ro.reconciliation_status = 'MATCHED'
    from public.batch_guides bg
    join public.dispatch_guides dg
      on dg.id = bg.guide_id and dg.project_id = bg.project_id
    join public.reconciliation_orders ro
      on ro.batch_id = bg.batch_id
     and ro.project_id = bg.project_id
     and ro.normalized_order_number =
       app_private.normalize_reconciliation_order_number(dg.order_number)
    where bg.batch_id = p_batch_id
      and bg.guide_id = p_guide_id
      and bg.removed_at is null
  ), false);
$$;

alter function app_private.guide_ready_for_batch(uuid,uuid)
owner to postgres;
revoke all on function app_private.guide_ready_for_batch(uuid,uuid)
from public, anon, authenticated;
grant execute on function app_private.guide_ready_for_batch(uuid,uuid)
to service_role;

create or replace function public.preview_weekly_batch_rollover(
  p_batch_id uuid
)
returns table (
  batch_guide_id uuid,
  guide_id uuid,
  dispatch_id uuid,
  ready_for_review boolean,
  rollover_action text,
  rollover_reason text,
  removal_source text,
  destination_batch_id uuid,
  destination_period_start date,
  destination_period_end date,
  destination_accounting_period date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.batches%rowtype;
  v_next_period record;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select b.* into v_batch
  from public.batches b where b.id = p_batch_id;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_batch.project_id, 'batch.view') then
    raise exception 'PERMISSION_DENIED';
  end if;

  select resolved.* into v_next_period
  from app_private.resolve_weekly_batch_period(
    v_batch.project_id, v_batch.period_end + 1
  ) resolved;

  return query
  select
    bg.id,
    bg.guide_id,
    dg.dispatch_id,
    readiness.is_completed,
    case when readiness.is_completed then 'STAY' else 'MOVE' end,
    case when readiness.is_completed
      then 'ORDER_COMPLETED'
      else 'ORDER_PENDING_WEEKLY_CONTINUATION'
    end,
    case when readiness.is_completed then null::text else 'SYSTEM' end,
    next_batch.id,
    v_next_period.period_start,
    v_next_period.period_end,
    v_next_period.accounting_period
  from public.batch_guides bg
  join public.dispatch_guides dg
    on dg.id = bg.guide_id and dg.project_id = bg.project_id
  cross join lateral (
    select app_private.guide_ready_for_batch(
      bg.guide_id, v_batch.id
    ) as is_completed
  ) readiness
  left join public.batches next_batch
    on next_batch.project_id = v_batch.project_id
   and next_batch.period_start = v_next_period.period_start
  where bg.batch_id = v_batch.id
    and bg.removed_at is null
  order by dg.guide_date, bg.guide_id;
end;
$$;

alter function public.preview_weekly_batch_rollover(uuid)
owner to postgres;
revoke all on function public.preview_weekly_batch_rollover(uuid)
from public, anon;
grant execute on function public.preview_weekly_batch_rollover(uuid)
to authenticated, service_role;

-- The existing protected rollover continues moving Guide relations. This
-- trigger carries the pending Order aggregate, all Invoice history and any
-- staging intake to the automatically-created Order in the destination Batch.
create or replace function app_private.guard_mixto_listo_order_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;

  if exists (
    select 1
    from public.mixto_listo_invoice_intakes intake
    where intake.confirmed_invoice_id = new.invoice_id
      and intake.reconciliation_order_id <> new.reconciliation_order_id
  ) then
    raise exception 'MIXTO_LISTO_MANUAL_ORDER_REASSIGNMENT_FORBIDDEN';
  end if;
  return new;
end;
$$;

alter function app_private.guard_mixto_listo_order_assignment()
owner to postgres;
revoke all on function app_private.guard_mixto_listo_order_assignment()
from public, anon, authenticated, service_role;

create function app_private.transfer_reconciliation_order_on_rollover()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_source_batch_id uuid;
  v_order_number text;
  v_source_order_id uuid;
  v_target_order_id uuid;
begin
  if new.assignment_source <> 'SYSTEM' then return null; end if;
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  select source_bg.batch_id into v_source_batch_id
  from public.batch_guides source_bg
  where source_bg.guide_id = new.guide_id
    and source_bg.project_id = new.project_id
    and source_bg.rolled_to_batch_id = new.batch_id
    and source_bg.removed_at is not null
  order by source_bg.removed_at desc
  limit 1;
  if not found then return null; end if;

  select app_private.normalize_reconciliation_order_number(dg.order_number)
  into v_order_number
  from public.dispatch_guides dg
  where dg.id = new.guide_id and dg.project_id = new.project_id;
  if v_order_number is null then return null; end if;

  perform app_private.ensure_reconciliation_orders_for_batch(new.batch_id);

  select ro.id into v_source_order_id
  from public.reconciliation_orders ro
  where ro.batch_id = v_source_batch_id
    and ro.project_id = new.project_id
    and ro.normalized_order_number = v_order_number;

  select ro.id into v_target_order_id
  from public.reconciliation_orders ro
  where ro.batch_id = new.batch_id
    and ro.project_id = new.project_id
    and ro.normalized_order_number = v_order_number;

  if v_source_order_id is null or v_target_order_id is null
     or v_source_order_id = v_target_order_id then
    return null;
  end if;

  update public.reconciliation_order_invoices
  set reconciliation_order_id = v_target_order_id
  where reconciliation_order_id = v_source_order_id;

  update public.mixto_listo_invoice_intakes
  set reconciliation_order_id = v_target_order_id,
      updated_at = now()
  where reconciliation_order_id = v_source_order_id;

  perform app_private.recalculate_reconciliation_order(v_source_order_id);
  perform app_private.recalculate_reconciliation_order(v_target_order_id);
  return null;
end;
$$;

alter function app_private.transfer_reconciliation_order_on_rollover()
owner to postgres;
revoke all on function app_private.transfer_reconciliation_order_on_rollover()
from public, anon, authenticated, service_role;

create trigger reconciliation_order_rollover_transfer
after insert on public.batch_guides
for each row
execute function app_private.transfer_reconciliation_order_on_rollover();

-- ============================================================
-- 7. ALIGN EXISTING ORDERS WITH PRODUCT-ONLY AUTHORITY
-- ============================================================

do $$
declare
  v_order record;
begin
  for v_order in
    select ro.id
    from public.reconciliation_orders ro
    order by ro.created_at, ro.id
  loop
    perform app_private.recalculate_reconciliation_order(v_order.id);
  end loop;
end;
$$;

-- ============================================================
-- 8. FINAL ASSERTIONS
-- ============================================================

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'app_private.recalculate_reconciliation_order(uuid)'::regprocedure
  ) into v_definition;
  if position('and i.invoice_type = ''PRODUCT''' in v_definition) = 0 then
    raise exception 'ORDER_PRODUCT_ONLY_RECONCILIATION_NOT_APPLIED';
  end if;

  if app_private.reconciliation_order_lifecycle(
       '00000000-0000-0000-0000-000000000000'::uuid
     ) is not null then
    raise exception 'ORDER_LIFECYCLE_UNKNOWN_ORDER_INVALID';
  end if;

  if has_function_privilege(
       'anon', 'public.start_reconciliation_order_validation(uuid)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.prepare_order_service_invoice_upload(uuid,text,date,text,numeric,numeric,text,bigint,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.request_order_product_reinvoicing(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'ORDER_COMPLETION_SECURITY_NOT_ALIGNED';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'batch_guides'
      and t.tgname = 'reconciliation_order_rollover_transfer'
      and t.tgenabled <> 'D'
      and not t.tgisinternal
  ) then
    raise exception 'ORDER_ROLLOVER_TRANSFER_TRIGGER_MISSING';
  end if;

  if exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'order_reconciliation_status'
      and e.enumlabel in ('COMPLETED', 'REINVOICING')
  ) then
    raise exception 'ORDER_LIFECYCLE_MUST_REMAIN_DERIVED';
  end if;
end;
$$;

-- Live QA after manual execution:
--   * SERVICE PDF persists without OCR extraction or reconciliation lines;
--   * SERVICE alone never produces MATCHED/COMPLETED;
--   * PRODUCT compares all active Guide lines by code + unit_code;
--   * exact current PRODUCT yields MATCHED and effective COMPLETED;
--   * differences yield effective REINVOICING and retain affected lines;
--   * explicit reinvoicing request preserves the original Invoice/PDF;
--   * replacement supersedes history and exact replacement completes Order;
--   * completed Order Guides stay in the original weekly Batch;
--   * pending/reinvoicing Order Guides and Invoice history move together;
--   * Batch chronological status remains compatible; final authorization is
--     not consulted for Order completion or rollover.

commit;
