-- 099_not_dispatched_incident_programmed_quantity.sql
-- A completed NOT_DISPATCHED operation keeps real_volume = 0 for the physical
-- record. When it has an incident, Product reconciliation uses the confirmed
-- (or requested) programming quantity as its comparison basis.

begin;

do $$
begin
  if to_regprocedure('public.reconcile_dispatch(uuid)') is null
     or to_regclass('public.dispatch_incidents') is null
     or to_regclass('public.programming') is null
     or to_regclass('public.dispatch_reconciliation_attempts') is null then
    raise exception 'NOT_DISPATCHED_RECONCILIATION_REQUIRED_CONTRACT_MISSING';
  end if;
  -- There is no incident cancellation lifecycle in the installed model.
  -- Abort on drift instead of letting a newly introduced tombstone activate
  -- the programmed-quantity exception without an explicit policy.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dispatch_incidents'
      and column_name in ('status', 'active', 'deleted_at', 'removed_at', 'voided_at', 'cancelled_at')
  ) then
    raise exception 'DISPATCH_INCIDENT_LIFECYCLE_REQUIRES_REVIEW';
  end if;
end;
$$;

alter table public.dispatch_reconciliation_attempts
  add column comparison_quantity numeric(14,3),
  add column comparison_unit_code text,
  add column comparison_basis text;

-- Before 099 every attempt compared against the real dispatch volume. The
-- existing expected_unit_code is the historical unit snapshot; it is NOT a
-- new inferred unit. Nullable unit accommodates legacy rows without one.
update public.dispatch_reconciliation_attempts
set comparison_quantity = expected_real_volume,
    comparison_unit_code = nullif(btrim(expected_unit_code), ''),
    comparison_basis = 'REAL_VOLUME';

alter table public.dispatch_reconciliation_attempts
  alter column comparison_quantity set not null,
  alter column comparison_basis set not null,
  add constraint dispatch_reconciliation_attempts_comparison_basis_ck
    check (comparison_basis in ('REAL_VOLUME', 'PROGRAMMED_QUANTITY')),
  add constraint dispatch_reconciliation_attempts_comparison_quantity_ck
    check (comparison_quantity >= 0),
  add constraint dispatch_reconciliation_attempts_comparison_unit_ck
    check (comparison_unit_code is null or nullif(btrim(comparison_unit_code), '') is not null);

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
  v_exception_status public.invoice_recipient_exception_status;
  v_payload jsonb;
  v_attempt integer;
  v_invoice_quantity numeric(14,3);
  v_invoice_unit text;
  v_comparison_quantity numeric(14,3);
  v_comparison_unit_code text;
  v_use_programmed_quantity boolean;
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
  select status into v_exception_status
  from public.invoice_recipient_exceptions where invoice_id = v_invoice.id;

  if v_exception_status = 'PENDING' then
    update public.dispatch_reconciliations
    set status = 'PENDING_RECONCILIATION', version = version + 1, updated_at = now()
    where id = v_reconciliation.id;
    return 'PENDING_RECONCILIATION';
  elsif v_exception_status = 'REINVOICE_REQUESTED' then
    update public.dispatch_reconciliations
    set status = 'PENDING_REINVOICING', version = version + 1, updated_at = now()
    where id = v_reconciliation.id;
    return 'PENDING_REINVOICING';
  end if;

  select extraction.* into v_extraction
  from public.invoice_extractions extraction
  where extraction.invoice_id = v_invoice.id
  order by extraction.created_at desc limit 1;
  if not found then raise exception 'PRODUCT_INVOICE_EXTRACTION_REQUIRED'; end if;

  v_use_programmed_quantity :=
    v_dispatch.result = 'NOT_DISPATCHED'
    and exists (
      select 1
      from public.dispatch_incidents incident
      join public.incident_types incident_type on incident_type.id = incident.incident_type_id
      where incident.dispatch_id = v_dispatch.id
        and incident.project_id = v_dispatch.project_id
        and incident.incident_type_id is not null
        and incident.reported_by is not null
        and incident_type.company_id = (
          select project.company_id from public.projects project
          where project.id = v_dispatch.project_id
        )
    );

  if v_use_programmed_quantity then
    select case
             when programming.confirmed_quantity > 0 then programming.confirmed_quantity
             when programming.requested_quantity > 0 then programming.requested_quantity
           end,
           programming.unit_code
    into v_comparison_quantity, v_comparison_unit_code
    from public.programming programming
    where programming.id = v_dispatch.programming_id
      and programming.project_id = v_dispatch.project_id;

    if v_comparison_quantity is null
       or nullif(btrim(v_comparison_unit_code), '') is null then
      raise exception 'NOT_DISPATCHED_PROGRAMMED_QUANTITY_REQUIRED';
    end if;
  else
    v_comparison_quantity := v_dispatch.real_volume;
    v_comparison_unit_code := v_dispatch.real_unit_code;
    if v_comparison_quantity is null
       or nullif(btrim(v_comparison_unit_code), '') is null then
      raise exception 'DISPATCH_REAL_QUANTITY_REQUIRED';
    end if;
  end if;

  v_payload := coalesce(v_extraction.corrected_payload, v_extraction.normalized_payload);
  v_invoice_quantity := (v_payload ->> 'invoiced_quantity')::numeric;
  v_invoice_unit := upper(v_payload ->> 'normalized_unit');
  v_difference := v_invoice_quantity - v_comparison_quantity;
  v_validations := coalesce(v_payload -> 'validations', '{}'::jsonb) || jsonb_build_object(
    'period_valid', coalesce((v_payload -> 'validations' ->> 'period_valid')::boolean, false),
    'unit_valid', v_invoice_unit = upper(v_comparison_unit_code),
    'quantity_valid', abs(v_difference) < 0.001,
    'billing_society_allowed', v_exception_status is null or v_exception_status = 'APPROVED',
    'recipient_exception_approved', v_exception_status = 'APPROVED',
    'requires_reinvoicing', false
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
    expected_real_volume, expected_unit_code,
    comparison_quantity, comparison_unit_code, comparison_basis, invoiced_quantity,
    invoice_unit_code, difference, validations, result, executed_by
  )
  select v_dispatch.project_id, v_reconciliation.id, v_dispatch.id,
    v_invoice.id, v_extraction.id, v_attempt, v_dispatch.order_number,
    v_payload ->> 'detected_order_number', v_dispatch.supplier_id,
    v_payload ->> 'supplier_legal_name', v_payload ->> 'supplier_tax_id',
    project.billing_legal_name, v_payload ->> 'billing_legal_name',
    project.billing_tax_id, v_payload ->> 'billing_tax_id', project.address,
    v_payload ->> 'shipping_address', v_payload ->> 'project_match_method',
    v_dispatch.real_volume,
    coalesce(v_dispatch.real_unit_code, v_comparison_unit_code),
    v_comparison_quantity, v_comparison_unit_code,
    case when v_use_programmed_quantity then 'PROGRAMMED_QUANTITY' else 'REAL_VOLUME' end,
    v_invoice_quantity,
    v_invoice_unit, v_difference, v_validations,
    (case when v_match then 'MATCHED' else 'WITH_DIFFERENCES' end)::public.dispatch_reconciliation_result,
    v_actor
  from public.projects project where project.id = v_dispatch.project_id;

  v_next_status := case when v_match then 'RECONCILED' else 'WITH_DIFFERENCES' end;
  update public.dispatch_reconciliations
  set status = v_next_status, version = version + 1, updated_at = now()
  where id = v_reconciliation.id;
  return v_next_status;
end;
$$;

comment on function public.reconcile_dispatch(uuid) is
  'Reconciles Product against real volume, except NOT_DISPATCHED incidents use the programmed quantity.';

alter function public.reconcile_dispatch(uuid) owner to postgres;
revoke all on function public.reconcile_dispatch(uuid) from public, anon;
grant execute on function public.reconcile_dispatch(uuid) to authenticated, service_role;

commit;
