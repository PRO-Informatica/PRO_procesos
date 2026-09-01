-- 062_invoice_intake_reconciliation.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Operational Phase 9, Migration A.
-- Adds canonical private invoice intake, 1..N Guide association, extraction
-- confirmation/correction and aggregate PRODUCT reconciliation.

begin;

do $$
begin
  if to_regclass('public.invoices') is null
     or to_regclass('public.invoice_lines') is null
     or to_regclass('public.guide_invoices') is null
     or to_regclass('public.invoice_documents') is null
     or to_regclass('public.ocr_extractions') is null
     or to_regclass('public.document_processing_jobs') is null
     or to_regclass('public.extraction_correction_reasons') is null then
    raise exception 'PHASE9_REQUIRED_RELATION_MISSING';
  end if;

  if to_regprocedure(
    'app_private.prepare_document_upload_version(uuid,uuid,uuid,text,text,bigint)'
  ) is null
     or to_regprocedure('app_private.can_read_document(uuid)') is null
     or to_regprocedure(
       'app_private.resolve_dispatch_document_mutation(uuid)'
     ) is null
     or to_regprocedure('public.finalize_document_upload(uuid,uuid)') is null
     or to_regprocedure('public.fail_document_upload(uuid,uuid,text)') is null then
    raise exception 'PHASE9_DOCUMENT_CONTRACT_MISSING';
  end if;

  if to_regprocedure(
    'public.prepare_batch_invoice_upload(uuid,public.invoice_type,text,date,text,numeric,numeric,uuid[],jsonb,text,text,bigint,uuid)'
  ) is not null
     or to_regprocedure(
       'public.register_invoice_extraction_proposal(uuid,uuid,jsonb,text)'
     ) is not null
     or to_regprocedure(
       'public.confirm_invoice_extraction(uuid,text,date,text,numeric,numeric,jsonb,uuid,text)'
     ) is not null
     or to_regprocedure(
       'public.reconcile_batch_invoice(uuid,uuid)'
     ) is not null then
    raise exception 'PHASE9_CANONICAL_RPC_ALREADY_EXISTS';
  end if;
end;
$$;

-- Invoice documents participate in the same relation-aware private document
-- authorization used by Guide and Incident documents.
create or replace function app_private.can_read_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select
    app_private.is_platform_admin()
    or exists (
      select 1
      from public.documents d
      where d.id = p_document_id
        and (
          exists (
            select 1 from public.guide_documents gd
            where gd.document_id = d.id
              and gd.project_id = d.project_id
              and app_private.has_project_permission(gd.project_id, 'dispatch.view')
          )
          or exists (
            select 1 from public.incident_documents idoc
            where idoc.document_id = d.id
              and idoc.project_id = d.project_id
              and app_private.has_project_permission(idoc.project_id, 'dispatch.view')
          )
          or exists (
            select 1 from public.invoice_documents invdoc
            where invdoc.document_id = d.id
              and invdoc.project_id = d.project_id
              and app_private.has_project_permission(invdoc.project_id, 'invoice.view')
          )
          or (
            not exists (select 1 from public.guide_documents gd where gd.document_id = d.id)
            and not exists (select 1 from public.incident_documents idoc where idoc.document_id = d.id)
            and not exists (select 1 from public.invoice_documents invdoc where invdoc.document_id = d.id)
            and (
              app_private.is_project_member(d.project_id)
              or app_private.has_project_permission(d.project_id, 'document.view')
            )
          )
        )
    );
$$;

alter function app_private.can_read_document(uuid) owner to postgres;
revoke all on function app_private.can_read_document(uuid) from public, anon;
grant execute on function app_private.can_read_document(uuid) to authenticated, service_role;

-- Extend finalization/failure context resolution without changing the public
-- upload lifecycle signatures already used by Dispatch documents.
create or replace function app_private.resolve_dispatch_document_mutation(
  p_document_id uuid
)
returns table(project_id uuid, company_id uuid, context_type text, context_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_count integer;
  v_project_id uuid;
  v_company_id uuid;
  v_context_type text;
  v_context_id uuid;
begin
  select count(*)::integer,
         (array_agg(ctx.project_id))[1],
         (array_agg(ctx.context_type))[1],
         (array_agg(ctx.context_id))[1]
  into v_count, v_project_id, v_context_type, v_context_id
  from (
    select gd.project_id, 'GUIDE'::text context_type, gd.guide_id context_id
    from public.guide_documents gd where gd.document_id = p_document_id
    union all
    select idoc.project_id, 'INCIDENT'::text, idoc.incident_id
    from public.incident_documents idoc where idoc.document_id = p_document_id
    union all
    select invdoc.project_id, 'INVOICE'::text, invdoc.invoice_id
    from public.invoice_documents invdoc where invdoc.document_id = p_document_id
  ) ctx;

  if v_count <> 1 then
    raise exception 'DOCUMENT_CONTEXT_INVALID';
  end if;

  select p.company_id into v_company_id
  from public.projects p where p.id = v_project_id;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;

  if v_context_type = 'GUIDE'
     and not app_private.has_project_permission(v_project_id, 'dispatch.modify') then
    raise exception 'GUIDE_DOCUMENT_PERMISSION_DENIED';
  elsif v_context_type = 'INCIDENT'
     and not app_private.has_project_permission(v_project_id, 'dispatch.register_incident') then
    raise exception 'INCIDENT_DOCUMENT_PERMISSION_DENIED';
  elsif v_context_type = 'INVOICE'
     and not app_private.has_project_permission(v_project_id, 'invoice.create') then
    raise exception 'INVOICE_DOCUMENT_PERMISSION_DENIED';
  end if;

  return query select v_project_id, v_company_id, v_context_type, v_context_id;
end;
$$;

alter function app_private.resolve_dispatch_document_mutation(uuid) owner to postgres;
revoke all on function app_private.resolve_dispatch_document_mutation(uuid)
from public, anon, authenticated;

create function public.prepare_batch_invoice_upload(
  p_batch_id uuid,
  p_invoice_type public.invoice_type,
  p_invoice_number text,
  p_invoice_date date,
  p_currency text,
  p_subtotal numeric,
  p_total numeric,
  p_guide_ids uuid[],
  p_lines jsonb,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_replaces_invoice_id uuid default null
)
returns table(
  invoice_id uuid,
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
  v_batch public.batches%rowtype;
  v_company_id uuid;
  v_supplier_id uuid;
  v_invoice_id uuid := gen_random_uuid();
  v_document_id uuid := gen_random_uuid();
  v_currency text := upper(nullif(btrim(p_currency), ''));
  v_invoice_number text := nullif(btrim(p_invoice_number), '');
  v_guide_count integer;
  v_prepared record;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select b.* into v_batch from public.batches b
  where b.id = p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;

  if not app_private.has_project_permission(v_batch.project_id, 'invoice.create') then
    raise exception 'PERMISSION_DENIED';
  end if;

  if v_batch.status not in (
    'DRAFT', 'ASSEMBLING', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'NEEDS_CORRECTION', 'VALIDATED'
  ) then
    raise exception 'BATCH_INVOICE_NOT_EDITABLE';
  end if;

  if v_invoice_number is null or char_length(v_invoice_number) > 120 then
    raise exception 'INVOICE_NUMBER_INVALID';
  end if;
  if p_invoice_date is null
     or date_trunc('month', p_invoice_date)::date <> v_batch.accounting_period then
    raise exception 'INVOICE_ACCOUNTING_PERIOD_MISMATCH';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'INVOICE_CURRENCY_INVALID';
  end if;
  if p_total is null or p_total <= 0
     or p_subtotal is null or p_subtotal < 0 or p_subtotal > p_total then
    raise exception 'INVOICE_TOTALS_INVALID';
  end if;
  if p_guide_ids is null or cardinality(p_guide_ids) = 0
     or array_position(p_guide_ids, null) is not null then
    raise exception 'INVOICE_GUIDES_REQUIRED';
  end if;
  if (select count(distinct value) from unnest(p_guide_ids) value)
     <> cardinality(p_guide_ids) then
    raise exception 'INVOICE_GUIDES_DUPLICATED';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVOICE_LINES_REQUIRED';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) line(value)
    where jsonb_typeof(line.value) <> 'object'
       or nullif(btrim(line.value ->> 'description'), '') is null
       or jsonb_typeof(line.value -> 'quantity') is distinct from 'number'
       or (line.value ->> 'quantity')::numeric <= 0
  ) then
    raise exception 'INVOICE_LINE_INVALID';
  end if;

  select count(*)::integer, (array_agg(dg.supplier_id))[1]
  into v_guide_count, v_supplier_id
  from public.batch_guides bg
  join public.dispatch_guides dg
    on dg.id = bg.guide_id and dg.project_id = bg.project_id
  where bg.batch_id = v_batch.id
    and bg.project_id = v_batch.project_id
    and bg.removed_at is null
    and bg.guide_id = any(p_guide_ids);

  if v_guide_count <> cardinality(p_guide_ids)
     or (select count(distinct dg.supplier_id)
         from public.dispatch_guides dg where dg.id = any(p_guide_ids)) <> 1 then
    raise exception 'INVOICE_GUIDE_BATCH_CONTEXT_INVALID';
  end if;

  select p.company_id into v_company_id from public.projects p
  where p.id = v_batch.project_id and p.status = 'ACTIVE';
  if not found then raise exception 'BATCH_PROJECT_INACTIVE'; end if;

  if p_replaces_invoice_id is not null and not exists (
    select 1 from public.invoices i
    where i.id = p_replaces_invoice_id
      and i.project_id = v_batch.project_id
      and i.supplier_id = v_supplier_id
      and i.invoice_type = p_invoice_type
      and i.status not in ('SUPERSEDED', 'CANCELLED')
  ) then
    raise exception 'REPLACED_INVOICE_CONTEXT_INVALID';
  end if;

  insert into public.invoices(
    id, project_id, supplier_id, invoice_type, invoice_number,
    invoice_date, subtotal, total, currency, status,
    replaces_invoice_id, created_by
  ) values (
    v_invoice_id, v_batch.project_id, v_supplier_id, p_invoice_type,
    v_invoice_number, p_invoice_date, p_subtotal, p_total, v_currency,
    'REGISTERED', p_replaces_invoice_id, v_actor
  );

  insert into public.invoice_lines(
    invoice_id, line_number, code, description, quantity,
    unit_code, unit_price, line_total
  )
  select v_invoice_id, line.ordinality::integer,
         nullif(btrim(line.value ->> 'code'), ''),
         btrim(line.value ->> 'description'),
         (line.value ->> 'quantity')::numeric,
         nullif(btrim(line.value ->> 'unit_code'), ''),
         case when jsonb_typeof(line.value -> 'unit_price') = 'number'
              then (line.value ->> 'unit_price')::numeric end,
         case when jsonb_typeof(line.value -> 'line_total') = 'number'
              then (line.value ->> 'line_total')::numeric end
  from jsonb_array_elements(p_lines) with ordinality line(value, ordinality);

  insert into public.guide_invoices(
    project_id, supplier_id, guide_id, invoice_id, linked_by
  )
  select v_batch.project_id, v_supplier_id, guide_id, v_invoice_id, v_actor
  from unnest(p_guide_ids) guide_id;

  insert into public.documents(id, project_id, category, created_by)
  values(v_document_id, v_batch.project_id, 'INVOICE', v_actor);
  insert into public.invoice_documents(project_id, invoice_id, document_id, purpose)
  values(v_batch.project_id, v_invoice_id, v_document_id, 'INVOICE');

  select prepared.* into v_prepared
  from app_private.prepare_document_upload_version(
    v_document_id, v_batch.project_id, v_actor,
    p_file_name, p_mime_type, p_file_size
  ) prepared;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_batch.project_id, 'invoice', v_invoice_id,
    'INVOICE_UPLOAD_PREPARED',
    jsonb_build_object(
      'batch_id', v_batch.id,
      'invoice_type', p_invoice_type,
      'guide_count', cardinality(p_guide_ids),
      'document_id', v_document_id,
      'version_id', v_prepared.version_id,
      'replaces_invoice_id', p_replaces_invoice_id
    )
  );

  return query select v_invoice_id, v_prepared.document_id,
    v_prepared.version_id, v_prepared.version_number,
    v_prepared.storage_bucket, v_prepared.storage_path,
    v_prepared.file_name, v_prepared.mime_type,
    v_prepared.file_size, v_prepared.upload_expires_at;
end;
$$;

alter function public.prepare_batch_invoice_upload(
  uuid,public.invoice_type,text,date,text,numeric,numeric,uuid[],jsonb,text,text,bigint,uuid
) owner to postgres;
revoke all on function public.prepare_batch_invoice_upload(
  uuid,public.invoice_type,text,date,text,numeric,numeric,uuid[],jsonb,text,text,bigint,uuid
) from public, anon;
grant execute on function public.prepare_batch_invoice_upload(
  uuid,public.invoice_type,text,date,text,numeric,numeric,uuid[],jsonb,text,text,bigint,uuid
) to authenticated, service_role;

-- This service-only adapter records a provider proposal in the existing OCR
-- model. Until an external OCR provider is configured, the server may submit
-- the intake metadata as a MANUAL_ASSISTED proposal; it is still PENDING and
-- never approves an invoice automatically.
create function public.register_invoice_extraction_proposal(
  p_invoice_id uuid,
  p_document_version_id uuid,
  p_normalized_payload jsonb,
  p_provider_key text default 'MANUAL_ASSISTED'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_job_id uuid;
  v_extraction_id uuid;
begin
  if v_role <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_normalized_payload is null or jsonb_typeof(p_normalized_payload) <> 'object' then
    raise exception 'EXTRACTION_PAYLOAD_INVALID';
  end if;
  if not exists (
    select 1
    from public.invoice_documents idoc
    join public.document_versions dv on dv.document_id = idoc.document_id
    where idoc.invoice_id = p_invoice_id
      and dv.id = p_document_version_id
      and dv.upload_status = 'UPLOADED'
      and dv.is_current = true
  ) then
    raise exception 'INVOICE_DOCUMENT_VERSION_INVALID';
  end if;

  insert into public.document_processing_jobs(
    document_version_id, status, provider_key, attempt_count,
    started_at, completed_at
  ) values (
    p_document_version_id, 'COMPLETED',
    coalesce(nullif(btrim(p_provider_key), ''), 'MANUAL_ASSISTED'),
    1, now(), now()
  ) returning id into v_job_id;

  insert into public.ocr_extractions(
    processing_job_id, raw_payload, normalized_payload,
    confidence, verification_status
  ) values (
    v_job_id,
    jsonb_build_object('source', coalesce(nullif(btrim(p_provider_key), ''), 'MANUAL_ASSISTED'))
      || p_normalized_payload,
    p_normalized_payload,
    case when upper(coalesce(p_provider_key, '')) = 'MANUAL_ASSISTED' then null else 0 end,
    'PENDING'
  ) returning id into v_extraction_id;

  return v_extraction_id;
end;
$$;

alter function public.register_invoice_extraction_proposal(uuid,uuid,jsonb,text)
owner to postgres;
revoke all on function public.register_invoice_extraction_proposal(uuid,uuid,jsonb,text)
from public, anon, authenticated;
grant execute on function public.register_invoice_extraction_proposal(uuid,uuid,jsonb,text)
to service_role;

create function public.confirm_invoice_extraction(
  p_extraction_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_currency text,
  p_subtotal numeric,
  p_total numeric,
  p_lines jsonb,
  p_correction_reason_id uuid default null,
  p_correction_notes text default null
)
returns public.extraction_verification_status
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_extraction public.ocr_extractions%rowtype;
  v_invoice public.invoices%rowtype;
  v_batch public.batches%rowtype;
  v_payload jsonb;
  v_status public.extraction_verification_status;
  v_notes text := nullif(btrim(p_correction_notes), '');
  v_company_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select oe.* into v_extraction
  from public.ocr_extractions oe where oe.id = p_extraction_id for update;
  if not found then raise exception 'EXTRACTION_NOT_FOUND'; end if;
  if v_extraction.verification_status <> 'PENDING' then
    raise exception 'EXTRACTION_ALREADY_VERIFIED';
  end if;

  select i.* into v_invoice
  from public.document_processing_jobs dpj
  join public.document_versions dv on dv.id = dpj.document_version_id
  join public.invoice_documents idoc on idoc.document_id = dv.document_id
  join public.invoices i on i.id = idoc.invoice_id
  where dpj.id = v_extraction.processing_job_id
  for update of i;
  if not found then raise exception 'EXTRACTION_INVOICE_CONTEXT_INVALID'; end if;

  if not app_private.has_project_permission(v_invoice.project_id, 'invoice.match') then
    raise exception 'PERMISSION_DENIED';
  end if;

  if (
    select count(distinct bg.batch_id)
    from public.guide_invoices gi
    join public.batch_guides bg
      on bg.guide_id = gi.guide_id
     and bg.project_id = gi.project_id
     and bg.removed_at is null
    where gi.invoice_id = v_invoice.id
  ) <> 1 then
    raise exception 'INVOICE_ACTIVE_BATCH_CONTEXT_INVALID';
  end if;

  select b.* into v_batch
  from public.batches b
  where b.id = (
    select min(bg.batch_id::text)::uuid
    from public.guide_invoices gi
    join public.batch_guides bg
      on bg.guide_id = gi.guide_id
     and bg.project_id = gi.project_id
     and bg.removed_at is null
    where gi.invoice_id = v_invoice.id
  );

  if p_invoice_date is null
     or date_trunc('month', p_invoice_date)::date <> v_batch.accounting_period then
    raise exception 'INVOICE_ACCOUNTING_PERIOD_MISMATCH';
  end if;
  if nullif(btrim(p_invoice_number), '') is null
     or upper(nullif(btrim(p_currency), '')) !~ '^[A-Z]{3}$'
     or p_subtotal is null or p_subtotal < 0
     or p_total is null or p_total <= 0 or p_subtotal > p_total then
    raise exception 'INVOICE_EXTRACTION_FIELDS_INVALID';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVOICE_LINES_REQUIRED';
  end if;

  v_payload := jsonb_build_object(
    'invoice_number', btrim(p_invoice_number),
    'invoice_date', p_invoice_date,
    'currency', upper(btrim(p_currency)),
    'subtotal', p_subtotal,
    'total', p_total,
    'invoice_type', v_invoice.invoice_type,
    'lines', p_lines
  );
  v_status := case
    when v_payload = v_extraction.normalized_payload then 'CONFIRMED'
    else 'CORRECTED'
  end;

  if v_status = 'CORRECTED' then
    if p_correction_reason_id is null or v_notes is null then
      raise exception 'EXTRACTION_CORRECTION_REASON_REQUIRED';
    end if;
    if not exists (
      select 1 from public.extraction_correction_reasons ecr
      where ecr.id = p_correction_reason_id and ecr.active = true
    ) then
      raise exception 'EXTRACTION_CORRECTION_REASON_INVALID';
    end if;
  elsif p_correction_reason_id is not null or v_notes is not null then
    raise exception 'EXTRACTION_CONFIRMATION_REASON_NOT_ALLOWED';
  end if;

  update public.ocr_extractions
  set verification_status = v_status,
      confirmed_by = v_actor,
      confirmed_at = now(),
      corrected_payload = case when v_status = 'CORRECTED' then v_payload end,
      correction_reason_id = case when v_status = 'CORRECTED' then p_correction_reason_id end,
      correction_notes = case when v_status = 'CORRECTED' then v_notes end
  where id = v_extraction.id;

  update public.invoices
  set invoice_number = btrim(p_invoice_number),
      invoice_date = p_invoice_date,
      currency = upper(btrim(p_currency)),
      subtotal = p_subtotal,
      total = p_total,
      status = 'UNDER_REVIEW',
      updated_at = now()
  where id = v_invoice.id;

  delete from public.invoice_lines where invoice_id = v_invoice.id;
  insert into public.invoice_lines(
    invoice_id, line_number, code, description, quantity,
    unit_code, unit_price, line_total
  )
  select v_invoice.id, line.ordinality::integer,
         nullif(btrim(line.value ->> 'code'), ''),
         btrim(line.value ->> 'description'),
         (line.value ->> 'quantity')::numeric,
         nullif(btrim(line.value ->> 'unit_code'), ''),
         case when jsonb_typeof(line.value -> 'unit_price') = 'number'
              then (line.value ->> 'unit_price')::numeric end,
         case when jsonb_typeof(line.value -> 'line_total') = 'number'
              then (line.value ->> 'line_total')::numeric end
  from jsonb_array_elements(p_lines) with ordinality line(value, ordinality);

  select p.company_id into v_company_id
  from public.projects p where p.id = v_invoice.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values, comment
  ) values (
    v_actor, v_company_id, v_invoice.project_id, 'invoice', v_invoice.id,
    case when v_status = 'CONFIRMED'
      then 'INVOICE_EXTRACTION_CONFIRMED'
      else 'INVOICE_EXTRACTION_CORRECTED' end,
    jsonb_build_object(
      'extraction_id', v_extraction.id,
      'batch_id', v_batch.id,
      'verification_status', v_status,
      'correction_reason_id', p_correction_reason_id
    ),
    v_notes
  );

  return v_status;
end;
$$;

alter function public.confirm_invoice_extraction(
  uuid,text,date,text,numeric,numeric,jsonb,uuid,text
) owner to postgres;
revoke all on function public.confirm_invoice_extraction(
  uuid,text,date,text,numeric,numeric,jsonb,uuid,text
) from public, anon;
grant execute on function public.confirm_invoice_extraction(
  uuid,text,date,text,numeric,numeric,jsonb,uuid,text
) to authenticated, service_role;

create function public.reconcile_batch_invoice(
  p_batch_id uuid,
  p_invoice_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.batches%rowtype;
  v_invoice public.invoices%rowtype;
  v_company_id uuid;
  v_guide_count integer;
  v_guide_quantity numeric;
  v_invoice_quantity numeric;
  v_guide_unit_count integer;
  v_invoice_unit_count integer;
  v_guide_unit text;
  v_invoice_unit text;
  v_difference numeric;
  v_match boolean;
  v_new_status public.invoice_status;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select b.* into v_batch from public.batches b
  where b.id = p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_batch.project_id, 'invoice.match') then
    raise exception 'PERMISSION_DENIED';
  end if;

  select i.* into v_invoice from public.invoices i
  where i.id = p_invoice_id and i.project_id = v_batch.project_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.status not in ('UNDER_REVIEW', 'MATCHED', 'REINVOICING') then
    raise exception 'INVOICE_NOT_READY_FOR_RECONCILIATION';
  end if;
  if date_trunc('month', v_invoice.invoice_date)::date <> v_batch.accounting_period then
    raise exception 'INVOICE_ACCOUNTING_PERIOD_MISMATCH';
  end if;
  if not exists (
    select 1
    from public.invoice_documents idoc
    join public.document_versions dv on dv.document_id = idoc.document_id
    join public.document_processing_jobs dpj on dpj.document_version_id = dv.id
    join public.ocr_extractions oe on oe.processing_job_id = dpj.id
    where idoc.invoice_id = v_invoice.id
      and dv.upload_status = 'UPLOADED' and dv.is_current = true
      and oe.verification_status in ('CONFIRMED', 'CORRECTED')
  ) then
    raise exception 'INVOICE_EXTRACTION_NOT_CONFIRMED';
  end if;

  select count(*)::integer,
         coalesce(sum(dg.received_quantity), 0),
         count(distinct dg.unit_code)::integer,
         min(dg.unit_code)
  into v_guide_count, v_guide_quantity, v_guide_unit_count, v_guide_unit
  from public.guide_invoices gi
  join public.batch_guides bg
    on bg.guide_id = gi.guide_id and bg.project_id = gi.project_id
   and bg.batch_id = v_batch.id and bg.removed_at is null
  join public.dispatch_guides dg
    on dg.id = gi.guide_id and dg.project_id = gi.project_id
  where gi.invoice_id = v_invoice.id;
  if v_guide_count = 0 then raise exception 'INVOICE_ACTIVE_GUIDES_REQUIRED'; end if;

  select coalesce(sum(il.quantity), 0),
         count(distinct il.unit_code) filter (where il.unit_code is not null)::integer,
         min(il.unit_code)
  into v_invoice_quantity, v_invoice_unit_count, v_invoice_unit
  from public.invoice_lines il where il.invoice_id = v_invoice.id;

  if v_invoice.invoice_type = 'PRODUCT' then
    v_match := v_guide_unit_count = 1
      and v_invoice_unit_count = 1
      and v_invoice_unit = v_guide_unit
      and v_invoice_quantity = v_guide_quantity;
    v_difference := v_invoice_quantity - v_guide_quantity;
    v_new_status := case when v_match then 'APPROVED' else 'REINVOICING' end;
  else
    -- SERVICE keeps its current manual-review contract and never compares
    -- PRODUCT metrage.
    v_match := true;
    v_difference := null;
    v_new_status := 'MATCHED';
  end if;

  update public.invoices
  set status = v_new_status, updated_at = now()
  where id = v_invoice.id;

  if v_invoice.replaces_invoice_id is not null
     and v_new_status in ('APPROVED', 'MATCHED') then
    update public.invoices
    set status = 'SUPERSEDED', updated_at = now()
    where id = v_invoice.replaces_invoice_id
      and status not in ('SUPERSEDED', 'CANCELLED');
  end if;

  select p.company_id into v_company_id
  from public.projects p where p.id = v_batch.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values
  ) values (
    v_actor, v_company_id, v_batch.project_id, 'invoice', v_invoice.id,
    'INVOICE_RECONCILED',
    jsonb_build_object('status', v_invoice.status),
    jsonb_build_object(
      'batch_id', v_batch.id,
      'invoice_type', v_invoice.invoice_type,
      'status', v_new_status,
      'guide_count', v_guide_count,
      'guide_quantity', v_guide_quantity,
      'invoice_quantity', v_invoice_quantity,
      'quantity_difference', v_difference,
      'quantity_match', v_match,
      'unit_code', v_guide_unit,
      'replaces_invoice_id', v_invoice.replaces_invoice_id
    )
  );

  return jsonb_build_object(
    'status', v_new_status,
    'guide_count', v_guide_count,
    'guide_quantity', v_guide_quantity,
    'invoice_quantity', v_invoice_quantity,
    'quantity_difference', v_difference,
    'quantity_match', v_match,
    'unit_code', v_guide_unit
  );
end;
$$;

alter function public.reconcile_batch_invoice(uuid,uuid) owner to postgres;
revoke all on function public.reconcile_batch_invoice(uuid,uuid) from public, anon;
grant execute on function public.reconcile_batch_invoice(uuid,uuid)
to authenticated, service_role;

-- Update only the audit action mapping; storage validation remains identical
-- to Migration 057 and continues to inspect the registered object metadata.
create or replace function public.finalize_document_upload(
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
  v_version public.document_versions%rowtype;
  v_context record;
  v_storage_metadata jsonb;
  v_storage_size_text text;
  v_storage_mime_type text;
  v_action text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select dv.* into v_version from public.document_versions dv
  where dv.id = p_version_id and dv.document_id = p_document_id for update;
  if not found then raise exception 'DOCUMENT_VERSION_NOT_FOUND'; end if;
  if v_version.upload_status <> 'PENDING' then raise exception 'DOCUMENT_UPLOAD_NOT_PENDING'; end if;
  if now() > v_version.upload_expires_at then raise exception 'DOCUMENT_UPLOAD_EXPIRED'; end if;

  select resolved.* into v_context
  from app_private.resolve_dispatch_document_mutation(p_document_id) resolved;
  select o.metadata into v_storage_metadata from storage.objects o
  where o.bucket_id = v_version.storage_bucket and o.name = v_version.storage_path;
  if not found then raise exception 'DOCUMENT_STORAGE_OBJECT_MISSING'; end if;

  v_storage_size_text := coalesce(v_storage_metadata ->> 'size', v_storage_metadata ->> 'contentLength');
  v_storage_mime_type := lower(coalesce(v_storage_metadata ->> 'mimetype', v_storage_metadata ->> 'contentType', ''));
  if coalesce(v_storage_size_text, '') !~ '^[0-9]+$'
     or v_storage_size_text::bigint <> v_version.file_size then
    raise exception 'DOCUMENT_STORAGE_SIZE_MISMATCH';
  end if;
  if v_storage_mime_type <> lower(v_version.mime_type) then
    raise exception 'DOCUMENT_STORAGE_MIME_MISMATCH';
  end if;

  update public.document_versions set is_current = false
  where document_id = p_document_id and is_current = true;
  update public.document_versions
  set upload_status = 'UPLOADED', uploaded_at = now(), uploaded_by = v_actor,
      is_current = true, failed_at = null, failed_by = null, failure_reason = null
  where id = p_version_id;

  v_action := case v_context.context_type
    when 'GUIDE' then 'GUIDE_DOCUMENT_UPLOADED'
    when 'INCIDENT' then 'INCIDENT_DOCUMENT_UPLOADED'
    else 'INVOICE_DOCUMENT_UPLOADED'
  end;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_context.company_id, v_context.project_id,
    'document', p_document_id, v_action,
    jsonb_build_object(
      'context_type', v_context.context_type,
      'context_id', v_context.context_id,
      'document_id', p_document_id,
      'version_id', p_version_id,
      'version', v_version.version,
      'storage_bucket', v_version.storage_bucket,
      'storage_path', v_version.storage_path,
      'mime_type', v_version.mime_type,
      'file_size', v_version.file_size
    )
  );
  return p_version_id;
end;
$$;

alter function public.finalize_document_upload(uuid,uuid) owner to postgres;
revoke all on function public.finalize_document_upload(uuid,uuid) from public, anon;
grant execute on function public.finalize_document_upload(uuid,uuid)
to authenticated, service_role;

create or replace function public.fail_document_upload(
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
  v_version public.document_versions%rowtype;
  v_context record;
  v_reason text := nullif(btrim(p_reason), '');
  v_action text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'DOCUMENT_UPLOAD_FAILURE_REASON_INVALID';
  end if;
  select dv.* into v_version from public.document_versions dv
  where dv.id = p_version_id and dv.document_id = p_document_id for update;
  if not found then raise exception 'DOCUMENT_VERSION_NOT_FOUND'; end if;
  if v_version.upload_status <> 'PENDING' then raise exception 'DOCUMENT_UPLOAD_NOT_PENDING'; end if;
  select resolved.* into v_context
  from app_private.resolve_dispatch_document_mutation(p_document_id) resolved;
  update public.document_versions
  set upload_status = 'FAILED', failed_at = now(), failed_by = v_actor,
      failure_reason = v_reason, uploaded_at = null, is_current = false
  where id = p_version_id;
  v_action := case v_context.context_type
    when 'GUIDE' then 'GUIDE_DOCUMENT_UPLOAD_FAILED'
    when 'INCIDENT' then 'INCIDENT_DOCUMENT_UPLOAD_FAILED'
    else 'INVOICE_DOCUMENT_UPLOAD_FAILED'
  end;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values, comment
  ) values (
    v_actor, v_context.company_id, v_context.project_id,
    'document', p_document_id, v_action,
    jsonb_build_object(
      'context_type', v_context.context_type,
      'context_id', v_context.context_id,
      'document_id', p_document_id,
      'version_id', p_version_id,
      'version', v_version.version,
      'reason', v_reason
    ),
    v_reason
  );
  return p_version_id;
end;
$$;

alter function public.fail_document_upload(uuid,uuid,text) owner to postgres;
revoke all on function public.fail_document_upload(uuid,uuid,text) from public, anon;
grant execute on function public.fail_document_upload(uuid,uuid,text)
to authenticated, service_role;

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.prepare_batch_invoice_upload(uuid,public.invoice_type,text,date,text,numeric,numeric,uuid[],jsonb,text,text,bigint,uuid)',
    'EXECUTE'
  )
     or not has_function_privilege(
       'authenticated', 'public.confirm_invoice_extraction(uuid,text,date,text,numeric,numeric,jsonb,uuid,text)', 'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated', 'public.reconcile_batch_invoice(uuid,uuid)', 'EXECUTE'
     )
     or has_function_privilege(
       'authenticated', 'public.register_invoice_extraction_proposal(uuid,uuid,jsonb,text)', 'EXECUTE'
     ) then
    raise exception 'PHASE9_RPC_GRANTS_NOT_ALIGNED';
  end if;
end;
$$;

commit;
