begin;

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
  v_next_status public.dispatch_reconciliation_status;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_dispatch from public.dispatches where id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_dispatch.project_id, 'invoice.match') then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.status <> 'COMPLETED' then raise exception 'DISPATCH_NOT_COMPLETED_FOR_RECONCILIATION'; end if;
  if not exists (
    select 1 from public.batch_dispatches relation
    join public.batches batch on batch.id = relation.batch_id
    where relation.dispatch_id = v_dispatch.id and relation.removed_at is null and batch.status = 'OPEN'
  ) then raise exception 'DISPATCH_ACTIVE_BATCH_REQUIRED'; end if;

  select * into v_reconciliation
  from public.dispatch_reconciliations where dispatch_id = v_dispatch.id for update;
  if not found or v_reconciliation.current_product_invoice_id is null then
    raise exception 'PRODUCT_INVOICE_REQUIRED';
  end if;
  select * into v_invoice from public.invoices where id = v_reconciliation.current_product_invoice_id;
  select extraction.* into v_extraction
  from public.invoice_extractions extraction
  where extraction.invoice_id = v_invoice.id
  order by extraction.created_at desc limit 1;
  if not found then raise exception 'PRODUCT_INVOICE_EXTRACTION_REQUIRED'; end if;

  v_payload := coalesce(v_extraction.corrected_payload, v_extraction.normalized_payload);
  v_invoice_quantity := (v_payload ->> 'invoiced_quantity')::numeric;
  v_invoice_unit := upper(v_payload ->> 'normalized_unit');
  v_difference := v_invoice_quantity - v_dispatch.real_volume;
  v_validations := coalesce(v_payload -> 'validations', '{}'::jsonb) || jsonb_build_object(
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
  from public.dispatch_reconciliation_attempts where reconciliation_id = v_reconciliation.id;
  insert into public.dispatch_reconciliation_attempts(
    project_id, reconciliation_id, dispatch_id, product_invoice_id,
    extraction_id, attempt_number, expected_order_number,
    detected_order_number, expected_supplier_id, detected_supplier_name,
    detected_supplier_tax_id, expected_billing_legal_name,
    detected_billing_legal_name, expected_billing_tax_id,
    detected_billing_tax_id, expected_project_address,
    detected_shipping_address, project_match_method,
    expected_real_volume, expected_unit_code, invoiced_quantity,
    invoice_unit_code, difference, validations, result, executed_by
  )
  select v_dispatch.project_id, v_reconciliation.id, v_dispatch.id,
    v_invoice.id, v_extraction.id, v_attempt, v_dispatch.order_number,
    v_payload ->> 'detected_order_number', v_dispatch.supplier_id,
    v_payload ->> 'supplier_legal_name', v_payload ->> 'supplier_tax_id',
    project.billing_legal_name, v_payload ->> 'billing_legal_name',
    project.billing_tax_id, v_payload ->> 'billing_tax_id', project.address,
    v_payload ->> 'shipping_address', v_payload ->> 'project_match_method',
    v_dispatch.real_volume, v_dispatch.real_unit_code, v_invoice_quantity,
    v_invoice_unit, v_difference, v_validations,
    (case when v_match then 'MATCHED' else 'WITH_DIFFERENCES' end)::public.dispatch_reconciliation_result,
    v_actor
  from public.projects project where project.id = v_dispatch.project_id;

  v_next_status := case
    when v_match then 'RECONCILED'
    else 'PENDING_REINVOICING'
  end;
  update public.dispatch_reconciliations
  set status = v_next_status,
      version = version + 1,
      updated_at = now()
  where id = v_reconciliation.id;
  return v_next_status;
end;
$$;

comment on function public.reconcile_dispatch(uuid) is
  'Reconciles the current Product invoice; any difference automatically requires reinvoicing.';

alter function public.reconcile_dispatch(uuid) owner to postgres;
revoke all on function public.reconcile_dispatch(uuid) from public, anon;
grant execute on function public.reconcile_dispatch(uuid) to authenticated, service_role;

drop function if exists public.request_dispatch_reinvoicing(uuid, text);

update public.dispatch_reconciliations
set status = 'PENDING_REINVOICING',
    version = version + 1,
    updated_at = now()
where status = 'WITH_DIFFERENCES';

do $$
begin
  if exists (
    select 1
    from public.dispatch_reconciliations
    where status = 'WITH_DIFFERENCES'
  ) then
    raise exception 'AUTOMATIC_REINVOICING_BACKFILL_INCOMPLETE';
  end if;
end;
$$;

commit;
