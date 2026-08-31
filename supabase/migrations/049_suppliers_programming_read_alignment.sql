-- 049_suppliers_programming_read_alignment.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Allows operational users with programming.view to resolve only suppliers
-- actively linked to projects where they hold that permission.

begin;

drop policy if exists suppliers_select_programming_access
on public.suppliers;

create policy suppliers_select_programming_access
on public.suppliers
for select
to authenticated
using (
  exists (
    select 1
    from public.project_suppliers ps
    where ps.supplier_id = suppliers.id
      and ps.active = true
      and app_private.has_project_permission(
        ps.project_id,
        'programming.view'
      )
  )
);

-- Existing operational policies and the independent PLATFORM_ADMIN global-read
-- policy remain unchanged. This migration does not grant operational access to
-- unrelated suppliers or override project permissions.

commit;
