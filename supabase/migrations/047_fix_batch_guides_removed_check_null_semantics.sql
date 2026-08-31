-- 047_fix_batch_guides_removed_check_null_semantics.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Corrects only the NULL semantics of batch_guides_removed_ck so a removed
-- relation must carry unambiguous HUMAN or SYSTEM actor evidence.

begin;

-- Abort before replacing the constraint if current data cannot satisfy the
-- stricter rule. No schema change is retained when this validation fails.
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
            and coalesce(bg.removal_metadata ->> 'source', '') = 'SYSTEM'
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
drop constraint batch_guides_removed_ck;

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
        and coalesce(removal_metadata ->> 'source', '') = 'SYSTEM'
      )
    )
  )
);

commit;
