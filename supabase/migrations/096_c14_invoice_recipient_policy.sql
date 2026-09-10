begin;

do $$
begin
  if to_regprocedure('app_private.refresh_dispatch_reconciliation(uuid)') is null
     or to_regprocedure('public.reconcile_dispatch(uuid)') is null
     or to_regprocedure('public.request_dispatch_reinvoicing(uuid,text)') is null then
    raise exception 'C14_INVOICE_POLICY_PREREQUISITES_MISSING';
  end if;

  if (select count(*) from public.companies where upper(btrim(code)) = 'PRO-CSAL') <> 1 then
    raise exception 'CSAL_CANONICAL_COMPANY_CODE_INVALID';
  end if;
end;
$$;

create or replace function app_private.normalize_invoice_business_identity(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when nullif(btrim(p_value), '') is null then null
    else replace(
      regexp_replace(
        translate(upper(p_value), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'),
        '[^A-Z0-9]',
        '',
        'g'
      ),
      'SOCIEDADANONIMA',
      'SA'
    )
  end
$$;

create or replace function app_private.is_c14_invoice_recipient(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, app_private
as $$
  select coalesce(
    app_private.normalize_invoice_business_identity(p_value) in (
      'C14',
      'CONSTRUCTORACATORCE',
      'CONSTRUCTORACATORCESA'
    ),
    false
  )
$$;

create or replace function app_private.project_allows_c14_invoice_recipient(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(bool_or(upper(btrim(company.code)) = 'PRO-CSAL'), false)
  from public.projects project
  join public.companies company on company.id = project.company_id
  where project.id = p_project_id
$$;

create or replace function app_private.invoice_payload_requires_c14_reinvoicing(
  p_project_id uuid,
  p_payload jsonb
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, app_private
as $$
  select app_private.is_c14_invoice_recipient(p_payload ->> 'billing_legal_name')
    and not app_private.project_allows_c14_invoice_recipient(p_project_id)
$$;

do $$
begin
  if exists (
    select 1
    from public.invoices invoice
    join public.invoice_extractions extraction on extraction.invoice_id = invoice.id
    where invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
      and app_private.invoice_payload_requires_c14_reinvoicing(
        invoice.project_id,
        coalesce(extraction.corrected_payload, extraction.normalized_payload)
      )
  ) then
    raise exception 'EXISTING_C14_NON_CSAL_INVOICE_REQUIRES_MANUAL_REVIEW';
  end if;
end;
$$;

create or replace function app_private.enforce_invoice_recipient_policy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_invoice public.invoices%rowtype;
  v_payload jsonb := coalesce(new.corrected_payload, new.normalized_payload);
begin
  select * into v_invoice
  from public.invoices
  where id = new.invoice_id
  for update;

  if not found
     or not app_private.invoice_payload_requires_c14_reinvoicing(v_invoice.project_id, v_payload) then
    return new;
  end if;

  if v_invoice.invoice_type = 'SERVICE' then
    update public.invoices
    set status = 'NON_PROCEEDING', updated_at = now()
    where id = v_invoice.id;
  end if;

  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id, action, new_values
  ) values (
    coalesce(new.confirmed_by, new.processed_by, v_invoice.created_by),
    v_invoice.project_id,
    'invoice',
    v_invoice.id,
    'INVOICE_REINVOICING_REQUIRED_C14',
    jsonb_build_object(
      'dispatch_id', v_invoice.dispatch_id,
      'invoice_type', v_invoice.invoice_type,
      'detected_billing_legal_name', v_payload ->> 'billing_legal_name',
      'reason', 'C14_NOT_ALLOWED_FOR_PROJECT',
      'document_status', case when v_invoice.invoice_type = 'SERVICE' then 'NON_PROCEEDING' else v_invoice.status::text end
    )
  );

  return new;
end;
$$;

drop trigger if exists enforce_invoice_recipient_policy on public.invoice_extractions;
create trigger enforce_invoice_recipient_policy
after insert on public.invoice_extractions
for each row execute function app_private.enforce_invoice_recipient_policy();

create or replace function app_private.refresh_dispatch_reconciliation(p_dispatch_id uuid)
returns public.dispatch_reconciliation_status
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_reconciliation public.dispatch_reconciliations%rowtype;
  v_product_id uuid;
  v_service_id uuid;
  v_product_requires_reinvoicing boolean := false;
  v_status public.dispatch_reconciliation_status;
begin
  select * into v_reconciliation
  from public.dispatch_reconciliations
  where dispatch_id = p_dispatch_id for update;
  if not found then
    insert into public.dispatch_reconciliations(project_id, dispatch_id, status)
    select project_id, id, 'NOT_STARTED'
    from public.dispatches where id = p_dispatch_id
    returning * into v_reconciliation;
  end if;

  select invoice.id,
    app_private.invoice_payload_requires_c14_reinvoicing(
      invoice.project_id,
      coalesce(extraction.corrected_payload, extraction.normalized_payload)
    )
  into v_product_id, v_product_requires_reinvoicing
  from public.invoices invoice
  join lateral (
    select item.corrected_payload, item.normalized_payload
    from public.invoice_extractions item
    where item.invoice_id = invoice.id
    order by item.created_at desc
    limit 1
  ) extraction on true
  where invoice.dispatch_id = p_dispatch_id
    and invoice.invoice_type = 'PRODUCT'
    and invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
  order by invoice.created_at desc
  limit 1;

  select id into v_service_id
  from public.invoices invoice
  where invoice.dispatch_id = p_dispatch_id
    and invoice.invoice_type = 'SERVICE'
    and invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
    and exists (select 1 from public.invoice_extractions extraction where extraction.invoice_id = invoice.id)
  order by invoice.created_at desc limit 1;

  v_status := case
    when v_product_id is null then 'NOT_STARTED'
    when v_product_requires_reinvoicing then 'PENDING_REINVOICING'
    when v_product_id = v_reconciliation.current_product_invoice_id
      and v_reconciliation.status in ('RECONCILED', 'WITH_DIFFERENCES', 'PENDING_REINVOICING')
      then v_reconciliation.status
    else 'PENDING_RECONCILIATION'
  end;

  update public.dispatch_reconciliations
  set current_product_invoice_id = v_product_id,
      current_service_invoice_id = v_service_id,
      status = v_status,
      version = version + 1,
      updated_at = now()
  where id = v_reconciliation.id;
  return v_status;
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
  v_recipient_requires_reinvoicing boolean;
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
  v_recipient_requires_reinvoicing :=
    app_private.invoice_payload_requires_c14_reinvoicing(v_dispatch.project_id, v_payload);
  v_validations := coalesce(v_payload -> 'validations', '{}'::jsonb) || jsonb_build_object(
    'period_valid', coalesce((v_payload -> 'validations' ->> 'period_valid')::boolean, false),
    'unit_valid', v_invoice_unit = upper(v_dispatch.real_unit_code),
    'quantity_valid', abs(v_difference) < 0.001,
    'billing_society_allowed', not v_recipient_requires_reinvoicing,
    'requires_reinvoicing', v_recipient_requires_reinvoicing
  );
  v_match := not v_recipient_requires_reinvoicing
    and coalesce((v_validations ->> 'document_valid')::boolean, false)
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
    when v_recipient_requires_reinvoicing then 'PENDING_REINVOICING'
    when v_match then 'RECONCILED'
    else 'WITH_DIFFERENCES'
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
  'Reconciles Product; C14 outside PRO-CSAL requires reinvoicing automatically, while ordinary differences require Purchasing review.';

alter function app_private.normalize_invoice_business_identity(text) owner to postgres;
alter function app_private.is_c14_invoice_recipient(text) owner to postgres;
alter function app_private.project_allows_c14_invoice_recipient(uuid) owner to postgres;
alter function app_private.invoice_payload_requires_c14_reinvoicing(uuid,jsonb) owner to postgres;
alter function app_private.enforce_invoice_recipient_policy() owner to postgres;
alter function app_private.refresh_dispatch_reconciliation(uuid) owner to postgres;
alter function public.reconcile_dispatch(uuid) owner to postgres;

revoke all on function app_private.normalize_invoice_business_identity(text) from public, anon, authenticated, service_role;
revoke all on function app_private.is_c14_invoice_recipient(text) from public, anon, authenticated, service_role;
revoke all on function app_private.project_allows_c14_invoice_recipient(uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.invoice_payload_requires_c14_reinvoicing(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function app_private.enforce_invoice_recipient_policy() from public, anon, authenticated, service_role;
revoke all on function app_private.refresh_dispatch_reconciliation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.reconcile_dispatch(uuid) from public, anon;
grant execute on function public.reconcile_dispatch(uuid) to authenticated, service_role;

do $$
begin
  if to_regprocedure('app_private.invoice_payload_requires_c14_reinvoicing(uuid,jsonb)') is null
     or not exists (
       select 1 from pg_catalog.pg_trigger trigger
       where trigger.tgrelid = 'public.invoice_extractions'::regclass
         and trigger.tgname = 'enforce_invoice_recipient_policy'
         and not trigger.tgisinternal
     ) then
    raise exception 'C14_INVOICE_POLICY_INSTALLATION_INCOMPLETE';
  end if;
end;
$$;

commit;
