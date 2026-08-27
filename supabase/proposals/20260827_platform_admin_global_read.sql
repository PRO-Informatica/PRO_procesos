-- SUPERSEDED — DO NOT EXECUTE.
-- An equivalent migration, 043_platform_admin_global_read.sql, was applied
-- manually in Supabase. This file remains only as historical context.
-- This file is intentionally outside supabase/migrations.
--
-- Adds SELECT-only visibility for active PLATFORM_ADMIN users.
-- Existing RLS policies remain in place and PostgreSQL combines them with OR.
-- No operational mutation privilege is granted by this proposal.

begin;

do $$
begin
  if to_regprocedure('app_private.is_platform_admin()') is null then
    raise exception 'Missing required helper app_private.is_platform_admin()';
  end if;

  if to_regclass('public.platform_admins') is null then
    raise exception 'Missing required table public.platform_admins';
  end if;
end;
$$;

-- Identity and platform administration
create policy platform_admin_global_read
on public.profiles
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.platform_admins
for select to authenticated
using ((select app_private.is_platform_admin()));

-- Companies, projects and memberships
create policy platform_admin_global_read
on public.companies
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.company_members
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.projects
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.project_members
for select to authenticated
using ((select app_private.is_platform_admin()));

-- RBAC catalogs and historical assignments
create policy platform_admin_global_read
on public.roles
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.permissions
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.role_permissions
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.company_member_roles
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.project_member_roles
for select to authenticated
using ((select app_private.is_platform_admin()));

-- Suppliers, templates and catalogs
create policy platform_admin_global_read
on public.suppliers
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.project_suppliers
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.supplier_templates
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.supplier_template_versions
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.supplier_template_fields
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.units_of_measure
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.project_work_items
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.incident_types
for select to authenticated
using ((select app_private.is_platform_admin()));

-- Programming and operations
create policy platform_admin_global_read
on public.programming
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.programming_revisions
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.dispatches
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.dispatch_guides
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.dispatch_incidents
for select to authenticated
using ((select app_private.is_platform_admin()));

-- Documents and typed links
create policy platform_admin_global_read
on public.documents
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.document_versions
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.programming_documents
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.guide_documents
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.invoice_documents
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.batch_documents
for select to authenticated
using ((select app_private.is_platform_admin()));

-- Batches, invoicing, reconciliation and authorization
create policy platform_admin_global_read
on public.batches
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.batch_guides
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.invoices
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.invoice_lines
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.guide_invoices
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.invoice_reviews
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.invoice_discrepancies
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.batch_authorizations
for select to authenticated
using ((select app_private.is_platform_admin()));

-- Audit and OCR processing
create policy platform_admin_global_read
on public.audit_events
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.document_processing_jobs
for select to authenticated
using ((select app_private.is_platform_admin()));

create policy platform_admin_global_read
on public.ocr_extractions
for select to authenticated
using ((select app_private.is_platform_admin()));

-- Private Storage remains private. This policy only authorizes objects that
-- are registered as successfully uploaded document versions.
create policy platform_admin_read_private_documents
on storage.objects
for select to authenticated
using (
  (select app_private.is_platform_admin())
  and bucket_id = 'private-documents'
  and exists (
    select 1
    from public.document_versions as dv
    where dv.storage_bucket = bucket_id
      and dv.storage_path = name
      and dv.upload_status = 'UPLOADED'
  )
);

-- Intentionally excluded pending an explicit scope definition:
-- public.notifications
--
-- Intentionally excluded because it does not exist in the current DB:
-- public.company_templates
--
-- REQUIRED BEFORE FINALIZING THIS MIGRATION:
-- Review the current bodies of app_private.can_read_document(uuid) and
-- app_private.can_read_storage_object(...). Preserve their existing predicates
-- and add app_private.is_platform_admin() as an OR branch. Do not replace those
-- functions from this proposal without their exact current definitions.

commit;
