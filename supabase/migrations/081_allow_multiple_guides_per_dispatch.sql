-- 081_allow_multiple_guides_per_dispatch.sql
-- APPLIED CORRECTLY — EXECUTED ON 2026-09-03.
--
-- Removes the legacy one-guide-per-dispatch constraint left by the previous
-- Dispatch model. Phase 2 keeps guide numbers unique inside each Dispatch,
-- while allowing the Dispatch to contain any number of different Guides.

begin;

do $$
begin
  if to_regclass('public.dispatches') is null
     or to_regclass('public.dispatch_guides') is null then
    raise exception 'PHASE2_DISPATCH_GUIDES_REQUIRED_CONTRACT_MISSING';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.dispatch_guides'::regclass
      and constraint_definition.conname = 'dispatch_guides_dispatch_number_uq'
      and constraint_definition.contype = 'u'
  ) then
    raise exception 'PHASE2_DISPATCH_GUIDE_NUMBER_UNIQUENESS_MISSING';
  end if;
end;
$$;

alter table public.dispatch_guides
drop constraint if exists dispatch_guides_dispatch_uq;

do $$
begin
  if exists (
    select 1
    from pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.dispatch_guides'::regclass
      and constraint_definition.conname = 'dispatch_guides_dispatch_uq'
  )
  or not exists (
    select 1
    from pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.dispatch_guides'::regclass
      and constraint_definition.conname = 'dispatch_guides_dispatch_number_uq'
      and pg_get_constraintdef(constraint_definition.oid)
          = 'UNIQUE (dispatch_id, guide_number)'
  ) then
    raise exception 'PHASE2_MULTIPLE_GUIDES_CONSTRAINT_NOT_ALIGNED';
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * one Dispatch accepts multiple Guides with different guide numbers;
--   * a repeated guide number inside the same Dispatch remains rejected;
--   * no Dispatch, Programming, Batch or reconciliation data is modified.
