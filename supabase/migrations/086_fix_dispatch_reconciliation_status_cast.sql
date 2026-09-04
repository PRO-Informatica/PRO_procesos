-- 086_fix_dispatch_reconciliation_status_cast.sql
-- APPLIED SUCCESSFULLY — EXECUTED ON 2026-09-04.
-- Fix the Phase 3 reconciliation status assignment: PostgreSQL CASE returns
-- text unless it is explicitly cast to the destination enum.

begin;

do $$
begin
  if to_regprocedure('public.reconcile_dispatch(uuid)') is null
     or to_regtype('public.dispatch_reconciliation_status') is null
     or to_regtype('public.dispatch_reconciliation_result') is null then
    raise exception 'PHASE3_RECONCILIATION_CONTRACT_MISSING';
  end if;
end;
$$;

create or replace function public.reconcile_dispatch(p_dispatch_id uuid)
returns public.dispatch_reconciliation_status
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_reconciliation public.dispatch_reconciliations%rowtype;
  v_invoice public.invoices%rowtype;
  v_extraction public.invoice_extractions%rowtype;
  v_payload jsonb;
  v_attempt integer;
  v_invoice_quantity numeric(14,3);
  v_invoice_unit text;
  v_difference numeric(14,3);
  v_validations jsonb;
  v_match boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_dispatch from public.dispatches
  where id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_dispatch.project_id, 'invoice.match')
  then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.status <> 'COMPLETED' then
    raise exception 'DISPATCH_NOT_COMPLETED_FOR_RECONCILIATION';
  end if;
  if not exists (
    select 1 from public.batch_dispatches relation
    join public.batches batch on batch.id = relation.batch_id
    where relation.dispatch_id = v_dispatch.id
      and relation.removed_at is null and batch.status = 'OPEN'
  ) then raise exception 'DISPATCH_ACTIVE_BATCH_REQUIRED'; end if;
  select * into v_reconciliation from public.dispatch_reconciliations
  where dispatch_id = v_dispatch.id for update;
  if not found or v_reconciliation.current_product_invoice_id is null
     or v_reconciliation.current_service_invoice_id is null then
    raise exception 'BOTH_DISPATCH_INVOICES_REQUIRED';
  end if;
  select * into v_invoice from public.invoices
  where id = v_reconciliation.current_product_invoice_id;
  select extraction.* into v_extraction
  from public.invoice_extractions extraction
  where extraction.invoice_id = v_invoice.id
  order by extraction.created_at desc limit 1;
  if not found then raise exception 'PRODUCT_INVOICE_EXTRACTION_REQUIRED'; end if;
  v_payload := coalesce(v_extraction.corrected_payload,
    v_extraction.normalized_payload);
  v_invoice_quantity := (v_payload ->> 'invoiced_quantity')::numeric;
  v_invoice_unit := upper(v_payload ->> 'normalized_unit');
  v_difference := v_invoice_quantity - v_dispatch.real_volume;
  v_validations := coalesce(v_payload -> 'validations', '{}'::jsonb)
    || jsonb_build_object(
      'period_valid', coalesce((v_payload -> 'validations' ->> 'period_valid')::boolean, false),
      'unit_valid', v_invoice_unit = upper(v_dispatch.real_unit_code),
      'quantity_valid', abs(v_difference) < 0.001
    );
  v_match := coalesce((v_validations ->> 'document_valid')::boolean, false)
    and coalesce((v_validations ->> 'type_valid')::boolean, false)
    and coalesce((v_validations ->> 'project_valid')::boolean, false)
    and coalesce((v_validations ->> 'supplier_valid')::boolean, false)
    and coalesce((v_validations ->> 'order_valid')::boolean, false)
    and coalesce((v_validations ->> 'period_valid')::boolean, false)
    and coalesce((v_validations ->> 'unit_valid')::boolean, false)
    and coalesce((v_validations ->> 'quantity_valid')::boolean, false);

  select coalesce(max(attempt_number), 0) + 1 into v_attempt
  from public.dispatch_reconciliation_attempts
  where reconciliation_id = v_reconciliation.id;
  insert into public.dispatch_reconciliation_attempts(
    project_id, reconciliation_id, dispatch_id, product_invoice_id,
    extraction_id, attempt_number, expected_order_number,
    detected_order_number, expected_supplier_id, detected_supplier_name,
    detected_supplier_tax_id, expected_billing_legal_name,
    detected_billing_legal_name, expected_billing_tax_id,
    detected_billing_tax_id, expected_real_volume, expected_unit_code,
    invoiced_quantity, invoice_unit_code, difference, validations,
    result, executed_by
  )
  select v_dispatch.project_id, v_reconciliation.id, v_dispatch.id,
    v_invoice.id, v_extraction.id, v_attempt, v_dispatch.order_number,
    v_payload ->> 'detected_order_number', v_dispatch.supplier_id,
    v_payload ->> 'supplier_legal_name', v_payload ->> 'supplier_tax_id',
    project.billing_legal_name, v_payload ->> 'billing_legal_name',
    project.billing_tax_id, v_payload ->> 'billing_tax_id',
    v_dispatch.real_volume, v_dispatch.real_unit_code,
    v_invoice_quantity, v_invoice_unit, v_difference, v_validations,
    case when v_match then 'MATCHED'
      else 'WITH_DIFFERENCES' end::public.dispatch_reconciliation_result,
    v_actor
  from public.projects project where project.id = v_dispatch.project_id;

  update public.dispatch_reconciliations
  set status = (case when v_match then 'RECONCILED'
      else 'WITH_DIFFERENCES' end)::public.dispatch_reconciliation_status,
      version = version + 1, updated_at = now()
  where id = v_reconciliation.id;
  return (case when v_match then 'RECONCILED'
    else 'WITH_DIFFERENCES' end)::public.dispatch_reconciliation_status;
end;
$$;

alter function public.reconcile_dispatch(uuid) owner to postgres;
revoke all on function public.reconcile_dispatch(uuid) from public, anon;
grant execute on function public.reconcile_dispatch(uuid)
to authenticated, service_role;

commit;
