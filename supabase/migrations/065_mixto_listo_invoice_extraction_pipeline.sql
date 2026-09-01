-- 065_mixto_listo_invoice_extraction_pipeline.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Adds a PDF-only, order-bound staging intake for the Mixto Listo extractor.
-- No Invoice or Order association is created until a verified extraction
-- derives the same normalized Order from the confirmed PCA.

begin;

-- ============================================================
-- 1. PRECONDITIONS / DRIFT GUARDS
-- ============================================================

do $$
begin
  if to_regclass('public.reconciliation_orders') is null
     or to_regclass('public.ocr_extractions') is null
     or to_regclass('public.extraction_correction_reasons') is null
     or to_regprocedure(
       'app_private.prepare_document_upload_version(uuid,uuid,uuid,text,text,bigint)'
     ) is null
     or to_regprocedure(
       'app_private.normalize_reconciliation_order_number(text)'
     ) is null
     or to_regprocedure(
       'app_private.recalculate_reconciliation_order(uuid)'
     ) is null then
    raise exception 'MIXTO_LISTO_INTAKE_REQUIRED_CONTRACT_MISSING';
  end if;

  if to_regclass('public.mixto_listo_invoice_intakes') is not null
     or to_regprocedure('app_private.guard_invoice_document_pdf()') is not null
     or to_regprocedure('app_private.guard_mixto_listo_order_assignment()') is not null
     or to_regprocedure(
       'public.prepare_mixto_listo_invoice_intake(uuid,public.invoice_type,text,date,text,numeric,numeric,text,bigint,uuid)'
     ) is not null
     or to_regprocedure(
       'public.confirm_mixto_listo_invoice_intake(uuid,text,jsonb,uuid,text)'
     ) is not null then
    raise exception 'MIXTO_LISTO_INTAKE_CONTRACT_ALREADY_EXISTS';
  end if;
end;
$$;

-- ============================================================
-- 2. STATUS + PCA NORMALIZATION
-- ============================================================

create type public.mixto_listo_invoice_intake_status as enum (
  'UPLOAD_PENDING',
  'EXTRACTION_PENDING',
  'READY_TO_CONFIRM',
  'ORDER_MISMATCH',
  'NEEDS_CORRECTION',
  'CONFIRMED',
  'FAILED'
);

create function app_private.mixto_listo_order_from_pca(p_value text)
returns text
language sql
immutable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select case
    when upper(btrim(p_value)) ~ '^PCA-[0-9]+-[0-9]+$' then
      coalesce(
        nullif(
          ltrim(
            substring(upper(btrim(p_value)) from '([0-9]+)$'),
            '0'
          ),
          ''
        ),
        '0'
      )
    else null
  end;
$$;

alter function app_private.mixto_listo_order_from_pca(text)
owner to postgres;

revoke all
on function app_private.mixto_listo_order_from_pca(text)
from public, anon, authenticated;

grant execute
on function app_private.mixto_listo_order_from_pca(text)
to service_role;

-- ============================================================
-- 3. SPECIFIC CORRECTION REASONS
-- ============================================================

insert into public.extraction_correction_reasons(
  code, name, description, active
)
select seed.code, seed.name, seed.description, true
from (
  values
    (
      'QUANTITY_DETECTION_INCORRECT',
      'Cantidad detectada incorrectamente',
      'La cantidad de una o más líneas fue detectada incorrectamente.'
    ),
    (
      'UNIT_DETECTION_INCORRECT',
      'Medida detectada incorrectamente',
      'La unidad de medida de una o más líneas fue detectada incorrectamente.'
    ),
    (
      'PRODUCT_CODE_DETECTION_INCORRECT',
      'Código detectado incorrectamente',
      'El valor de la columna Código fue detectado incorrectamente.'
    ),
    (
      'DESCRIPTION_DETECTION_INCORRECT',
      'Descripción detectada incorrectamente',
      'La descripción de una o más líneas fue detectada incorrectamente.'
    ),
    (
      'PCA_DETECTION_INCORRECT',
      'PCA detectado incorrectamente',
      'El PCA contenido en OBSERVACIONES fue detectado incorrectamente.'
    ),
    (
      'FIELD_NOT_DETECTED',
      'Campo no detectado',
      'La factura contiene un campo requerido que el extractor no detectó.'
    )
) seed(code, name, description)
where not exists (
  select 1
  from public.extraction_correction_reasons current_reason
  where current_reason.code = seed.code
);

-- OTHER already exists in the canonical catalogue. Keep its identity and
-- wording, but fail if the required stable code is absent.
do $$
begin
  if not exists (
    select 1
    from public.extraction_correction_reasons
    where code = 'OTHER' and active = true
  ) then
    raise exception 'MIXTO_LISTO_OTHER_CORRECTION_REASON_MISSING';
  end if;
end;
$$;

-- ============================================================
-- 4. ORDER-BOUND STAGING INTAKE
-- ============================================================

create table public.mixto_listo_invoice_intakes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  reconciliation_order_id uuid not null,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  document_id uuid not null unique references public.documents(id) on delete restrict,
  invoice_type public.invoice_type not null,
  invoice_number text not null,
  invoice_date date not null,
  currency text not null,
  subtotal numeric not null,
  total numeric not null,
  replaces_invoice_id uuid references public.invoices(id) on delete restrict,
  status public.mixto_listo_invoice_intake_status not null
    default 'UPLOAD_PENDING',
  observations_raw text,
  pca_original text,
  detected_order_number text,
  extraction_id uuid unique references public.ocr_extractions(id) on delete restrict,
  confirmed_invoice_id uuid unique references public.invoices(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint mixto_listo_intakes_order_project_fk
    foreign key (reconciliation_order_id, project_id)
    references public.reconciliation_orders(id, project_id) on delete restrict,
  constraint mixto_listo_intakes_number_ck
    check (nullif(btrim(invoice_number), '') is not null
      and char_length(invoice_number) <= 120),
  constraint mixto_listo_intakes_currency_ck
    check (currency ~ '^[A-Z]{3}$'),
  constraint mixto_listo_intakes_totals_ck
    check (subtotal >= 0 and total > 0 and subtotal <= total),
  constraint mixto_listo_intakes_pca_ck
    check (pca_original is null or (
      pca_original = upper(btrim(pca_original))
      and char_length(pca_original) <= 255
    )),
  constraint mixto_listo_intakes_confirmation_ck
    check (
      (status = 'CONFIRMED'
        and confirmed_invoice_id is not null
        and confirmed_at is not null)
      or
      (status <> 'CONFIRMED'
        and confirmed_invoice_id is null
        and confirmed_at is null)
    )
);

create index idx_mixto_listo_intakes_order_status
on public.mixto_listo_invoice_intakes(
  reconciliation_order_id,
  status,
  created_at desc
);

alter table public.mixto_listo_invoice_intakes enable row level security;

create policy mixto_listo_invoice_intakes_select
on public.mixto_listo_invoice_intakes
for select to authenticated
using (app_private.has_project_permission(project_id, 'invoice.view'));

create policy platform_admin_read_mixto_listo_invoice_intakes
on public.mixto_listo_invoice_intakes
for select to authenticated
using (app_private.is_platform_admin());

revoke all privileges
on table public.mixto_listo_invoice_intakes
from public, anon, authenticated;

grant select
on table public.mixto_listo_invoice_intakes
to authenticated;

grant all privileges
on table public.mixto_listo_invoice_intakes
to service_role;

-- ============================================================
-- 5. GLOBAL INVOICE PDF AUTHORITY
-- ============================================================

create function app_private.guard_invoice_document_pdf()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if exists (
    select 1
    from public.documents d
    where d.id = new.document_id
      and d.category = 'INVOICE'
  ) and lower(coalesce(new.mime_type, '')) <> 'application/pdf' then
    raise exception 'INVOICE_DOCUMENT_PDF_REQUIRED';
  end if;

  return new;
end;
$$;

alter function app_private.guard_invoice_document_pdf()
owner to postgres;

revoke all
on function app_private.guard_invoice_document_pdf()
from public, anon, authenticated, service_role;

create trigger invoice_document_pdf_guard
before insert or update of document_id, mime_type
on public.document_versions
for each row
execute function app_private.guard_invoice_document_pdf();

create function app_private.guard_mixto_listo_order_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
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

revoke all
on function app_private.guard_mixto_listo_order_assignment()
from public, anon, authenticated, service_role;

create trigger mixto_listo_order_assignment_guard
before insert or update of reconciliation_order_id, invoice_id
on public.reconciliation_order_invoices
for each row
execute function app_private.guard_mixto_listo_order_assignment();

-- ============================================================
-- 6. PDF-ONLY PREPARATION
-- ============================================================

create function public.prepare_mixto_listo_invoice_intake(
  p_reconciliation_order_id uuid,
  p_invoice_type public.invoice_type,
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
  intake_id uuid,
  document_id uuid,
  version_id uuid,
  version_number integer,
  storage_bucket text,
  storage_path text,
  file_name text,
  mime_type text,
  file_size bigint,
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
  v_intake_id uuid := gen_random_uuid();
  v_document_id uuid := gen_random_uuid();
  v_supplier_id uuid;
  v_guide_count integer;
  v_prepared record;
  v_currency text := upper(nullif(btrim(p_currency), ''));
  v_number text := nullif(btrim(p_invoice_number), '');
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
  if v_order.document_status = 'CLOSED' then
    raise exception 'ORDER_DOCUMENTATION_CLOSED';
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
  if lower(coalesce(p_file_name, '')) !~ '\.pdf$' then
    raise exception 'MIXTO_LISTO_INVOICE_PDF_REQUIRED';
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
      and i.supplier_id = v_supplier_id
      and i.invoice_type = p_invoice_type
      and i.status not in ('SUPERSEDED', 'CANCELLED')
  ) then
    raise exception 'REPLACED_INVOICE_CONTEXT_INVALID';
  end if;

  select p.company_id into v_company_id
  from public.projects p
  where p.id = v_order.project_id and p.status = 'ACTIVE';
  if not found then raise exception 'BATCH_PROJECT_INACTIVE'; end if;

  insert into public.documents(id, project_id, category, created_by)
  values (v_document_id, v_order.project_id, 'INVOICE', v_actor);

  insert into public.mixto_listo_invoice_intakes(
    id, project_id, reconciliation_order_id, supplier_id,
    document_id, invoice_type, invoice_number, invoice_date,
    currency, subtotal, total, replaces_invoice_id, created_by
  ) values (
    v_intake_id, v_order.project_id, v_order.id, v_supplier_id,
    v_document_id, p_invoice_type, v_number, p_invoice_date,
    v_currency, p_subtotal, p_total, p_replaces_invoice_id, v_actor
  );

  select prepared.* into v_prepared
  from app_private.prepare_document_upload_version(
    v_document_id,
    v_order.project_id,
    v_actor,
    p_file_name,
    'application/pdf',
    p_file_size
  ) prepared;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_order.project_id,
    'mixto_listo_invoice_intake', v_intake_id,
    'MIXTO_LISTO_INVOICE_UPLOAD_PREPARED',
    jsonb_build_object(
      'reconciliation_order_id', v_order.id,
      'expected_order_number', v_order.normalized_order_number,
      'document_id', v_document_id,
      'version_id', v_prepared.version_id,
      'mime_type', 'application/pdf',
      'replaces_invoice_id', p_replaces_invoice_id
    )
  );

  return query select
    v_intake_id,
    v_prepared.document_id,
    v_prepared.version_id,
    v_prepared.version_number,
    v_prepared.storage_bucket,
    v_prepared.storage_path,
    v_prepared.file_name,
    v_prepared.mime_type,
    v_prepared.file_size,
    v_prepared.upload_expires_at;
end;
$$;

alter function public.prepare_mixto_listo_invoice_intake(
  uuid,public.invoice_type,text,date,text,numeric,numeric,text,bigint,uuid
) owner to postgres;

revoke all on function public.prepare_mixto_listo_invoice_intake(
  uuid,public.invoice_type,text,date,text,numeric,numeric,text,bigint,uuid
) from public, anon;

grant execute on function public.prepare_mixto_listo_invoice_intake(
  uuid,public.invoice_type,text,date,text,numeric,numeric,text,bigint,uuid
) to authenticated, service_role;

-- ============================================================
-- 7. PRIVATE PDF FINALIZATION / FAILURE
-- ============================================================

create function public.finalize_mixto_listo_invoice_upload(
  p_intake_id uuid,
  p_document_id uuid,
  p_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, storage, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_intake public.mixto_listo_invoice_intakes%rowtype;
  v_version public.document_versions%rowtype;
  v_storage_metadata jsonb;
  v_storage_size_text text;
  v_storage_mime_type text;
  v_company_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select intake.* into v_intake
  from public.mixto_listo_invoice_intakes intake
  where intake.id = p_intake_id
    and intake.document_id = p_document_id
  for update;
  if not found then raise exception 'MIXTO_LISTO_INTAKE_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_intake.project_id, 'invoice.create') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_intake.status <> 'UPLOAD_PENDING' then
    raise exception 'MIXTO_LISTO_UPLOAD_NOT_PENDING';
  end if;

  select dv.* into v_version
  from public.document_versions dv
  where dv.id = p_version_id and dv.document_id = p_document_id
  for update;
  if not found then raise exception 'DOCUMENT_VERSION_NOT_FOUND'; end if;
  if v_version.upload_status <> 'PENDING' then
    raise exception 'DOCUMENT_UPLOAD_NOT_PENDING';
  end if;
  if now() > v_version.upload_expires_at then
    raise exception 'DOCUMENT_UPLOAD_EXPIRED';
  end if;
  if lower(v_version.mime_type) <> 'application/pdf' then
    raise exception 'MIXTO_LISTO_INVOICE_PDF_REQUIRED';
  end if;

  select o.metadata into v_storage_metadata
  from storage.objects o
  where o.bucket_id = v_version.storage_bucket
    and o.name = v_version.storage_path;
  if not found then raise exception 'DOCUMENT_STORAGE_OBJECT_MISSING'; end if;

  v_storage_size_text := coalesce(
    v_storage_metadata ->> 'size',
    v_storage_metadata ->> 'contentLength'
  );
  v_storage_mime_type := lower(coalesce(
    v_storage_metadata ->> 'mimetype',
    v_storage_metadata ->> 'contentType',
    ''
  ));
  if coalesce(v_storage_size_text, '') !~ '^[0-9]+$'
     or v_storage_size_text::bigint <> v_version.file_size then
    raise exception 'DOCUMENT_STORAGE_SIZE_MISMATCH';
  end if;
  if v_storage_mime_type <> 'application/pdf' then
    raise exception 'MIXTO_LISTO_INVOICE_PDF_REQUIRED';
  end if;

  update public.document_versions
  set is_current = false
  where document_id = p_document_id and is_current = true;

  update public.document_versions
  set upload_status = 'UPLOADED',
      uploaded_at = now(),
      uploaded_by = v_actor,
      is_current = true,
      failed_at = null,
      failed_by = null,
      failure_reason = null
  where id = p_version_id;

  update public.mixto_listo_invoice_intakes
  set status = 'EXTRACTION_PENDING', updated_at = now()
  where id = v_intake.id;

  select p.company_id into v_company_id
  from public.projects p where p.id = v_intake.project_id;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_intake.project_id,
    'mixto_listo_invoice_intake', v_intake.id,
    'MIXTO_LISTO_INVOICE_PDF_UPLOADED',
    jsonb_build_object(
      'reconciliation_order_id', v_intake.reconciliation_order_id,
      'document_id', p_document_id,
      'version_id', p_version_id,
      'mime_type', v_storage_mime_type,
      'file_size', v_version.file_size
    )
  );

  return p_version_id;
end;
$$;

alter function public.finalize_mixto_listo_invoice_upload(uuid,uuid,uuid)
owner to postgres;

revoke all on function public.finalize_mixto_listo_invoice_upload(uuid,uuid,uuid)
from public, anon;

grant execute on function public.finalize_mixto_listo_invoice_upload(uuid,uuid,uuid)
to authenticated, service_role;

create function public.fail_mixto_listo_invoice_upload(
  p_intake_id uuid,
  p_document_id uuid,
  p_version_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_intake public.mixto_listo_invoice_intakes%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select intake.* into v_intake
  from public.mixto_listo_invoice_intakes intake
  where intake.id = p_intake_id
    and intake.document_id = p_document_id
  for update;
  if not found then raise exception 'MIXTO_LISTO_INTAKE_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_intake.project_id, 'invoice.create') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_reason is null then raise exception 'DOCUMENT_UPLOAD_FAILURE_REASON_REQUIRED'; end if;

  update public.document_versions
  set upload_status = 'FAILED',
      failed_at = now(),
      failed_by = v_actor,
      failure_reason = left(v_reason, 500),
      is_current = false
  where id = p_version_id
    and document_id = p_document_id
    and upload_status = 'PENDING';
  if not found then raise exception 'DOCUMENT_UPLOAD_NOT_PENDING'; end if;

  update public.mixto_listo_invoice_intakes
  set status = 'FAILED', updated_at = now()
  where id = v_intake.id;

  return p_version_id;
end;
$$;

alter function public.fail_mixto_listo_invoice_upload(uuid,uuid,uuid,text)
owner to postgres;

revoke all on function public.fail_mixto_listo_invoice_upload(uuid,uuid,uuid,text)
from public, anon;

grant execute on function public.fail_mixto_listo_invoice_upload(uuid,uuid,uuid,text)
to authenticated, service_role;

-- ============================================================
-- 8. SERVICE-ONLY MIXTO LISTO EXTRACTION REGISTRATION
-- ============================================================

create function public.register_mixto_listo_invoice_extraction(
  p_intake_id uuid,
  p_document_version_id uuid,
  p_extracted_payload jsonb,
  p_provider_key text default 'MIXTO_LISTO'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_intake public.mixto_listo_invoice_intakes%rowtype;
  v_order public.reconciliation_orders%rowtype;
  v_observations text;
  v_pca text;
  v_detected_order text;
  v_lines jsonb;
  v_lines_incomplete boolean;
  v_payload jsonb;
  v_status public.mixto_listo_invoice_intake_status;
  v_job_id uuid;
  v_extraction_id uuid;
begin
  if v_role <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_extracted_payload is null
     or jsonb_typeof(p_extracted_payload) <> 'object' then
    raise exception 'MIXTO_LISTO_EXTRACTION_PAYLOAD_INVALID';
  end if;

  select intake.* into v_intake
  from public.mixto_listo_invoice_intakes intake
  where intake.id = p_intake_id
  for update;
  if not found then raise exception 'MIXTO_LISTO_INTAKE_NOT_FOUND'; end if;
  if v_intake.status <> 'EXTRACTION_PENDING' then
    raise exception 'MIXTO_LISTO_EXTRACTION_NOT_PENDING';
  end if;
  if not exists (
    select 1
    from public.document_versions dv
    where dv.id = p_document_version_id
      and dv.document_id = v_intake.document_id
      and dv.upload_status = 'UPLOADED'
      and dv.is_current = true
      and lower(dv.mime_type) = 'application/pdf'
  ) then
    raise exception 'MIXTO_LISTO_PDF_VERSION_INVALID';
  end if;

  select ro.* into v_order
  from public.reconciliation_orders ro
  where ro.id = v_intake.reconciliation_order_id
    and ro.project_id = v_intake.project_id;
  if not found then raise exception 'RECONCILIATION_ORDER_NOT_FOUND'; end if;

  v_observations := nullif(btrim(p_extracted_payload ->> 'observations_raw'), '');
  v_pca := upper(nullif(btrim(coalesce(
    p_extracted_payload ->> 'pca_original',
    substring(upper(coalesce(v_observations, '')) from 'PCA-[0-9]+-[0-9]+')
  )), ''));
  v_detected_order := app_private.mixto_listo_order_from_pca(v_pca);

  v_lines_incomplete :=
    jsonb_typeof(p_extracted_payload -> 'lines') is distinct from 'array'
    or jsonb_array_length(coalesce(
      case when jsonb_typeof(p_extracted_payload -> 'lines') = 'array'
        then p_extracted_payload -> 'lines' end,
      '[]'::jsonb
    )) = 0;

  if not v_lines_incomplete then
    select exists (
      select 1
      from jsonb_array_elements(p_extracted_payload -> 'lines') line(value)
      where jsonb_typeof(line.value) <> 'object'
         or jsonb_typeof(line.value -> 'quantity') is distinct from 'number'
         or (line.value ->> 'quantity')::numeric <= 0
         or nullif(btrim(line.value ->> 'unit_code'), '') is null
         or nullif(btrim(line.value ->> 'code'), '') is null
         or nullif(btrim(line.value ->> 'description'), '') is null
    ) into v_lines_incomplete;
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'quantity', case
        when jsonb_typeof(line.value -> 'quantity') = 'number'
          and (line.value ->> 'quantity')::numeric > 0
          then (line.value ->> 'quantity')::numeric
        else null
      end,
      'unit_code', case
        when nullif(btrim(line.value ->> 'unit_code'), '') is null then null
        when replace(upper(btrim(line.value ->> 'unit_code')), '³', '3') = 'M3'
          then 'M3'
        else upper(btrim(line.value ->> 'unit_code'))
      end,
      'code', upper(nullif(btrim(line.value ->> 'code'), '')),
      'description', nullif(btrim(line.value ->> 'description'), '')
    )
    order by line.ordinality
  ) into v_lines
  from jsonb_array_elements(coalesce(
    case when jsonb_typeof(p_extracted_payload -> 'lines') = 'array'
      then p_extracted_payload -> 'lines' end,
    '[]'::jsonb
  ))
       with ordinality line(value, ordinality);

  v_lines := coalesce(v_lines, '[]'::jsonb);

  v_payload := jsonb_build_object(
    'observations_raw', v_observations,
    'pca_original', v_pca,
    'detected_order_number', v_detected_order,
    'lines', v_lines
  );

  v_status := case
    when v_detected_order is null then 'NEEDS_CORRECTION'
    when v_detected_order <> v_order.normalized_order_number then 'ORDER_MISMATCH'
    when v_lines_incomplete then 'NEEDS_CORRECTION'
    else 'READY_TO_CONFIRM'
  end;

  insert into public.document_processing_jobs(
    document_version_id, status, provider_key, attempt_count,
    started_at, completed_at
  ) values (
    p_document_version_id,
    'COMPLETED',
    coalesce(nullif(btrim(p_provider_key), ''), 'MIXTO_LISTO'),
    1,
    now(),
    now()
  ) returning id into v_job_id;

  insert into public.ocr_extractions(
    processing_job_id, raw_payload, normalized_payload,
    confidence, verification_status
  ) values (
    v_job_id,
    jsonb_build_object(
      'source', coalesce(nullif(btrim(p_provider_key), ''), 'MIXTO_LISTO')
    ) || p_extracted_payload,
    v_payload,
    null,
    'PENDING'
  ) returning id into v_extraction_id;

  update public.mixto_listo_invoice_intakes
  set observations_raw = v_observations,
      pca_original = v_pca,
      detected_order_number = v_detected_order,
      extraction_id = v_extraction_id,
      status = v_status,
      updated_at = now()
  where id = v_intake.id;

  return v_extraction_id;
end;
$$;

alter function public.register_mixto_listo_invoice_extraction(uuid,uuid,jsonb,text)
owner to postgres;

revoke all on function public.register_mixto_listo_invoice_extraction(uuid,uuid,jsonb,text)
from public, anon, authenticated;

grant execute on function public.register_mixto_listo_invoice_extraction(uuid,uuid,jsonb,text)
to service_role;

-- ============================================================
-- 9. ATOMIC CONFIRMATION / CORRECTION / ORDER ASSOCIATION
-- ============================================================

create function public.confirm_mixto_listo_invoice_intake(
  p_intake_id uuid,
  p_pca_original text,
  p_lines jsonb,
  p_correction_reason_id uuid default null,
  p_correction_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_intake public.mixto_listo_invoice_intakes%rowtype;
  v_order public.reconciliation_orders%rowtype;
  v_batch public.batches%rowtype;
  v_extraction public.ocr_extractions%rowtype;
  v_original_payload jsonb;
  v_final_payload jsonb;
  v_lines jsonb;
  v_pca text := upper(nullif(btrim(p_pca_original), ''));
  v_detected_order text;
  v_modified_fields jsonb := '[]'::jsonb;
  v_changed boolean;
  v_reason_code text;
  v_notes text := nullif(btrim(p_correction_notes), '');
  v_invoice_id uuid := gen_random_uuid();
  v_company_id uuid;
  v_guide_count integer;
  v_supplier_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select intake.* into v_intake
  from public.mixto_listo_invoice_intakes intake
  where intake.id = p_intake_id
  for update;
  if not found then raise exception 'MIXTO_LISTO_INTAKE_NOT_FOUND'; end if;
  if v_intake.status not in (
    'READY_TO_CONFIRM', 'ORDER_MISMATCH', 'NEEDS_CORRECTION'
  ) then
    raise exception 'MIXTO_LISTO_INTAKE_NOT_CONFIRMABLE';
  end if;
  if not app_private.has_project_permission(v_intake.project_id, 'invoice.match') then
    raise exception 'PERMISSION_DENIED';
  end if;

  select ro.* into v_order
  from public.reconciliation_orders ro
  where ro.id = v_intake.reconciliation_order_id
    and ro.project_id = v_intake.project_id
  for update;
  if not found then raise exception 'RECONCILIATION_ORDER_NOT_FOUND'; end if;
  if v_order.document_status = 'CLOSED' then
    raise exception 'ORDER_DOCUMENTATION_CLOSED';
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
  if date_trunc('month', v_intake.invoice_date)::date
     <> v_batch.accounting_period then
    raise exception 'INVOICE_ACCOUNTING_PERIOD_MISMATCH';
  end if;

  select oe.* into v_extraction
  from public.ocr_extractions oe
  where oe.id = v_intake.extraction_id
  for update;
  if not found then raise exception 'EXTRACTION_NOT_FOUND'; end if;
  if v_extraction.verification_status <> 'PENDING' then
    raise exception 'EXTRACTION_ALREADY_VERIFIED';
  end if;
  if not exists (
    select 1
    from public.document_processing_jobs dpj
    join public.document_versions dv
      on dv.id = dpj.document_version_id
    where dpj.id = v_extraction.processing_job_id
      and dv.document_id = v_intake.document_id
      and dv.upload_status = 'UPLOADED'
      and dv.is_current = true
      and lower(dv.mime_type) = 'application/pdf'
  ) then
    raise exception 'MIXTO_LISTO_PDF_VERSION_INVALID';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'MIXTO_LISTO_EXTRACTION_LINES_REQUIRED';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) line(value)
    where jsonb_typeof(line.value) <> 'object'
       or jsonb_typeof(line.value -> 'quantity') is distinct from 'number'
       or (line.value ->> 'quantity')::numeric <= 0
       or nullif(btrim(line.value ->> 'unit_code'), '') is null
       or nullif(btrim(line.value ->> 'code'), '') is null
       or nullif(btrim(line.value ->> 'description'), '') is null
  ) then
    raise exception 'MIXTO_LISTO_EXTRACTION_LINE_INVALID';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'quantity', (line.value ->> 'quantity')::numeric,
      'unit_code', case
        when replace(upper(btrim(line.value ->> 'unit_code')), '³', '3') = 'M3'
          then 'M3'
        else upper(btrim(line.value ->> 'unit_code'))
      end,
      'code', upper(btrim(line.value ->> 'code')),
      'description', btrim(line.value ->> 'description')
    )
    order by line.ordinality
  ) into v_lines
  from jsonb_array_elements(p_lines)
       with ordinality line(value, ordinality);

  v_detected_order := app_private.mixto_listo_order_from_pca(v_pca);
  v_original_payload := v_extraction.normalized_payload;
  v_final_payload := jsonb_build_object(
    'observations_raw', v_original_payload -> 'observations_raw',
    'pca_original', v_pca,
    'detected_order_number', v_detected_order,
    'lines', v_lines
  );

  if (v_original_payload -> 'pca_original') is distinct from
     coalesce(to_jsonb(v_pca), 'null'::jsonb) then
    v_modified_fields := v_modified_fields || '"pca_original"'::jsonb;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_original_payload -> 'lines', '[]'::jsonb))
         with ordinality original_line(value, ordinality)
    full join jsonb_array_elements(v_lines)
         with ordinality final_line(value, ordinality)
      on final_line.ordinality = original_line.ordinality
    where original_line.value -> 'quantity'
          is distinct from final_line.value -> 'quantity'
  ) then
    v_modified_fields := v_modified_fields || '"quantity"'::jsonb;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_original_payload -> 'lines', '[]'::jsonb))
         with ordinality original_line(value, ordinality)
    full join jsonb_array_elements(v_lines)
         with ordinality final_line(value, ordinality)
      on final_line.ordinality = original_line.ordinality
    where original_line.value -> 'unit_code'
          is distinct from final_line.value -> 'unit_code'
  ) then
    v_modified_fields := v_modified_fields || '"unit_code"'::jsonb;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_original_payload -> 'lines', '[]'::jsonb))
         with ordinality original_line(value, ordinality)
    full join jsonb_array_elements(v_lines)
         with ordinality final_line(value, ordinality)
      on final_line.ordinality = original_line.ordinality
    where original_line.value -> 'code'
          is distinct from final_line.value -> 'code'
  ) then
    v_modified_fields := v_modified_fields || '"code"'::jsonb;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_original_payload -> 'lines', '[]'::jsonb))
         with ordinality original_line(value, ordinality)
    full join jsonb_array_elements(v_lines)
         with ordinality final_line(value, ordinality)
      on final_line.ordinality = original_line.ordinality
    where original_line.value -> 'description'
          is distinct from final_line.value -> 'description'
  ) then
    v_modified_fields := v_modified_fields || '"description"'::jsonb;
  end if;

  v_changed := jsonb_array_length(v_modified_fields) > 0;

  if v_changed then
    if p_correction_reason_id is null then
      raise exception 'EXTRACTION_CORRECTION_REASON_REQUIRED';
    end if;
    select ecr.code into v_reason_code
    from public.extraction_correction_reasons ecr
    where ecr.id = p_correction_reason_id and ecr.active = true;
    if not found then raise exception 'EXTRACTION_CORRECTION_REASON_INVALID'; end if;
    if v_reason_code = 'OTHER' and v_notes is null then
      raise exception 'EXTRACTION_CORRECTION_COMMENT_REQUIRED';
    end if;
    if v_modified_fields ? 'pca_original'
       and v_reason_code not in (
         'PCA_DETECTION_INCORRECT', 'FIELD_NOT_DETECTED'
       ) then
      raise exception 'MIXTO_LISTO_PCA_CORRECTION_REASON_REQUIRED';
    end if;
  elsif p_correction_reason_id is not null or v_notes is not null then
    raise exception 'EXTRACTION_CONFIRMATION_REASON_NOT_ALLOWED';
  end if;

  if v_detected_order is null then
    raise exception 'MIXTO_LISTO_PCA_ORDER_NOT_DETECTED';
  end if;
  if v_detected_order <> v_order.normalized_order_number then
    raise exception 'MIXTO_LISTO_ORDER_MISMATCH: detected %, expected %',
      v_detected_order,
      v_order.normalized_order_number;
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
  if v_supplier_id is null or v_supplier_id <> v_intake.supplier_id then
    raise exception 'ORDER_SUPPLIER_REQUIRES_REVIEW';
  end if;

  if v_intake.replaces_invoice_id is not null and not exists (
    select 1
    from public.reconciliation_order_invoices roi
    join public.invoices i on i.id = roi.invoice_id
    where roi.reconciliation_order_id = v_order.id
      and i.id = v_intake.replaces_invoice_id
      and i.supplier_id = v_supplier_id
      and i.invoice_type = v_intake.invoice_type
      and i.status not in ('SUPERSEDED', 'CANCELLED')
  ) then
    raise exception 'REPLACED_INVOICE_CONTEXT_INVALID';
  end if;

  insert into public.invoices(
    id, project_id, supplier_id, invoice_type, invoice_number,
    invoice_date, subtotal, total, currency, status,
    replaces_invoice_id, order_number, pca_original, created_by
  ) values (
    v_invoice_id,
    v_intake.project_id,
    v_supplier_id,
    v_intake.invoice_type,
    v_intake.invoice_number,
    v_intake.invoice_date,
    v_intake.subtotal,
    v_intake.total,
    v_intake.currency,
    'REGISTERED',
    v_intake.replaces_invoice_id,
    v_order.normalized_order_number,
    v_pca,
    v_actor
  );

  insert into public.invoice_lines(
    invoice_id, line_number, code, description, quantity, unit_code
  )
  select
    v_invoice_id,
    line.ordinality::integer,
    line.value ->> 'code',
    line.value ->> 'description',
    (line.value ->> 'quantity')::numeric,
    line.value ->> 'unit_code'
  from jsonb_array_elements(v_lines)
       with ordinality line(value, ordinality);

  insert into public.reconciliation_order_invoices(
    project_id, reconciliation_order_id, invoice_id,
    assigned_by, assignment_source
  ) values (
    v_intake.project_id, v_order.id, v_invoice_id, v_actor, 'USER'
  );

  insert into public.guide_invoices(
    project_id, supplier_id, guide_id, invoice_id, linked_by
  )
  select
    v_intake.project_id,
    v_supplier_id,
    dg.id,
    v_invoice_id,
    v_actor
  from public.batch_guides bg
  join public.dispatch_guides dg
    on dg.id = bg.guide_id and dg.project_id = bg.project_id
  where bg.batch_id = v_order.batch_id
    and bg.project_id = v_order.project_id
    and bg.removed_at is null
    and app_private.normalize_reconciliation_order_number(dg.order_number)
        = v_order.normalized_order_number;

  insert into public.invoice_documents(
    project_id, invoice_id, document_id, purpose
  ) values (
    v_intake.project_id, v_invoice_id, v_intake.document_id, 'INVOICE'
  );

  update public.ocr_extractions
  set verification_status = case when v_changed then 'CORRECTED' else 'CONFIRMED' end,
      confirmed_by = v_actor,
      confirmed_at = now(),
      corrected_payload = case when v_changed
        then v_final_payload || jsonb_build_object(
          'modified_fields', v_modified_fields
        ) end,
      correction_reason_id = case when v_changed
        then p_correction_reason_id end,
      correction_notes = case when v_changed then v_notes end
  where id = v_extraction.id;

  -- The status transition activates the existing replacement trigger only
  -- after the new Invoice has all lines, Order links and verified extraction.
  update public.invoices
  set status = 'UNDER_REVIEW', updated_at = now()
  where id = v_invoice_id;

  update public.mixto_listo_invoice_intakes
  set status = 'CONFIRMED',
      pca_original = v_pca,
      detected_order_number = v_detected_order,
      confirmed_invoice_id = v_invoice_id,
      confirmed_at = now(),
      updated_at = now()
  where id = v_intake.id;

  select p.company_id into v_company_id
  from public.projects p where p.id = v_intake.project_id;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values, comment
  ) values (
    v_actor,
    v_company_id,
    v_intake.project_id,
    'invoice',
    v_invoice_id,
    case when v_changed
      then 'MIXTO_LISTO_INVOICE_EXTRACTION_CORRECTED'
      else 'MIXTO_LISTO_INVOICE_EXTRACTION_CONFIRMED' end,
    jsonb_build_object(
      'intake_id', v_intake.id,
      'extraction_id', v_extraction.id,
      'reconciliation_order_id', v_order.id,
      'pca_original', v_pca,
      'detected_order_number', v_detected_order,
      'correction_reason_id', case when v_changed
        then p_correction_reason_id end,
      'modified_fields', v_modified_fields,
      'replaces_invoice_id', v_intake.replaces_invoice_id
    ),
    v_notes
  );

  perform app_private.recalculate_reconciliation_order(v_order.id);

  return v_invoice_id;
end;
$$;

alter function public.confirm_mixto_listo_invoice_intake(
  uuid,text,jsonb,uuid,text
) owner to postgres;

revoke all on function public.confirm_mixto_listo_invoice_intake(
  uuid,text,jsonb,uuid,text
) from public, anon;

grant execute on function public.confirm_mixto_listo_invoice_intake(
  uuid,text,jsonb,uuid,text
) to authenticated, service_role;

-- ============================================================
-- 10. FINAL ASSERTIONS
-- ============================================================

do $$
declare
  v_definition text;
begin
  if app_private.mixto_listo_order_from_pca('PCA-14082026-0047') <> '47'
     or app_private.mixto_listo_order_from_pca('pca-14082026-0000') <> '0'
     or app_private.mixto_listo_order_from_pca('0047') is not null then
    raise exception 'MIXTO_LISTO_PCA_NORMALIZATION_INVALID';
  end if;

  if exists (
    select 1
    from (
      values
        ('QUANTITY_DETECTION_INCORRECT'),
        ('UNIT_DETECTION_INCORRECT'),
        ('PRODUCT_CODE_DETECTION_INCORRECT'),
        ('DESCRIPTION_DETECTION_INCORRECT'),
        ('PCA_DETECTION_INCORRECT'),
        ('FIELD_NOT_DETECTED'),
        ('OTHER')
    ) expected(code)
    where not exists (
      select 1
      from public.extraction_correction_reasons ecr
      where ecr.code = expected.code and ecr.active = true
    )
  ) then
    raise exception 'MIXTO_LISTO_CORRECTION_REASON_MISSING';
  end if;

  if has_table_privilege(
       'authenticated', 'public.mixto_listo_invoice_intakes', 'INSERT'
     )
     or has_table_privilege(
       'authenticated', 'public.mixto_listo_invoice_intakes', 'UPDATE'
     )
     or has_function_privilege(
       'anon',
       'public.prepare_mixto_listo_invoice_intake(uuid,public.invoice_type,text,date,text,numeric,numeric,text,bigint,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.register_mixto_listo_invoice_extraction(uuid,uuid,jsonb,text)',
       'EXECUTE'
     ) then
    raise exception 'MIXTO_LISTO_INTAKE_SECURITY_NOT_ALIGNED';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'document_versions'
      and t.tgname = 'invoice_document_pdf_guard'
      and t.tgenabled <> 'D'
      and not t.tgisinternal
  ) then
    raise exception 'MIXTO_LISTO_INVOICE_PDF_GUARD_MISSING';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'reconciliation_order_invoices'
      and t.tgname = 'mixto_listo_order_assignment_guard'
      and t.tgenabled <> 'D'
      and not t.tgisinternal
  ) then
    raise exception 'MIXTO_LISTO_ORDER_ASSIGNMENT_GUARD_MISSING';
  end if;

  select pg_get_functiondef(
    'public.confirm_mixto_listo_invoice_intake(uuid,text,jsonb,uuid,text)'::regprocedure
  ) into v_definition;

  if position('MIXTO_LISTO_ORDER_MISMATCH' in v_definition) = 0
     or position('mixto_listo_order_from_pca' in v_definition) = 0
     or position('reconciliation_order_invoices' in v_definition) = 0
     or position('recalculate_reconciliation_order' in v_definition) = 0
     or position('product_code' in v_definition) > 0 then
    raise exception 'MIXTO_LISTO_CONFIRMATION_CONTRACT_NOT_ALIGNED';
  end if;
end;
$$;

-- Live QA after manual execution:
--   * intake accepts application/pdf only and rejects image MIME/content;
--   * PCA-14082026-0047 derives 47; detected Order is never client supplied;
--   * matching PCA enables confirmation; mismatch creates no Invoice/link;
--   * missing or invalid PCA remains correctable but never confirmable;
--   * correction requires an active reason; OTHER requires a comment;
--   * PCA changes require PCA_DETECTION_INCORRECT or FIELD_NOT_DETECTED;
--   * original normalized payload remains immutable; corrected payload records
--     final values plus modified_fields and actor/timestamp on the extraction;
--   * canonical lines contain quantity, unit_code, code and description only;
--   * multiple lines normalize m3/M3/M³ to M3 and preserve Description apart
--     from the value in the invoice Código column;
--   * confirmation atomically creates Invoice, lines, Order/Guide links,
--     document association and recalculates the Order;
--   * replacement preserves history and excludes the superseded predecessor;
--   * RBAC, RLS, private download and reversible QA cleanup remain aligned.

commit;
