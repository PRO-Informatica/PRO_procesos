-- 050_units_of_measure_programming_read_access.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- units_of_measure is a global catalog. This policy exposes only active units
-- to operational users who hold programming.view in at least one active
-- project. The independent PLATFORM_ADMIN global-read policy is unchanged.

begin;

drop policy if exists units_of_measure_select_programming_access
on public.units_of_measure;

create policy units_of_measure_select_programming_access
on public.units_of_measure
for select
to authenticated
using (
  active = true
  and exists (
    select 1
    from public.projects p
    where p.status = 'ACTIVE'
      and app_private.has_project_permission(
        p.id,
        'programming.view'
      )
  )
);

commit;
