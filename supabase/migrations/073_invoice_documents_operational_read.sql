-- 073_invoice_documents_operational_read.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Exposes Invoice-to-Document relationship metadata to authorized readers so
-- the global Documents index can display its real Invoice/Pedido context.
-- File access remains private and delegated to can_read_document/storage RLS.

begin;

do $$
begin
  if to_regclass('public.invoice_documents') is null
     or to_regprocedure('app_private.can_read_document(uuid)') is null
     or to_regprocedure(
       'app_private.has_project_permission(uuid,text)'
     ) is null
     or to_regprocedure('app_private.is_platform_admin()') is null then
    raise exception 'INVOICE_DOCUMENT_READ_REQUIRED_CONTRACT_MISSING';
  end if;

  if exists (
    select 1 from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'invoice_documents'
      and policy.policyname in (
        'invoice_documents_select',
        'platform_admin_read_invoice_documents'
      )
  ) then
    raise exception 'INVOICE_DOCUMENT_READ_CONTRACT_ALREADY_EXISTS';
  end if;
end;
$$;

alter table public.invoice_documents enable row level security;

create policy invoice_documents_select
on public.invoice_documents
for select
to authenticated
using (
  app_private.has_project_permission(project_id, 'invoice.view')
  and app_private.can_read_document(document_id)
);

create policy platform_admin_read_invoice_documents
on public.invoice_documents
for select
to authenticated
using (app_private.is_platform_admin());

revoke all on table public.invoice_documents from public, anon;
grant select on table public.invoice_documents to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'invoice_documents'
      and policy.policyname = 'invoice_documents_select'
      and policy.cmd = 'SELECT'
      and 'authenticated'::name = any(policy.roles)
      and position('invoice.view' in coalesce(policy.qual, '')) > 0
      and position('can_read_document' in coalesce(policy.qual, '')) > 0
  )
  or not exists (
    select 1 from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'invoice_documents'
      and policy.policyname = 'platform_admin_read_invoice_documents'
      and position('is_platform_admin' in coalesce(policy.qual, '')) > 0
  )
  or has_table_privilege(
       'anon', 'public.invoice_documents', 'SELECT'
     )
  or not has_table_privilege(
       'authenticated', 'public.invoice_documents', 'SELECT'
     ) then
    raise exception 'INVOICE_DOCUMENT_READ_SECURITY_NOT_ALIGNED';
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * invoice.view can read only relationship rows allowed by Project RLS;
--   * users without invoice.view cannot discover Invoice document relations;
--   * the Documents index shows Factura and Pedido instead of "Otro";
--   * preview/download remain short-lived and private;
--   * anon retains no access.
