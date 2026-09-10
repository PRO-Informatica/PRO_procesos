-- Controlled testing reset for every project.
--
-- Deletes the complete operational graph so Programación, Despachos and
-- Lotes can be tested again from a clean state. Master data (companies,
-- projects, users, memberships, RBAC, suppliers and catalogs) is preserved.
-- Storage objects referenced by document_versions must be removed separately
-- before running this transaction.

begin;

set local session_replication_role = replica;

create temporary table cleanup_master_counts on commit drop as
select
  (select count(*) from public.companies) as companies,
  (select count(*) from public.projects) as projects,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.project_members) as project_members,
  (select count(*) from public.project_member_roles) as project_member_roles,
  (select count(*) from public.suppliers) as suppliers,
  (select count(*) from public.project_suppliers) as project_suppliers,
  (select count(*) from public.project_work_items) as project_work_items;

create temporary table cleanup_document_ids on commit drop as
select id from public.documents;

create temporary table cleanup_document_version_ids on commit drop as
select id
from public.document_versions
where document_id in (select id from cleanup_document_ids);

create temporary table cleanup_processing_job_ids on commit drop as
select id
from public.document_processing_jobs
where document_version_id in (select id from cleanup_document_version_ids);

delete from public.notification_reads;
delete from public.notifications;

delete from public.dispatch_reconciliation_attempts;
delete from public.dispatch_reconciliations;

delete from public.invoice_extractions
where invoice_id in (select id from public.invoices)
   or processing_job_id in (select id from cleanup_processing_job_ids);
delete from public.invoice_lines;
delete from public.invoice_documents;
delete from public.invoices;

delete from public.batch_dispatches;
delete from public.batches;

delete from public.incident_documents;
delete from public.guide_documents;
delete from public.dispatch_documents;
delete from public.dispatch_guide_lines;
delete from public.dispatch_guides;
delete from public.dispatch_incidents;
delete from public.dispatches;

delete from public.programming_revision_lines;
delete from public.programming_revisions;
delete from public.programming_documents;
delete from public.programming_lines;
delete from public.programming;

delete from public.document_processing_jobs
where id in (select id from cleanup_processing_job_ids);
delete from public.document_versions
where id in (select id from cleanup_document_version_ids);
delete from public.documents
where id in (select id from cleanup_document_ids);

delete from public.audit_events
where entity_type in (
  'programming',
  'dispatch',
  'dispatch_guide',
  'dispatch_incident',
  'dispatch_reconciliation',
  'batch',
  'batch_dispatch',
  'invoice',
  'document'
);

do $$
declare
  before_counts cleanup_master_counts%rowtype;
begin
  select * into strict before_counts from cleanup_master_counts;

  if exists (select 1 from public.programming)
     or exists (select 1 from public.dispatches)
     or exists (select 1 from public.dispatch_guides)
     or exists (select 1 from public.dispatch_incidents)
     or exists (select 1 from public.batch_dispatches)
     or exists (select 1 from public.batches)
     or exists (select 1 from public.invoices)
     or exists (select 1 from public.dispatch_reconciliations)
     or exists (select 1 from public.dispatch_reconciliation_attempts)
     or exists (select 1 from public.documents)
     or exists (select 1 from public.document_versions)
     or exists (select 1 from public.document_processing_jobs)
     or exists (select 1 from public.notifications)
     or exists (select 1 from public.notification_reads)
  then
    raise exception 'ALL_PROJECTS_OPERATIONAL_CLEANUP_VALIDATION_FAILED';
  end if;

  if before_counts.companies <> (select count(*) from public.companies)
     or before_counts.projects <> (select count(*) from public.projects)
     or before_counts.profiles <> (select count(*) from public.profiles)
     or before_counts.project_members <> (select count(*) from public.project_members)
     or before_counts.project_member_roles <> (select count(*) from public.project_member_roles)
     or before_counts.suppliers <> (select count(*) from public.suppliers)
     or before_counts.project_suppliers <> (select count(*) from public.project_suppliers)
     or before_counts.project_work_items <> (select count(*) from public.project_work_items)
  then
    raise exception 'MASTER_DATA_CHANGED_DURING_OPERATIONAL_CLEANUP';
  end if;
end;
$$;

commit;

select jsonb_build_object(
  'programming', (select count(*) from public.programming),
  'dispatches', (select count(*) from public.dispatches),
  'dispatch_guides', (select count(*) from public.dispatch_guides),
  'batches', (select count(*) from public.batches),
  'invoices', (select count(*) from public.invoices),
  'reconciliations', (select count(*) from public.dispatch_reconciliations),
  'documents', (select count(*) from public.documents),
  'projects_preserved', (select count(*) from public.projects),
  'memberships_preserved', (select count(*) from public.project_members),
  'suppliers_preserved', (select count(*) from public.suppliers)
) as cleanup_result;
