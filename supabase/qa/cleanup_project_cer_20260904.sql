-- One-time cleanup for the CER testing project.
-- EXECUTED SUCCESSFULLY ON 2026-09-04.
--
-- Deletes only operational data for the exact Project below. Project master
-- data, fiscal configuration, memberships, RBAC, Suppliers, project_suppliers,
-- project_work_items and catalogs are intentionally preserved.

begin;

set local session_replication_role = replica;

do $$
declare
  v_project_id constant uuid :=
    '0b597337-3937-42a7-a5d2-83977244c22d'::uuid;
begin
  if not exists (
    select 1
    from public.projects
    where id = v_project_id
      and name = 'CER'
      and code = 'INMOBILIARIA LOS ANTURIOS, S.A.'
  ) then
    raise exception 'CER_PROJECT_IDENTITY_MISMATCH';
  end if;

  create temporary table cleanup_programming_ids on commit drop as
  select id from public.programming where project_id = v_project_id;

  create temporary table cleanup_dispatch_ids on commit drop as
  select id from public.dispatches where project_id = v_project_id;

  create temporary table cleanup_guide_ids on commit drop as
  select id from public.dispatch_guides where project_id = v_project_id;

  create temporary table cleanup_incident_ids on commit drop as
  select id from public.dispatch_incidents where project_id = v_project_id;

  create temporary table cleanup_invoice_ids on commit drop as
  select id from public.invoices where project_id = v_project_id;

  create temporary table cleanup_document_ids on commit drop as
  select id from public.documents where project_id = v_project_id;

  create temporary table cleanup_document_version_ids on commit drop as
  select id from public.document_versions
  where document_id in (select id from cleanup_document_ids);

  create temporary table cleanup_processing_job_ids on commit drop as
  select id from public.document_processing_jobs
  where document_version_id in (select id from cleanup_document_version_ids);

  delete from public.notification_reads where project_id = v_project_id;
  delete from public.notifications where project_id = v_project_id;

  delete from public.dispatch_reconciliation_attempts
  where project_id = v_project_id;
  delete from public.dispatch_reconciliations where project_id = v_project_id;

  delete from public.invoice_extractions
  where invoice_id in (select id from cleanup_invoice_ids)
     or processing_job_id in (select id from cleanup_processing_job_ids);
  delete from public.invoice_lines
  where invoice_id in (select id from cleanup_invoice_ids);
  delete from public.invoice_documents where project_id = v_project_id;
  delete from public.invoices where project_id = v_project_id;

  delete from public.batch_dispatches where project_id = v_project_id;
  delete from public.batches where project_id = v_project_id;

  delete from public.incident_documents where project_id = v_project_id;
  delete from public.guide_documents where project_id = v_project_id;
  delete from public.dispatch_documents where project_id = v_project_id;
  delete from public.dispatch_guide_lines where project_id = v_project_id;
  delete from public.dispatch_guides where project_id = v_project_id;
  delete from public.dispatch_incidents where project_id = v_project_id;
  delete from public.dispatches where project_id = v_project_id;

  delete from public.programming_revision_lines where project_id = v_project_id;
  delete from public.programming_revisions
  where programming_id in (select id from cleanup_programming_ids);
  delete from public.programming_documents where project_id = v_project_id;
  delete from public.programming_lines where project_id = v_project_id;
  delete from public.programming where project_id = v_project_id;

  delete from public.document_processing_jobs
  where id in (select id from cleanup_processing_job_ids);
  delete from public.document_versions
  where id in (select id from cleanup_document_version_ids);
  delete from public.documents where project_id = v_project_id;

  delete from public.audit_events
  where project_id = v_project_id
    and entity_type in (
      'programming', 'dispatch', 'dispatch_guide', 'dispatch_incident',
      'dispatch_reconciliation', 'batch', 'batch_dispatch', 'invoice',
      'document'
    );

  if exists (select 1 from public.programming where project_id = v_project_id)
     or exists (select 1 from public.dispatches where project_id = v_project_id)
     or exists (select 1 from public.dispatch_guides where project_id = v_project_id)
     or exists (select 1 from public.dispatch_incidents where project_id = v_project_id)
     or exists (select 1 from public.batch_dispatches where project_id = v_project_id)
     or exists (select 1 from public.batches where project_id = v_project_id)
     or exists (select 1 from public.invoices where project_id = v_project_id)
     or exists (
       select 1 from public.dispatch_reconciliations
       where project_id = v_project_id
     )
     or exists (select 1 from public.documents where project_id = v_project_id)
     or not exists (select 1 from public.projects where id = v_project_id)
     or not exists (select 1 from public.project_members where project_id = v_project_id)
     or not exists (select 1 from public.project_suppliers where project_id = v_project_id)
  then
    raise exception 'CER_OPERATIONAL_CLEANUP_VALIDATION_FAILED';
  end if;
end;
$$;

commit;

select jsonb_build_object(
  'project', (select name from public.projects
    where id = '0b597337-3937-42a7-a5d2-83977244c22d'),
  'programming', (select count(*) from public.programming
    where project_id = '0b597337-3937-42a7-a5d2-83977244c22d'),
  'dispatches', (select count(*) from public.dispatches
    where project_id = '0b597337-3937-42a7-a5d2-83977244c22d'),
  'batches', (select count(*) from public.batches
    where project_id = '0b597337-3937-42a7-a5d2-83977244c22d'),
  'invoices', (select count(*) from public.invoices
    where project_id = '0b597337-3937-42a7-a5d2-83977244c22d'),
  'documents', (select count(*) from public.documents
    where project_id = '0b597337-3937-42a7-a5d2-83977244c22d'),
  'memberships', (select count(*) from public.project_members
    where project_id = '0b597337-3937-42a7-a5d2-83977244c22d'),
  'suppliers', (select count(*) from public.project_suppliers
    where project_id = '0b597337-3937-42a7-a5d2-83977244c22d')
) as cleanup_result;
