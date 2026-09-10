begin;

do $$
begin
  if to_regprocedure('public.prepare_dispatch_invoice_upload_v2(uuid,uuid,public.invoice_type,jsonb,text,bigint,uuid)') is null
     or to_regprocedure('public.complete_dispatch_invoice_processing(uuid,uuid,jsonb)') is null
     or to_regprocedure('app_private.refresh_dispatch_reconciliation(uuid)') is null then
    raise exception 'PRODUCT_REINVOICING_PREREQUISITES_MISSING';
  end if;

  if exists (
    select 1
    from public.dispatch_reconciliations reconciliation
    where reconciliation.status = 'PENDING_REINVOICING'
      and reconciliation.current_product_invoice_id is null
  ) then
    raise exception 'PENDING_REINVOICING_WITHOUT_CURRENT_PRODUCT';
  end if;
end;
$$;

-- Replacement is a Product-only operation and must point to the exact current
-- invoice of a dispatch that is explicitly waiting for reinvoicing.
create or replace function app_private.guard_product_invoice_replacement()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
declare
  v_reconciliation public.dispatch_reconciliations%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.replaces_invoice_id is not distinct from old.replaces_invoice_id
       and new.dispatch_id is not distinct from old.dispatch_id
       and new.project_id is not distinct from old.project_id
       and new.invoice_type is not distinct from old.invoice_type then
      return new;
    end if;
  end if;

  if new.replaces_invoice_id is null then
    return new;
  end if;

  if new.invoice_type <> 'PRODUCT' then
    raise exception 'ONLY_PRODUCT_INVOICE_CAN_BE_REPLACED';
  end if;

  select reconciliation.* into v_reconciliation
  from public.dispatch_reconciliations reconciliation
  where reconciliation.dispatch_id = new.dispatch_id
    and reconciliation.project_id = new.project_id
  for update;

  if not found
     or v_reconciliation.status <> 'PENDING_REINVOICING'
     or v_reconciliation.current_product_invoice_id is distinct from new.replaces_invoice_id then
    raise exception 'PRODUCT_REINVOICING_CONTEXT_INVALID';
  end if;

  return new;
end;
$$;

alter function app_private.guard_product_invoice_replacement() owner to postgres;
revoke all on function app_private.guard_product_invoice_replacement()
from public, anon, authenticated, service_role;

drop trigger if exists guard_product_invoice_replacement on public.invoices;
create trigger guard_product_invoice_replacement
before insert or update
on public.invoices
for each row execute function app_private.guard_product_invoice_replacement();

-- A technical difference remains WITH_DIFFERENCES. Purchasing must explicitly
-- request another Product invoice before a replacement becomes admissible.
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

  v_next_status := case when v_match then 'RECONCILED' else 'WITH_DIFFERENCES' end;
  update public.dispatch_reconciliations
  set status = v_next_status,
      version = version + 1,
      updated_at = now()
  where id = v_reconciliation.id;
  return v_next_status;
end;
$$;

comment on function public.reconcile_dispatch(uuid) is
  'Reconciles the current Product invoice; differences require an explicit reinvoicing request.';

alter function public.reconcile_dispatch(uuid) owner to postgres;
revoke all on function public.reconcile_dispatch(uuid) from public, anon;
grant execute on function public.reconcile_dispatch(uuid) to authenticated, service_role;

create or replace function public.request_dispatch_reinvoicing(p_dispatch_id uuid, p_reason text)
returns public.dispatch_reconciliation_status
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_reconciliation public.dispatch_reconciliations%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_reconciliation from public.dispatch_reconciliations
  where dispatch_id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_RECONCILIATION_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_reconciliation.project_id, 'invoice.review') then raise exception 'PERMISSION_DENIED'; end if;
  if v_reconciliation.status <> 'WITH_DIFFERENCES' then raise exception 'REINVOICING_NOT_AVAILABLE'; end if;
  if v_reason is null or char_length(v_reason) > 1000 then raise exception 'REINVOICING_REASON_INVALID'; end if;

  update public.dispatch_reconciliations
  set status = 'PENDING_REINVOICING', version = version + 1, updated_at = now()
  where id = v_reconciliation.id;
  insert into public.audit_events(actor_user_id, project_id, entity_type, entity_id, action, new_values)
  values (v_actor, v_reconciliation.project_id, 'dispatch_reconciliation', v_reconciliation.id,
    'DISPATCH_REINVOICING_REQUESTED', jsonb_build_object('dispatch_id', p_dispatch_id, 'reason', v_reason));
  return 'PENDING_REINVOICING';
end;
$$;

comment on function public.request_dispatch_reinvoicing(uuid,text) is
  'Moves WITH_DIFFERENCES to PENDING_REINVOICING after an explicit Purchasing review.';

alter function public.request_dispatch_reinvoicing(uuid,text) owner to postgres;
revoke all on function public.request_dispatch_reinvoicing(uuid,text) from public, anon;
grant execute on function public.request_dispatch_reinvoicing(uuid,text) to authenticated, service_role;

do $$
begin
  if to_regprocedure('public.request_dispatch_reinvoicing(uuid,text)') is null
     or not exists (
       select 1 from pg_catalog.pg_trigger trigger
       where trigger.tgrelid = 'public.invoices'::regclass
         and trigger.tgname = 'guard_product_invoice_replacement'
         and not trigger.tgisinternal
     ) then
    raise exception 'PRODUCT_REINVOICING_INSTALLATION_INCOMPLETE';
  end if;
end;
$$;

commit;
