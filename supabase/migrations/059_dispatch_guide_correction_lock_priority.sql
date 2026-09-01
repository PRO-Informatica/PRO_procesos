-- 059_dispatch_guide_correction_lock_priority.sql
-- EXECUTED MANUALLY ON 2026-08-31 — COMPLETED SUCCESSFULLY.
--
-- Operational Phase 7 corrective migration only.
-- Makes the invoice lock the highest-priority commercial lock for Dispatch
-- Guide correction. Migration 058 remains immutable and is not recreated.
--
-- Domain context:
--   * guide_invoices can only exist while the guide has a batch association;
--   * Migration 058 checked batch_guides first, making
--     DISPATCH_GUIDE_INVOICE_LOCKED unreachable;
--   * the canonical RPC must report invoice lock first, then batch lock.

begin;

do $$
declare
  v_signature constant text :=
    'public.correct_dispatch_guide_with_lines(uuid,integer,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,numeric,numeric,uuid,jsonb,text)';
  v_definition text;
  v_original_definition text;
  v_batch_guard constant text := $guard$
  if exists (
    select 1
    from public.batch_guides bg
    where bg.guide_id = v_guide.id
      and bg.project_id = v_guide.project_id
  ) then
    raise exception 'DISPATCH_GUIDE_BATCH_LOCKED';
  end if;
$guard$;
  v_invoice_guard constant text := $guard$
  if exists (
    select 1
    from public.guide_invoices gi
    where gi.guide_id = v_guide.id
      and gi.project_id = v_guide.project_id
  ) then
    raise exception 'DISPATCH_GUIDE_INVOICE_LOCKED';
  end if;
$guard$;
begin
  if to_regprocedure(v_signature) is null then
    raise exception 'DISPATCH_GUIDE_CORRECTION_RPC_MISSING';
  end if;

  select pg_get_functiondef(v_signature::regprocedure)
  into v_definition;

  v_original_definition := v_definition;

  if position(v_batch_guard in v_definition) = 0
     or position(v_invoice_guard in v_definition) = 0 then
    raise exception 'DISPATCH_GUIDE_LOCK_GUARD_DEFINITION_DRIFT';
  end if;

  if position(v_invoice_guard in v_definition)
     < position(v_batch_guard in v_definition) then
    raise exception 'DISPATCH_GUIDE_LOCK_PRIORITY_ALREADY_ALIGNED';
  end if;

  -- Swap the two independently matched blocks. pg_get_functiondef preserves
  -- body whitespace, so a three-step marker swap avoids coupling the rewrite
  -- to the exact number of blank lines between adjacent guards.
  v_definition := replace(
    v_definition,
    v_batch_guard,
    '__DISPATCH_GUIDE_LOCK_PRIORITY_SWAP__'
  );
  v_definition := replace(
    v_definition,
    v_invoice_guard,
    v_batch_guard
  );
  v_definition := replace(
    v_definition,
    '__DISPATCH_GUIDE_LOCK_PRIORITY_SWAP__',
    v_invoice_guard
  );

  if v_definition = v_original_definition then
    raise exception 'DISPATCH_GUIDE_LOCK_PRIORITY_REWRITE_FAILED';
  end if;

  execute v_definition;
end;
$$;

alter function public.correct_dispatch_guide_with_lines(
  uuid,
  integer,
  text,
  text,
  date,
  text,
  jsonb,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  numeric,
  numeric,
  uuid,
  jsonb,
  text
)
owner to postgres;

revoke all
on function public.correct_dispatch_guide_with_lines(
  uuid,
  integer,
  text,
  text,
  date,
  text,
  jsonb,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  numeric,
  numeric,
  uuid,
  jsonb,
  text
)
from public, anon;

grant execute
on function public.correct_dispatch_guide_with_lines(
  uuid,
  integer,
  text,
  text,
  date,
  text,
  jsonb,
  timestamptz,
  timestamptz,
  timestamptz,
  public.dispatch_result,
  numeric,
  numeric,
  uuid,
  jsonb,
  text
)
to authenticated, service_role;

do $$
declare
  v_signature constant text :=
    'public.correct_dispatch_guide_with_lines(uuid,integer,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,numeric,numeric,uuid,jsonb,text)';
  v_definition text;
begin
  select pg_get_functiondef(v_signature::regprocedure)
  into v_definition;

  if position('DISPATCH_GUIDE_INVOICE_LOCKED' in v_definition) = 0
     or position('DISPATCH_GUIDE_BATCH_LOCKED' in v_definition) = 0
     or position('DISPATCH_GUIDE_INVOICE_LOCKED' in v_definition)
        > position('DISPATCH_GUIDE_BATCH_LOCKED' in v_definition) then
    raise exception 'DISPATCH_GUIDE_LOCK_PRIORITY_NOT_ALIGNED';
  end if;

  if not has_function_privilege(
    'authenticated',
    v_signature,
    'EXECUTE'
  )
     or has_function_privilege(
       'anon',
       v_signature,
       'EXECUTE'
     ) then
    raise exception 'DISPATCH_GUIDE_CORRECTION_RPC_GRANT_NOT_ALIGNED';
  end if;
end;
$$;

commit;
