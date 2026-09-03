-- 084_phase3_dispatch_invoice_reconciliation.sql
-- APPLIED SUCCESSFULLY — EXECUTED ON 2026-09-03.
--
-- Phase 3, part B: invoices and reconciliation belong directly to a Dispatch.
-- dispatches.real_volume is the official quantitative reconciliation value.

begin;

do $$
begin
  if to_regclass('public.batch_dispatches') is null
     or to_regclass('public.invoices') is null
     or to_regclass('public.invoice_lines') is null
     or to_regclass('public.invoice_documents') is null
     or to_regclass('public.ocr_extractions') is null
     or to_regprocedure(
       'app_private.prepare_document_upload_version(uuid,uuid,uuid,text,text,bigint)'
     ) is null then
    raise exception 'PHASE3_INVOICE_REQUIRED_CONTRACT_MISSING';
  end if;
end;
$$;

alter table public.projects
  add column billing_legal_name text,
  add column billing_tax_id text;

alter table public.projects
  add constraint projects_billing_legal_name_ck check (
    billing_legal_name is null
    or char_length(btrim(billing_legal_name)) between 2 and 200
  ),
  add constraint projects_billing_tax_id_ck check (
    billing_tax_id is null
    or char_length(regexp_replace(billing_tax_id, '[^0-9A-Za-z]', '', 'g'))
       between 3 and 30
  );

create function public.platform_update_project_billing_identity(
  p_company_id uuid,
  p_project_id uuid,
  p_billing_legal_name text,
  p_billing_tax_id text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_legal_name text := nullif(btrim(p_billing_legal_name), '');
  v_tax_id text := nullif(btrim(p_billing_tax_id), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app_private.is_platform_admin() then raise exception 'PERMISSION_DENIED'; end if;
  if v_legal_name is null or char_length(v_legal_name) not between 2 and 200 then
    raise exception 'PROJECT_BILLING_LEGAL_NAME_INVALID';
  end if;
  if v_tax_id is null
     or char_length(regexp_replace(v_tax_id, '[^0-9A-Za-z]', '', 'g')) not between 3 and 30 then
    raise exception 'PROJECT_BILLING_TAX_ID_INVALID';
  end if;
  update public.projects
  set billing_legal_name = v_legal_name,
      billing_tax_id = v_tax_id,
      updated_at = now()
  where id = p_project_id and company_id = p_company_id;
  if not found then raise exception 'PROJECT_COMPANY_MISMATCH'; end if;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type, entity_id,
    action, new_values
  ) values (
    v_actor, p_company_id, p_project_id, 'project', p_project_id,
    'PROJECT_BILLING_IDENTITY_UPDATED',
    jsonb_build_object('billing_legal_name', v_legal_name, 'billing_tax_id', v_tax_id)
  );
  return p_project_id;
end;
$$;
alter function public.platform_update_project_billing_identity(uuid,uuid,text,text) owner to postgres;
revoke all on function public.platform_update_project_billing_identity(uuid,uuid,text,text) from public, anon;
grant execute on function public.platform_update_project_billing_identity(uuid,uuid,text,text) to authenticated, service_role;

alter table public.invoices
  add column dispatch_id uuid,
  add column invoiced_quantity numeric(14,3),
  add column invoiced_unit_code text;

-- Migrate any previous guide-level link only when it resolves unambiguously.
do $$
begin
  if exists (
    select guide_invoice.invoice_id
    from public.guide_invoices guide_invoice
    join public.dispatch_guides guide on guide.id = guide_invoice.guide_id
    group by guide_invoice.invoice_id
    having count(distinct guide.dispatch_id) > 1
  ) then
    raise exception 'PHASE3_INVOICE_MULTIPLE_DISPATCH_CONTEXT';
  end if;
end;
$$;

update public.invoices invoice
set dispatch_id = resolved.dispatch_id
from (
  select guide_invoice.invoice_id, min(guide.dispatch_id::text)::uuid dispatch_id
  from public.guide_invoices guide_invoice
  join public.dispatch_guides guide on guide.id = guide_invoice.guide_id
  group by guide_invoice.invoice_id
) resolved
where invoice.id = resolved.invoice_id and invoice.dispatch_id is null;

do $$
begin
  if exists (select 1 from public.invoices where dispatch_id is null) then
    raise exception 'PHASE3_INVOICE_DISPATCH_CONTEXT_MISSING';
  end if;
end;
$$;

alter table public.invoices alter column dispatch_id set not null;
alter table public.invoices
  add constraint invoices_dispatch_project_fk
  foreign key (dispatch_id, project_id)
  references public.dispatches(id, project_id) on delete restrict;

create index idx_invoices_dispatch_created
on public.invoices(dispatch_id, created_at desc);

alter table public.ocr_extractions rename to invoice_extractions;
alter index if exists ocr_extractions_pkey rename to invoice_extractions_pkey;
alter table public.invoice_extractions
  add column invoice_id uuid references public.invoices(id) on delete restrict,
  add column processed_by uuid references public.profiles(id) on delete restrict,
  add column engine_version text not null default 'MIXTO_LISTO_PDF_TEXT_V2';

update public.invoice_extractions extraction
set invoice_id = relation.invoice_id
from public.document_processing_jobs job
join public.document_versions version on version.id = job.document_version_id
join public.invoice_documents relation on relation.document_id = version.document_id
where extraction.processing_job_id = job.id
  and extraction.invoice_id is null;

create type public.dispatch_reconciliation_status as enum (
  'PENDING_INVOICES',
  'PENDING_RECONCILIATION',
  'WITH_DIFFERENCES',
  'PENDING_REINVOICING',
  'RECONCILED'
);

create type public.dispatch_reconciliation_result as enum (
  'MATCHED', 'WITH_DIFFERENCES'
);

create table public.dispatch_reconciliations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  dispatch_id uuid not null references public.dispatches(id) on delete restrict,
  status public.dispatch_reconciliation_status not null
    default 'PENDING_INVOICES',
  current_product_invoice_id uuid references public.invoices(id) on delete restrict,
  current_service_invoice_id uuid references public.invoices(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dispatch_reconciliations_dispatch_uq unique (dispatch_id),
  constraint dispatch_reconciliations_id_project_uq unique (id, project_id),
  constraint dispatch_reconciliations_dispatch_project_fk
    foreign key (dispatch_id, project_id)
    references public.dispatches(id, project_id) on delete restrict
);

create table public.dispatch_reconciliation_attempts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  reconciliation_id uuid not null,
  dispatch_id uuid not null references public.dispatches(id) on delete restrict,
  product_invoice_id uuid not null references public.invoices(id) on delete restrict,
  extraction_id uuid references public.invoice_extractions(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  expected_order_number text not null,
  detected_order_number text,
  expected_supplier_id uuid not null references public.suppliers(id) on delete restrict,
  detected_supplier_name text,
  detected_supplier_tax_id text,
  expected_billing_legal_name text,
  detected_billing_legal_name text,
  expected_billing_tax_id text,
  detected_billing_tax_id text,
  expected_real_volume numeric(14,3) not null,
  expected_unit_code text not null,
  invoiced_quantity numeric(14,3) not null,
  invoice_unit_code text,
  difference numeric(14,3),
  validations jsonb not null,
  result public.dispatch_reconciliation_result not null,
  executed_by uuid not null references public.profiles(id) on delete restrict,
  executed_at timestamptz not null default now(),
  constraint dispatch_reconciliation_attempts_reconciliation_fk
    foreign key (reconciliation_id, project_id)
    references public.dispatch_reconciliations(id, project_id) on delete restrict,
  constraint dispatch_reconciliation_attempts_attempt_uq
    unique (reconciliation_id, attempt_number)
);

create index idx_dispatch_reconciliations_project_status
on public.dispatch_reconciliations(project_id, status, updated_at desc);
create index idx_dispatch_reconciliation_attempts_dispatch
on public.dispatch_reconciliation_attempts(dispatch_id, executed_at desc);

insert into public.dispatch_reconciliations(project_id, dispatch_id, status)
select dispatch.project_id, dispatch.id,
  case
    when count(invoice.id) filter (
      where invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
    ) = 0 then 'PENDING_INVOICES'
    when count(invoice.id) filter (
      where invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
        and invoice.invoice_type = 'PRODUCT'
    ) > 0
    and count(invoice.id) filter (
      where invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
        and invoice.invoice_type = 'SERVICE'
    ) > 0 then 'PENDING_RECONCILIATION'
    else 'PENDING_INVOICES'
  end::public.dispatch_reconciliation_status
from public.dispatches dispatch
left join public.invoices invoice on invoice.dispatch_id = dispatch.id
where dispatch.status = 'COMPLETED'
group by dispatch.project_id, dispatch.id;

alter table public.dispatch_reconciliations enable row level security;
alter table public.dispatch_reconciliation_attempts enable row level security;

create policy dispatch_reconciliations_select
on public.dispatch_reconciliations for select to authenticated
using (app_private.has_project_permission(project_id, 'invoice.view'));
create policy platform_admin_read_dispatch_reconciliations
on public.dispatch_reconciliations for select to authenticated
using (app_private.is_platform_admin());
create policy dispatch_reconciliation_attempts_select
on public.dispatch_reconciliation_attempts for select to authenticated
using (app_private.has_project_permission(project_id, 'invoice.view'));
create policy platform_admin_read_dispatch_reconciliation_attempts
on public.dispatch_reconciliation_attempts for select to authenticated
using (app_private.is_platform_admin());

revoke all on table public.dispatch_reconciliations,
  public.dispatch_reconciliation_attempts from public, anon, authenticated;
grant select on table public.dispatch_reconciliations,
  public.dispatch_reconciliation_attempts to authenticated;
grant all on table public.dispatch_reconciliations,
  public.dispatch_reconciliation_attempts to service_role;

create function app_private.refresh_dispatch_reconciliation(
  p_dispatch_id uuid
)
returns public.dispatch_reconciliation_status
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_reconciliation public.dispatch_reconciliations%rowtype;
  v_product_id uuid;
  v_service_id uuid;
  v_status public.dispatch_reconciliation_status;
begin
  select * into v_reconciliation
  from public.dispatch_reconciliations
  where dispatch_id = p_dispatch_id for update;
  if not found then
    insert into public.dispatch_reconciliations(project_id, dispatch_id)
    select project_id, id from public.dispatches where id = p_dispatch_id
    returning * into v_reconciliation;
  end if;

  select id into v_product_id from public.invoices
  where dispatch_id = p_dispatch_id and invoice_type = 'PRODUCT'
    and status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
    and exists (
      select 1 from public.invoice_extractions extraction
      where extraction.invoice_id = invoices.id
    )
  order by created_at desc limit 1;
  select id into v_service_id from public.invoices
  where dispatch_id = p_dispatch_id and invoice_type = 'SERVICE'
    and status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
    and exists (
      select 1 from public.invoice_extractions extraction
      where extraction.invoice_id = invoices.id
    )
  order by created_at desc limit 1;

  v_status := case
    when v_reconciliation.status = 'RECONCILED' then 'RECONCILED'
    when v_reconciliation.status = 'WITH_DIFFERENCES'
      then 'WITH_DIFFERENCES'
    when v_reconciliation.status = 'PENDING_REINVOICING'
      and v_product_id = v_reconciliation.current_product_invoice_id
      then 'PENDING_REINVOICING'
    when v_product_id is not null and v_service_id is not null
      then 'PENDING_RECONCILIATION'
    else 'PENDING_INVOICES'
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

create function app_private.sync_completed_dispatch_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.status = 'COMPLETED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform app_private.refresh_dispatch_reconciliation(new.id);
  end if;
  return new;
end;
$$;
create trigger dispatch_reconciliation_lifecycle
after insert or update of status on public.dispatches
for each row execute function app_private.sync_completed_dispatch_reconciliation();

create function public.prepare_dispatch_invoice_upload(
  p_batch_id uuid,
  p_dispatch_id uuid,
  p_invoice_type public.invoice_type,
  p_payload jsonb,
  p_file_name text,
  p_file_size bigint,
  p_replaces_invoice_id uuid default null
)
returns table(
  invoice_id uuid,
  document_id uuid,
  version_id uuid,
  storage_bucket text,
  storage_path text,
  upload_token_context text
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_batch public.batches%rowtype;
  v_invoice_id uuid := gen_random_uuid();
  v_document_id uuid := gen_random_uuid();
  v_prepared record;
  v_invoice_number text := nullif(btrim(p_payload ->> 'invoice_number'), '');
  v_invoice_date date;
  v_currency text := upper(nullif(btrim(p_payload ->> 'currency'), ''));
  v_subtotal numeric;
  v_total numeric;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_dispatch from public.dispatches
  where id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_dispatch.project_id, 'invoice.create')
  then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.status <> 'COMPLETED' then
    raise exception 'DISPATCH_NOT_COMPLETED_FOR_INVOICE';
  end if;
  select batch.* into v_batch
  from public.batches batch
  join public.batch_dispatches relation on relation.batch_id = batch.id
  where batch.id = p_batch_id and relation.dispatch_id = v_dispatch.id
    and relation.removed_at is null for update of batch;
  if not found or v_batch.status <> 'OPEN' then
    raise exception 'INVOICE_BATCH_CONTEXT_INVALID';
  end if;
  if lower(coalesce(p_file_name, '')) !~ '\.pdf$'
     or p_file_size is null or p_file_size <= 0 or p_file_size > 10485760 then
    raise exception 'INVOICE_PDF_INVALID';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
     or coalesce((p_payload -> 'validations' ->> 'document_valid')::boolean, false)
        is not true
     or coalesce((p_payload -> 'validations' ->> 'project_valid')::boolean, false)
        is not true
     or coalesce((p_payload -> 'validations' ->> 'supplier_valid')::boolean, false)
        is not true
     or coalesce((p_payload -> 'validations' ->> 'order_valid')::boolean, false)
        is not true then
    raise exception 'INVOICE_CRITICAL_VALIDATION_FAILED';
  end if;
  if upper(p_payload ->> 'detected_type') <> p_invoice_type::text then
    raise exception 'INVOICE_TYPE_MISMATCH';
  end if;
  begin
    v_invoice_date := (p_payload ->> 'invoice_date')::date;
    v_subtotal := (p_payload ->> 'subtotal')::numeric;
    v_total := (p_payload ->> 'total')::numeric;
  exception when others then
    raise exception 'INVOICE_FIELDS_INVALID';
  end;
  if v_invoice_number is null or v_invoice_date is null
     or v_currency !~ '^[A-Z]{3}$' or v_total <= 0
     or v_subtotal < 0 or v_subtotal > v_total then
    raise exception 'INVOICE_FIELDS_INVALID';
  end if;
  if p_replaces_invoice_id is not null and not exists (
    select 1 from public.invoices previous
    where previous.id = p_replaces_invoice_id
      and previous.dispatch_id = v_dispatch.id
      and previous.invoice_type = p_invoice_type
      and previous.status::text not in ('SUPERSEDED', 'CANCELLED')
  ) then raise exception 'REPLACED_INVOICE_CONTEXT_INVALID'; end if;

  if exists (
    select 1 from public.invoices current_invoice
    where current_invoice.dispatch_id = v_dispatch.id
      and current_invoice.invoice_type = p_invoice_type
      and current_invoice.status::text not in (
        'SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING'
      )
      and (p_replaces_invoice_id is null
        or current_invoice.id <> p_replaces_invoice_id)
  ) then raise exception 'ACTIVE_DISPATCH_INVOICE_ALREADY_EXISTS'; end if;

  insert into public.invoices(
    id, project_id, dispatch_id, supplier_id, invoice_type,
    invoice_number, invoice_date, order_number, pca_original,
    subtotal, total, currency, invoiced_quantity, invoiced_unit_code,
    status, replaces_invoice_id, created_by
  ) values (
    v_invoice_id, v_dispatch.project_id, v_dispatch.id, v_dispatch.supplier_id,
    p_invoice_type, v_invoice_number, v_invoice_date,
    v_dispatch.order_number, nullif(btrim(p_payload ->> 'pca_original'), ''),
    v_subtotal, v_total, v_currency,
    case when p_invoice_type = 'PRODUCT'
      then (p_payload ->> 'invoiced_quantity')::numeric else null end,
    case when p_invoice_type = 'PRODUCT'
      then nullif(btrim(p_payload ->> 'normalized_unit'), '') else null end,
    'REGISTERED',
    p_replaces_invoice_id, v_actor
  );

  insert into public.invoice_lines(
    invoice_id, line_number, code, description, quantity,
    unit_code, unit_price, line_total
  )
  select v_invoice_id, line.position::integer,
    nullif(upper(btrim(line.value ->> 'code')), ''),
    btrim(line.value ->> 'description'),
    (line.value ->> 'quantity')::numeric,
    nullif(upper(btrim(line.value ->> 'unit_code')), ''),
    case when jsonb_typeof(line.value -> 'unit_price') = 'number'
      then (line.value ->> 'unit_price')::numeric end,
    case when jsonb_typeof(line.value -> 'line_total') = 'number'
      then (line.value ->> 'line_total')::numeric end
  from jsonb_array_elements(p_payload -> 'lines')
       with ordinality line(value, position);

  insert into public.documents(id, project_id, category, created_by)
  values (v_document_id, v_dispatch.project_id, 'INVOICE', v_actor);
  insert into public.invoice_documents(project_id, invoice_id, document_id, purpose)
  values (v_dispatch.project_id, v_invoice_id, v_document_id, p_invoice_type::text);
  select prepared.* into v_prepared
  from app_private.prepare_document_upload_version(
    v_document_id, v_dispatch.project_id, v_actor,
    p_file_name, 'application/pdf', p_file_size
  ) prepared;

  insert into public.document_processing_jobs(
    document_version_id, status, provider_key, attempt_count
  ) values (
    v_prepared.version_id, 'PENDING', 'MIXTO_LISTO_PDF_TEXT_V2', 1
  );

  perform app_private.refresh_dispatch_reconciliation(v_dispatch.id);
  return query select v_invoice_id, v_document_id, v_prepared.version_id,
    v_prepared.storage_bucket, v_prepared.storage_path,
    concat(v_dispatch.project_id, ':', v_dispatch.id);
end;
$$;

create function public.complete_dispatch_invoice_processing(
  p_invoice_id uuid,
  p_document_version_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice public.invoices%rowtype;
  v_job_id uuid;
  v_extraction_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_invoice from public.invoices
  where id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_invoice.project_id, 'invoice.create')
  then raise exception 'PERMISSION_DENIED'; end if;
  if not exists (
    select 1 from public.invoice_documents relation
    join public.document_versions version
      on version.document_id = relation.document_id
    where relation.invoice_id = v_invoice.id
      and version.id = p_document_version_id
      and version.upload_status = 'UPLOADED'
  ) then raise exception 'INVOICE_DOCUMENT_NOT_UPLOADED'; end if;

  select id into v_job_id from public.document_processing_jobs
  where document_version_id = p_document_version_id
  order by created_at desc limit 1 for update;
  if not found then raise exception 'INVOICE_PROCESSING_JOB_NOT_FOUND'; end if;
  update public.document_processing_jobs
  set status = 'COMPLETED', started_at = coalesce(started_at, now()),
      completed_at = now(), error_message = null
  where id = v_job_id;
  insert into public.invoice_extractions(
    processing_job_id, invoice_id, raw_payload, normalized_payload,
    confidence, verification_status, confirmed_by, confirmed_at,
    processed_by, engine_version
  ) values (
    v_job_id, v_invoice.id, p_payload, p_payload, 1,
    'CONFIRMED', v_actor, now(), v_actor, 'MIXTO_LISTO_PDF_TEXT_V2'
  ) returning id into v_extraction_id;

  if v_invoice.replaces_invoice_id is not null then
    update public.invoices set status = 'SUPERSEDED', updated_at = now()
    where id = v_invoice.replaces_invoice_id;
  end if;

  perform app_private.refresh_dispatch_reconciliation(v_invoice.dispatch_id);
  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id, action, new_values
  ) values (
    v_actor, v_invoice.project_id, 'invoice', v_invoice.id,
    'DISPATCH_INVOICE_PROCESSED', jsonb_build_object(
      'dispatch_id', v_invoice.dispatch_id,
      'invoice_type', v_invoice.invoice_type,
      'extraction_id', v_extraction_id,
      'engine_version', 'MIXTO_LISTO_PDF_TEXT_V2'
    )
  );
  return v_extraction_id;
end;
$$;

create function public.reconcile_dispatch(p_dispatch_id uuid)
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
  set status = case when v_match then 'RECONCILED'
      else 'WITH_DIFFERENCES' end,
      version = version + 1, updated_at = now()
  where id = v_reconciliation.id;
  return case when v_match then 'RECONCILED'
    else 'WITH_DIFFERENCES' end;
end;
$$;

create function public.fail_dispatch_invoice_processing(
  p_invoice_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice public.invoices%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then return; end if;
  if not app_private.has_project_permission(v_invoice.project_id, 'invoice.create')
  then raise exception 'PERMISSION_DENIED'; end if;
  update public.invoices set status = 'NON_PROCEEDING', updated_at = now()
  where id = v_invoice.id;
  update public.document_processing_jobs job
  set status = 'FAILED', completed_at = now(),
      error_message = left(coalesce(nullif(btrim(p_reason), ''), 'UPLOAD_FAILED'), 500)
  from public.invoice_documents relation
  join public.document_versions version on version.document_id = relation.document_id
  where relation.invoice_id = v_invoice.id
    and job.document_version_id = version.id
    and job.status <> 'COMPLETED';
  perform app_private.refresh_dispatch_reconciliation(v_invoice.dispatch_id);
end;
$$;

create function app_private.guard_dispatch_reconciliation_attempt_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  raise exception 'DISPATCH_RECONCILIATION_ATTEMPT_IMMUTABLE';
end;
$$;
create trigger dispatch_reconciliation_attempts_immutable
before update or delete on public.dispatch_reconciliation_attempts
for each row execute function app_private.guard_dispatch_reconciliation_attempt_immutable();

create function public.request_dispatch_reinvoicing(
  p_dispatch_id uuid,
  p_reason text
)
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
  select reconciliation.* into v_reconciliation
  from public.dispatch_reconciliations reconciliation
  where reconciliation.dispatch_id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_RECONCILIATION_NOT_FOUND'; end if;
  if not app_private.has_project_permission(
    v_reconciliation.project_id, 'invoice.review'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_reconciliation.status <> 'WITH_DIFFERENCES' then
    raise exception 'REINVOICING_NOT_AVAILABLE';
  end if;
  if v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'REINVOICING_REASON_INVALID';
  end if;
  update public.dispatch_reconciliations
  set status = 'PENDING_REINVOICING', version = version + 1,
      updated_at = now() where id = v_reconciliation.id;
  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id, action, new_values
  ) values (
    v_actor, v_reconciliation.project_id, 'dispatch_reconciliation',
    v_reconciliation.id, 'DISPATCH_REINVOICING_REQUESTED',
    jsonb_build_object('dispatch_id', p_dispatch_id, 'reason', v_reason)
  );
  return 'PENDING_REINVOICING';
end;
$$;

alter function app_private.refresh_dispatch_reconciliation(uuid) owner to postgres;
alter function app_private.sync_completed_dispatch_reconciliation() owner to postgres;
alter function app_private.guard_dispatch_reconciliation_attempt_immutable() owner to postgres;
alter function public.prepare_dispatch_invoice_upload(
  uuid,uuid,public.invoice_type,jsonb,text,bigint,uuid
) owner to postgres;
alter function public.complete_dispatch_invoice_processing(uuid,uuid,jsonb)
owner to postgres;
alter function public.fail_dispatch_invoice_processing(uuid,text) owner to postgres;
alter function public.reconcile_dispatch(uuid) owner to postgres;
alter function public.request_dispatch_reinvoicing(uuid,text) owner to postgres;

revoke all on function app_private.refresh_dispatch_reconciliation(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.sync_completed_dispatch_reconciliation()
from public, anon, authenticated, service_role;
revoke all on function app_private.guard_dispatch_reconciliation_attempt_immutable()
from public, anon, authenticated, service_role;
revoke all on function public.prepare_dispatch_invoice_upload(
  uuid,uuid,public.invoice_type,jsonb,text,bigint,uuid
) from public, anon;
revoke all on function public.complete_dispatch_invoice_processing(
  uuid,uuid,jsonb
) from public, anon;
revoke all on function public.fail_dispatch_invoice_processing(uuid,text)
from public, anon;
revoke all on function public.reconcile_dispatch(uuid) from public, anon;
revoke all on function public.request_dispatch_reinvoicing(uuid,text)
from public, anon;
grant execute on function public.prepare_dispatch_invoice_upload(
  uuid,uuid,public.invoice_type,jsonb,text,bigint,uuid
) to authenticated, service_role;
grant execute on function public.complete_dispatch_invoice_processing(
  uuid,uuid,jsonb
) to authenticated, service_role;
grant execute on function public.fail_dispatch_invoice_processing(uuid,text)
to authenticated, service_role;
grant execute on function public.reconcile_dispatch(uuid)
to authenticated, service_role;
grant execute on function public.request_dispatch_reinvoicing(uuid,text)
to authenticated, service_role;

commit;

-- Live QA after manual execution:
--   * invoice ownership is Dispatch-level;
--   * both invoice types are required before reconciliation;
--   * only PRODUCT quantity is compared with dispatches.real_volume;
--   * attempts are immutable snapshots and replacement invoices remain linked;
--   * project receiver and supplier issuer identities are validated separately.
