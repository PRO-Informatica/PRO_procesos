-- 046_batch_guides_system_removal_constraint.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Allows audited SYSTEM rollover removals without inventing a human actor,
-- while keeping human and automatic removal evidence mutually exclusive.
-- Also removes unnecessary anonymous execution from the dispatch registration
-- RPCs introduced or updated by migration 045.

begin;

-- ============================================================
-- 1. BATCH GUIDE REMOVAL INTEGRITY
-- ============================================================

alter table public.batch_guides
drop constraint batch_guides_removed_ck;

-- Fail safely if data changed after the read-only review and no longer fits
-- the stricter HUMAN/SYSTEM distinction. The surrounding transaction restores
-- the previous constraint automatically if this check raises.
do $$
begin
  if exists (
    select 1
    from public.batch_guides bg
    where not (
      (
        bg.removed_at is null
        and bg.removed_by is null
      )
      or
      (
        bg.removed_at is not null
        and bg.removed_at >= bg.added_at
        and (
          (
            bg.removed_by is not null
            and coalesce(bg.removal_metadata ->> 'source', '') <> 'SYSTEM'
          )
          or
          (
            bg.removed_by is null
            and bg.removal_metadata ->> 'source' = 'SYSTEM'
          )
        )
      )
    )
  ) then
    raise exception 'BATCH_GUIDES_REMOVAL_DATA_REQUIRES_MANUAL_REVIEW';
  end if;
end;
$$;

alter table public.batch_guides
add constraint batch_guides_removed_ck
check (
  (
    removed_at is null
    and removed_by is null
  )
  or
  (
    removed_at is not null
    and removed_at >= added_at
    and (
      (
        removed_by is not null
        and coalesce(removal_metadata ->> 'source', '') <> 'SYSTEM'
      )
      or
      (
        removed_by is null
        and removal_metadata ->> 'source' = 'SYSTEM'
      )
    )
  )
);

-- ============================================================
-- 2. DISPATCH RPC EXECUTION SURFACE
-- ============================================================

revoke execute
on function public.register_dispatch_with_lines(
  uuid,
  text,
  text,
  date,
  text,
  jsonb,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  uuid,
  jsonb
)
from public, anon;

revoke execute
on function public.register_dispatch(
  uuid,
  text,
  text,
  date,
  numeric,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  uuid,
  jsonb
)
from public, anon;

-- Keep the intended operational and server-side callers explicit.
grant execute
on function public.register_dispatch_with_lines(
  uuid,
  text,
  text,
  date,
  text,
  jsonb,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  uuid,
  jsonb
)
to authenticated, service_role;

grant execute
on function public.register_dispatch(
  uuid,
  text,
  text,
  date,
  numeric,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  uuid,
  jsonb
)
to authenticated, service_role;

commit;
