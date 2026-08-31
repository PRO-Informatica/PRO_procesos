-- 048_programming_phase4_access_alignment.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Aligns operational read access for programming with programming.view and
-- removes anonymous execution from the existing programming command RPCs.

begin;

-- ============================================================
-- 1. PROGRAMMING OPERATIONAL READ ACCESS
-- ============================================================

drop policy programming_select
on public.programming;

create policy programming_select
on public.programming
for select
to authenticated
using (
  app_private.is_project_member(project_id)
  or app_private.has_project_permission(
    project_id,
    'programming.view'
  )
);

-- The independent PLATFORM_ADMIN global-read policy remains unchanged.

-- ============================================================
-- 2. PROGRAMMING REVISIONS OPERATIONAL READ ACCESS
-- ============================================================

drop policy programming_revisions_select
on public.programming_revisions;

create policy programming_revisions_select
on public.programming_revisions
for select
to authenticated
using (
  exists (
    select 1
    from public.programming p
    where p.id = programming_revisions.programming_id
      and (
        app_private.is_project_member(p.project_id)
        or app_private.has_project_permission(
          p.project_id,
          'programming.view'
        )
      )
  )
);

-- The independent PLATFORM_ADMIN global-read policy remains unchanged.

-- ============================================================
-- 3. PROGRAMMING RPC EXECUTION SURFACE
-- ============================================================

revoke execute
on function public.create_programming(
  uuid,
  uuid,
  timestamptz,
  numeric,
  text,
  text,
  boolean,
  uuid,
  text
)
from anon;

revoke execute
on function public.confirm_programming(uuid)
from anon;

revoke execute
on function public.close_programming(uuid)
from anon;

-- Preserve the intended authenticated and server-side execution surface.
-- Function ownership remains unchanged (postgres).
grant execute
on function public.create_programming(
  uuid,
  uuid,
  timestamptz,
  numeric,
  text,
  text,
  boolean,
  uuid,
  text
)
to authenticated, service_role;

grant execute
on function public.confirm_programming(uuid)
to authenticated, service_role;

grant execute
on function public.close_programming(uuid)
to authenticated, service_role;

commit;
