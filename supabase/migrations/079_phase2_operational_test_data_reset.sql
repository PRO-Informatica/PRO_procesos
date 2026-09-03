-- 079_phase2_operational_test_data_reset.sql
-- APPLIED CORRECTLY — EXECUTED ON 2026-09-03.
--
-- Removes only transactional/testing data before the Phase 2 Dispatch model
-- is installed. Identity, organizations, memberships, RBAC, Projects,
-- Suppliers and operational catalogs are deliberately preserved.
--
-- IMPORTANT: storage objects are not deleted by direct SQL. Before running
-- this migration, execute the scoped storage cleanup script prepared for this
-- phase. It removes only paths returned by document_versions linked below.

begin;

do $$
declare
  v_missing text;
begin
  select string_agg(required.name, ', ' order by required.name)
  into v_missing
  from (values
    ('public.programming'),
    ('public.programming_lines'),
    ('public.programming_revisions'),
    ('public.programming_revision_lines'),
    ('public.dispatches'),
    ('public.dispatch_guides'),
    ('public.dispatch_guide_lines'),
    ('public.dispatch_incidents'),
    ('public.batches'),
    ('public.batch_guides'),
    ('public.invoices'),
    ('public.invoice_lines'),
    ('public.reconciliation_orders'),
    ('public.documents'),
    ('public.document_versions'),
    ('public.audit_events'),
    ('public.profiles'),
    ('public.companies'),
    ('public.projects'),
    ('public.suppliers'),
    ('public.project_suppliers')
  ) required(name)
  where to_regclass(required.name) is null;

  if v_missing is not null then
    raise exception 'PHASE2_RESET_REQUIRED_TABLES_MISSING:%', v_missing;
  end if;
end;
$$;

-- Block concurrent operational writes while the explicit dependency-ordered
-- cleanup runs. Master-data tables are intentionally not locked or changed.
lock table
  public.programming,
  public.programming_lines,
  public.programming_revisions,
  public.programming_revision_lines,
  public.dispatches,
  public.dispatch_guides,
  public.dispatch_guide_lines,
  public.dispatch_incidents,
  public.batches,
  public.batch_guides,
  public.invoices,
  public.invoice_lines,
  public.reconciliation_orders,
  public.reconciliation_order_invoices,
  public.reconciliation_order_lines,
  public.documents,
  public.document_versions,
  public.audit_events
in access exclusive mode;

-- Capture the exact shared documents that belong to operational entities.
-- This list is also the authority used by the scoped Storage cleanup script.
create temporary table phase2_operational_document_ids (
  document_id uuid primary key
) on commit drop;

insert into phase2_operational_document_ids(document_id)
select document_id from public.programming_documents
union
select document_id from public.guide_documents
union
select document_id from public.incident_documents
union
select document_id from public.batch_documents
union
select document_id from public.invoice_documents
union
select document_id from public.mixto_listo_invoice_intakes;

do $$
declare
  v_counts jsonb;
  v_document_count integer;
begin
  select jsonb_build_object(
    'programming', (select count(*) from public.programming),
    'dispatches', (select count(*) from public.dispatches),
    'dispatch_guides', (select count(*) from public.dispatch_guides),
    'dispatch_guide_lines', (select count(*) from public.dispatch_guide_lines),
    'dispatch_incidents', (select count(*) from public.dispatch_incidents),
    'batches', (select count(*) from public.batches),
    'batch_guides', (select count(*) from public.batch_guides),
    'invoices', (select count(*) from public.invoices),
    'reconciliation_orders', (select count(*) from public.reconciliation_orders)
  ) into v_counts;
  select count(*) into v_document_count
  from phase2_operational_document_ids;

  raise notice 'PHASE2_OPERATIONAL_COUNTS_BEFORE_RESET=%', v_counts;
  raise notice 'PHASE2_OPERATIONAL_DOCUMENTS_BEFORE_RESET=%', v_document_count;
end;
$$;

-- Remove active Guide-to-Batch memberships first. Their reconciliation
-- triggers can recalculate existing Orders; subsequent deletes then operate
-- on a graph that can no longer recreate Order lines.
delete from public.batch_documents;
delete from public.batch_guides;

-- Invoice intake and reconciliation depend on Orders, Invoices, OCR and
-- Documents, so they are removed first.
delete from public.invoice_extraction_validations;
delete from public.mixto_listo_invoice_intakes;
delete from public.reconciliation_order_lines;
delete from public.reconciliation_order_invoices;
delete from public.reconciliation_orders;

delete from public.invoice_discrepancies;
delete from public.invoice_reviews;
delete from public.guide_invoices;
delete from public.invoice_documents;
delete from public.invoice_lines;
delete from public.invoices;

-- Weekly Batch testing data. The schema remains for the Phase 3 integration.
delete from public.batch_authorizations;
delete from public.batches;

-- Operational document links are deleted before their parent entities.
delete from public.incident_documents;
delete from public.guide_documents;
delete from public.programming_documents;

-- Dispatch history and the complete old operational graph.
alter table public.dispatch_guide_revision_lines
disable trigger dispatch_guide_revision_lines_immutable;
alter table public.dispatch_guide_revisions
disable trigger dispatch_guide_revisions_immutable;
delete from public.dispatch_guide_revision_lines;
delete from public.dispatch_guide_revisions;
alter table public.dispatch_guide_revision_lines
enable trigger dispatch_guide_revision_lines_immutable;
alter table public.dispatch_guide_revisions
enable trigger dispatch_guide_revisions_immutable;
delete from public.dispatch_incidents;
alter table public.dispatch_guide_lines
disable trigger dispatch_guide_lines_rollup;
delete from public.dispatch_guide_lines;
alter table public.dispatch_guide_lines
enable trigger dispatch_guide_lines_rollup;
delete from public.dispatch_guides;
delete from public.dispatches;

-- Phase 1 schema is preserved; only its testing records are removed.
alter table public.programming_revision_lines
disable trigger programming_revision_lines_immutable;
alter table public.programming_revisions
disable trigger programming_revisions_immutable;
delete from public.programming_revision_lines;
delete from public.programming_revisions;
alter table public.programming_revision_lines
enable trigger programming_revision_lines_immutable;
alter table public.programming_revisions
enable trigger programming_revisions_immutable;
alter table public.programming_lines
disable trigger programming_lines_guard;
alter table public.programming_lines
disable trigger programming_lines_rollup;
delete from public.programming_lines;
alter table public.programming_lines
enable trigger programming_lines_rollup;
alter table public.programming_lines
enable trigger programming_lines_guard;
delete from public.programming;

-- Delete only OCR/process rows belonging to the captured operational
-- documents. Other future document categories remain untouched.
delete from public.ocr_extractions extraction
using public.document_processing_jobs job,
      public.document_versions version,
      phase2_operational_document_ids target
where extraction.processing_job_id = job.id
  and job.document_version_id = version.id
  and version.document_id = target.document_id;

delete from public.document_processing_jobs job
using public.document_versions version,
      phase2_operational_document_ids target
where job.document_version_id = version.id
  and version.document_id = target.document_id;

delete from public.document_versions version
using phase2_operational_document_ids target
where version.document_id = target.document_id;

delete from public.documents document
using phase2_operational_document_ids target
where document.id = target.document_id;

-- Read acknowledgements refer to a derived operational feed and are safe to
-- rebuild. They do not contain identity or authorization data.
delete from public.notification_reads;

-- Keep administrative audit history. Remove only events generated by the
-- operational records intentionally reset in this migration.
delete from public.audit_events audit
where audit.entity_type in (
  'programming',
  'dispatch',
  'dispatch_guide',
  'dispatch_incident',
  'batch',
  'batch_guide',
  'invoice',
  'invoice_intake',
  'mixto_listo_invoice_intake',
  'reconciliation_order'
)
or (
  audit.entity_type = 'document'
  and audit.entity_id in (
    select document_id from phase2_operational_document_ids
  )
);

do $$
declare
  v_remaining bigint;
begin
  select
    (select count(*) from public.programming)
    + (select count(*) from public.dispatches)
    + (select count(*) from public.dispatch_guides)
    + (select count(*) from public.dispatch_guide_lines)
    + (select count(*) from public.dispatch_incidents)
    + (select count(*) from public.batches)
    + (select count(*) from public.batch_guides)
    + (select count(*) from public.invoices)
    + (select count(*) from public.reconciliation_orders)
  into v_remaining;

  if v_remaining <> 0 then
    raise exception 'PHASE2_OPERATIONAL_RESET_INCOMPLETE:%', v_remaining;
  end if;

  if not exists (select 1 from public.companies)
     or not exists (select 1 from public.projects)
     or not exists (select 1 from public.profiles)
     or not exists (select 1 from public.suppliers) then
    raise exception 'PHASE2_MASTER_DATA_VALIDATION_FAILED';
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * inspect both PHASE2_* NOTICE values against the pre-run inventory;
--   * operational tables are empty;
--   * users, profiles, companies, projects, memberships, RBAC, suppliers,
--     project_suppliers, units_of_measure and incident_types remain intact;
--   * only the captured operational Documents and audit events were removed.
