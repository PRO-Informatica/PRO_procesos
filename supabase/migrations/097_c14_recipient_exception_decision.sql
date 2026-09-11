-- C14 is a normal recipient for PRO-CSAL. In every other project it is an
-- explicit, auditable Purchasing decision independent from reconciliation.
begin;

do $$
begin
  if to_regprocedure('app_private.is_c14_invoice_recipient(text)') is null
     or to_regprocedure('app_private.project_allows_c14_invoice_recipient(uuid)') is null
     or to_regprocedure('app_private.refresh_dispatch_reconciliation(uuid)') is null
     or to_regprocedure('public.reconcile_dispatch(uuid)') is null then
    raise exception 'C14_EXCEPTION_PREREQUISITES_MISSING';
  end if;
  if to_regtype('public.invoice_recipient_exception_status') is not null
     or to_regclass('public.invoice_recipient_exceptions') is not null then
    raise exception 'C14_EXCEPTION_MODEL_ALREADY_EXISTS';
  end if;
  if exists (
    select 1
    from public.invoices invoice
    join public.invoice_extractions extraction on extraction.invoice_id = invoice.id
    where invoice.invoice_type = 'SERVICE'
      and invoice.status::text = 'NON_PROCEEDING'
      and app_private.invoice_payload_requires_c14_reinvoicing(
        invoice.project_id,
        coalesce(extraction.corrected_payload, extraction.normalized_payload)
      )
  ) then
    raise exception 'C14_SERVICE_RECOVERY_REQUIRES_MANUAL_REVIEW';
  end if;
end;
$$;

create type public.invoice_recipient_exception_status as enum (
  'PENDING',
  'APPROVED',
  'REINVOICE_REQUESTED'
);

create table public.invoice_recipient_exceptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  dispatch_id uuid not null references public.dispatches(id) on delete restrict,
  invoice_id uuid not null unique references public.invoices(id) on delete restrict,
  invoice_type public.invoice_type not null,
  detected_billing_legal_name text not null,
  detected_identity text not null,
  order_number text,
  status public.invoice_recipient_exception_status not null default 'PENDING',
  decided_by uuid references public.profiles(id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_recipient_exception_decision_ck check (
    (status = 'PENDING' and decided_by is null and decided_at is null)
    or (status <> 'PENDING' and decided_by is not null and decided_at is not null)
  )
);

create index idx_invoice_recipient_exceptions_project_status
  on public.invoice_recipient_exceptions(project_id, status, created_at desc);
create index idx_invoice_recipient_exceptions_dispatch
  on public.invoice_recipient_exceptions(dispatch_id, created_at desc);

alter table public.invoice_recipient_exceptions enable row level security;
create policy invoice_recipient_exceptions_select
on public.invoice_recipient_exceptions for select to authenticated
using (app_private.has_project_permission(project_id, 'invoice.view'));
create policy platform_admin_read_invoice_recipient_exceptions
on public.invoice_recipient_exceptions for select to authenticated
using (app_private.is_platform_admin());

revoke all on table public.invoice_recipient_exceptions from public, anon, authenticated;
grant select on table public.invoice_recipient_exceptions to authenticated;
grant all on table public.invoice_recipient_exceptions to service_role;

-- Convert historical automatic C14 decisions. A genuine prior human request
-- remains requested; an automatic state becomes PENDING for Purchasing review.
with latest_extraction as (
  select distinct on (extraction.invoice_id)
    extraction.invoice_id,
    coalesce(extraction.corrected_payload, extraction.normalized_payload) as payload
  from public.invoice_extractions extraction
  where extraction.invoice_id is not null
  order by extraction.invoice_id, extraction.created_at desc
), candidates as (
  select invoice.*, latest.payload,
    request.actor_user_id as requested_by,
    request.created_at as requested_at
  from public.invoices invoice
  join latest_extraction latest on latest.invoice_id = invoice.id
  left join public.dispatch_reconciliations reconciliation
    on reconciliation.dispatch_id = invoice.dispatch_id
  left join lateral (
    select audit.actor_user_id, audit.created_at
    from public.audit_events audit
    where audit.entity_id = reconciliation.id
      and audit.action = 'DISPATCH_REINVOICING_REQUESTED'
    order by audit.created_at desc
    limit 1
  ) request on true
  where invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
    and app_private.invoice_payload_requires_c14_reinvoicing(invoice.project_id, latest.payload)
)
insert into public.invoice_recipient_exceptions(
  project_id, dispatch_id, invoice_id, invoice_type,
  detected_billing_legal_name, detected_identity, order_number,
  status, decided_by, decided_at
)
select project_id, dispatch_id, id, invoice_type,
  payload ->> 'billing_legal_name',
  app_private.normalize_invoice_business_identity(payload ->> 'billing_legal_name'),
  order_number,
  case when requested_by is null then 'PENDING' else 'REINVOICE_REQUESTED' end::public.invoice_recipient_exception_status,
  requested_by,
  requested_at
from candidates;

update public.dispatch_reconciliations reconciliation
set status = 'PENDING_RECONCILIATION',
    version = version + 1,
    updated_at = now()
from public.invoice_recipient_exceptions exception
where exception.invoice_id = reconciliation.current_product_invoice_id
  and exception.status = 'PENDING'
  and reconciliation.status = 'PENDING_REINVOICING';

create or replace function app_private.invoice_payload_requires_recipient_exception(
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

create or replace function app_private.enforce_invoice_recipient_policy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_invoice public.invoices%rowtype;
  v_payload jsonb := coalesce(new.corrected_payload, new.normalized_payload);
  v_inserted integer := 0;
begin
  select * into v_invoice
  from public.invoices
  where id = new.invoice_id
  for update;

  if not found
     or not app_private.invoice_payload_requires_recipient_exception(v_invoice.project_id, v_payload) then
    return new;
  end if;

  insert into public.invoice_recipient_exceptions(
    project_id, dispatch_id, invoice_id, invoice_type,
    detected_billing_legal_name, detected_identity, order_number
  ) values (
    v_invoice.project_id,
    v_invoice.dispatch_id,
    v_invoice.id,
    v_invoice.invoice_type,
    v_payload ->> 'billing_legal_name',
    app_private.normalize_invoice_business_identity(v_payload ->> 'billing_legal_name'),
    v_invoice.order_number
  ) on conflict (invoice_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    insert into public.audit_events(
      actor_user_id, project_id, entity_type, entity_id, action, new_values
    ) values (
      coalesce(new.confirmed_by, new.processed_by, v_invoice.created_by),
      v_invoice.project_id,
      'invoice_recipient_exception',
      v_invoice.id,
      'INVOICE_RECIPIENT_EXCEPTION_CREATED',
      jsonb_build_object(
        'invoice_id', v_invoice.id,
        'dispatch_id', v_invoice.dispatch_id,
        'invoice_type', v_invoice.invoice_type,
        'order_number', v_invoice.order_number,
        'detected_billing_legal_name', v_payload ->> 'billing_legal_name',
        'detected_identity', app_private.normalize_invoice_business_identity(v_payload ->> 'billing_legal_name'),
        'status', 'PENDING'
      )
    );
  end if;

  return new;
end;
$$;

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
  v_product_exception public.invoice_recipient_exception_status;
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

  select invoice.id, exception.status
  into v_product_id, v_product_exception
  from public.invoices invoice
  left join public.invoice_recipient_exceptions exception on exception.invoice_id = invoice.id
  where invoice.dispatch_id = p_dispatch_id
    and invoice.invoice_type = 'PRODUCT'
    and invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
    and exists (select 1 from public.invoice_extractions extraction where extraction.invoice_id = invoice.id)
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
    when v_product_exception = 'REINVOICE_REQUESTED' then 'PENDING_REINVOICING'
    when v_product_exception = 'PENDING' then 'PENDING_RECONCILIATION'
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
  v_exception_status public.invoice_recipient_exception_status;
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

  v_payload := coalesce(v_extraction.corrected_payload, v_extraction.normalized_payload);
  v_invoice_quantity := (v_payload ->> 'invoiced_quantity')::numeric;
  v_invoice_unit := upper(v_payload ->> 'normalized_unit');
  v_difference := v_invoice_quantity - v_dispatch.real_volume;
  v_validations := coalesce(v_payload -> 'validations', '{}'::jsonb) || jsonb_build_object(
    'period_valid', coalesce((v_payload -> 'validations' ->> 'period_valid')::boolean, false),
    'unit_valid', v_invoice_unit = upper(v_dispatch.real_unit_code),
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
  set status = v_next_status, version = version + 1, updated_at = now()
  where id = v_reconciliation.id;
  return v_next_status;
end;
$$;

create function public.decide_invoice_recipient_exception(
  p_invoice_id uuid,
  p_decision text
)
returns table(
  exception_status public.invoice_recipient_exception_status,
  reconciliation_status public.dispatch_reconciliation_status
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_exception public.invoice_recipient_exceptions%rowtype;
  v_invoice public.invoices%rowtype;
  v_decision text := upper(btrim(coalesce(p_decision, '')));
  v_next_exception public.invoice_recipient_exception_status;
  v_reconciliation_status public.dispatch_reconciliation_status;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_decision not in ('APPROVE', 'REQUEST_REINVOICE') then raise exception 'EXCEPTION_DECISION_INVALID'; end if;

  select * into v_exception
  from public.invoice_recipient_exceptions
  where invoice_id = p_invoice_id
  for update;
  if not found then raise exception 'EXCEPTION_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_exception.project_id, 'invoice.review') then raise exception 'PERMISSION_DENIED'; end if;
  if v_exception.status <> 'PENDING' then raise exception 'EXCEPTION_ALREADY_DECIDED'; end if;
  select * into v_invoice from public.invoices where id = v_exception.invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;

  v_next_exception := case when v_decision = 'APPROVE' then 'APPROVED' else 'REINVOICE_REQUESTED' end;
  update public.invoice_recipient_exceptions
  set status = v_next_exception, decided_by = v_actor, decided_at = now(), updated_at = now()
  where id = v_exception.id;

  if v_decision = 'APPROVE' then
    if v_invoice.invoice_type = 'PRODUCT' then
      v_reconciliation_status := public.reconcile_dispatch(v_invoice.dispatch_id);
    else
      v_reconciliation_status := app_private.refresh_dispatch_reconciliation(v_invoice.dispatch_id);
    end if;
  elsif v_invoice.invoice_type = 'PRODUCT' then
    update public.dispatch_reconciliations
    set status = 'PENDING_REINVOICING', version = version + 1, updated_at = now()
    where dispatch_id = v_invoice.dispatch_id
    returning status into v_reconciliation_status;
  else
    update public.invoices
    set status = 'NON_PROCEEDING', updated_at = now()
    where id = v_invoice.id;
    v_reconciliation_status := app_private.refresh_dispatch_reconciliation(v_invoice.dispatch_id);
  end if;

  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id, action, old_values, new_values
  ) values (
    v_actor,
    v_exception.project_id,
    'invoice_recipient_exception',
    v_exception.id,
    case when v_decision = 'APPROVE'
      then 'INVOICE_RECIPIENT_EXCEPTION_APPROVED'
      else 'INVOICE_RECIPIENT_EXCEPTION_REINVOICE_REQUESTED'
    end,
    jsonb_build_object('status', 'PENDING'),
    jsonb_build_object(
      'status', v_next_exception,
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'invoice_type', v_invoice.invoice_type,
      'project_id', v_invoice.project_id,
      'dispatch_id', v_invoice.dispatch_id,
      'order_number', v_exception.order_number,
      'detected_billing_legal_name', v_exception.detected_billing_legal_name,
      'detected_identity', v_exception.detected_identity,
      'decided_by', v_actor,
      'decided_at', now()
    )
  );

  return query select v_next_exception, v_reconciliation_status;
end;
$$;

comment on table public.invoice_recipient_exceptions is
  'Auditable C14 recipient decisions, independent from Product reconciliation.';
comment on function public.decide_invoice_recipient_exception(uuid,text) is
  'Purchasing approves a C14 exception or requests reinvoicing for one invoice.';
comment on function public.reconcile_dispatch(uuid) is
  'Reconciles Product only after any C14 recipient exception has been approved.';

alter function app_private.invoice_payload_requires_recipient_exception(uuid,jsonb) owner to postgres;
alter function app_private.enforce_invoice_recipient_policy() owner to postgres;
alter function app_private.refresh_dispatch_reconciliation(uuid) owner to postgres;
alter function public.reconcile_dispatch(uuid) owner to postgres;
alter function public.decide_invoice_recipient_exception(uuid,text) owner to postgres;

revoke all on function app_private.invoice_payload_requires_recipient_exception(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function app_private.enforce_invoice_recipient_policy() from public, anon, authenticated, service_role;
revoke all on function app_private.refresh_dispatch_reconciliation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.reconcile_dispatch(uuid) from public, anon;
revoke all on function public.decide_invoice_recipient_exception(uuid,text) from public, anon;
grant execute on function public.reconcile_dispatch(uuid) to authenticated, service_role;
grant execute on function public.decide_invoice_recipient_exception(uuid,text) to authenticated, service_role;

do $$
begin
  if to_regprocedure('public.decide_invoice_recipient_exception(uuid,text)') is null
     or not exists (
       select 1 from pg_catalog.pg_trigger trigger
       where trigger.tgrelid = 'public.invoice_extractions'::regclass
         and trigger.tgname = 'enforce_invoice_recipient_policy'
         and not trigger.tgisinternal
     )
     or exists (
       select 1
       from public.invoice_recipient_exceptions exception
       join public.invoices invoice on invoice.id = exception.invoice_id
       join public.projects project on project.id = invoice.project_id
       join public.companies company on company.id = project.company_id
       where upper(btrim(company.code)) = 'PRO-CSAL'
     ) then
    raise exception 'C14_EXCEPTION_INSTALLATION_INCOMPLETE';
  end if;
end;
$$;

commit;
