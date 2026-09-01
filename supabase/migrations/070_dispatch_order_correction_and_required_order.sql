-- 070_dispatch_order_correction_and_required_order.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Requires a Pedido on every new Dispatch Guide and permits an audited
-- correction while the Guide is REGISTERED or belongs to an active Batch,
-- provided no Invoice or historical Batch relation exists. Purchasing may
-- correct only the Pedido; Reception keeps the complete Guide correction.

begin;

do $$
begin
  if to_regclass('public.dispatches') is null
     or to_regclass('public.dispatch_guides') is null
     or to_regclass('public.batch_guides') is null
     or to_regclass('public.guide_invoices') is null
     or to_regprocedure(
       'app_private.snapshot_dispatch_guide(uuid,uuid,text,text)'
     ) is null
     or to_regprocedure(
       'app_private.normalize_reconciliation_order_number(text)'
     ) is null
     or to_regprocedure(
       'app_private.ensure_reconciliation_orders_for_batch(uuid)'
     ) is null
     or to_regprocedure(
       'public.correct_dispatch_guide_with_lines(uuid,integer,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,numeric,numeric,uuid,jsonb,text)'
     ) is null then
    raise exception 'DISPATCH_ORDER_CORRECTION_REQUIRED_CONTRACT_MISSING';
  end if;

  if to_regprocedure(
       'public.correct_dispatch_guide_order_number(uuid,integer,text,text)'
     ) is not null
     or to_regprocedure(
       'app_private.guard_dispatch_guide_order_number()'
     ) is not null then
    raise exception 'DISPATCH_ORDER_CORRECTION_CONTRACT_ALREADY_EXISTS';
  end if;
end;
$$;

-- New Guides must always carry the business key used to form the Pedido
-- aggregate. Existing incomplete QA data remains correctable through the RPC
-- below instead of being silently invented by a backfill.
create function app_private.guard_dispatch_guide_order_number()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if nullif(btrim(new.order_number), '') is null then
    raise exception 'ORDER_NUMBER_REQUIRED';
  end if;
  if char_length(btrim(new.order_number)) > 120 then
    raise exception 'ORDER_NUMBER_INVALID';
  end if;
  new.order_number := btrim(new.order_number);
  return new;
end;
$$;

alter function app_private.guard_dispatch_guide_order_number()
owner to postgres;
revoke all on function app_private.guard_dispatch_guide_order_number()
from public, anon, authenticated, service_role;

create trigger dispatch_guide_order_number_guard
before insert or update of order_number on public.dispatch_guides
for each row execute function app_private.guard_dispatch_guide_order_number();

-- Migration 058 intentionally locked every Batch relation. Now that Order
-- reconciliation listens to Guide order_number changes, an active Batch can
-- be updated safely before invoicing. Historical relations remain immutable.
do $$
declare
  v_signature regprocedure :=
    'public.correct_dispatch_guide_with_lines(uuid,integer,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,numeric,numeric,uuid,jsonb,text)'::regprocedure;
  v_definition text;
  v_status_original text := $block$
  if v_dispatch.status <> 'REGISTERED' then
    raise exception 'DISPATCH_NOT_EDITABLE';
  end if;
$block$;
  v_status_replacement text := $block$
  if v_dispatch.status not in ('REGISTERED', 'BATCHED') then
    raise exception 'DISPATCH_NOT_EDITABLE';
  end if;
$block$;
  v_batch_original text := $block$
  if exists (
    select 1
    from public.batch_guides bg
    where bg.guide_id = v_guide.id
      and bg.project_id = v_guide.project_id
  ) then
    raise exception 'DISPATCH_GUIDE_BATCH_LOCKED';
  end if;
$block$;
  v_batch_replacement text := $block$
  if exists (
    select 1
    from public.batch_guides bg
    where bg.guide_id = v_guide.id
      and bg.project_id = v_guide.project_id
      and bg.removed_at is not null
  ) then
    raise exception 'DISPATCH_GUIDE_BATCH_LOCKED';
  end if;
$block$;
begin
  select pg_get_functiondef(v_signature) into v_definition;

  if position(v_status_original in v_definition) = 0
     or position(v_batch_original in v_definition) = 0
     or position('DISPATCH_GUIDE_INVOICE_LOCKED' in v_definition) = 0
     or position('DISPATCH_GUIDE_INVOICE_LOCKED' in v_definition)
        > position('DISPATCH_GUIDE_BATCH_LOCKED' in v_definition) then
    raise exception 'DISPATCH_GUIDE_ACTIVE_BATCH_CORRECTION_DEFINITION_DRIFT';
  end if;

  v_definition := replace(
    v_definition, v_status_original, v_status_replacement
  );
  v_definition := replace(
    v_definition, v_batch_original, v_batch_replacement
  );
  execute v_definition;
end;
$$;

alter function public.correct_dispatch_guide_with_lines(
  uuid,integer,text,text,date,text,jsonb,timestamptz,timestamptz,timestamptz,
  public.dispatch_result,numeric,numeric,uuid,jsonb,text
) owner to postgres;

revoke all on function public.correct_dispatch_guide_with_lines(
  uuid,integer,text,text,date,text,jsonb,timestamptz,timestamptz,timestamptz,
  public.dispatch_result,numeric,numeric,uuid,jsonb,text
) from public, anon;
grant execute on function public.correct_dispatch_guide_with_lines(
  uuid,integer,text,text,date,text,jsonb,timestamptz,timestamptz,timestamptz,
  public.dispatch_result,numeric,numeric,uuid,jsonb,text
) to authenticated, service_role;

create function public.correct_dispatch_guide_order_number(
  p_dispatch_id uuid,
  p_expected_version integer,
  p_order_number text,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_guide public.dispatch_guides%rowtype;
  v_order_number text := nullif(btrim(p_order_number), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_company_id uuid;
  v_new_version integer;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select dispatch.* into v_dispatch
  from public.dispatches dispatch
  where dispatch.id = p_dispatch_id
  for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;

  if not app_private.has_project_permission(
       v_dispatch.project_id, 'dispatch.modify'
     )
     and not app_private.has_project_permission(
       v_dispatch.project_id, 'batch.modify'
     ) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_expected_version is null
     or v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;
  if v_dispatch.status not in ('REGISTERED', 'BATCHED') then
    raise exception 'DISPATCH_NOT_EDITABLE';
  end if;

  select guide.* into strict v_guide
  from public.dispatch_guides guide
  where guide.dispatch_id = v_dispatch.id
    and guide.project_id = v_dispatch.project_id
    and guide.supplier_id = v_dispatch.supplier_id
  for update;

  if exists (
    select 1 from public.guide_invoices invoice_relation
    where invoice_relation.guide_id = v_guide.id
      and invoice_relation.project_id = v_guide.project_id
  ) then
    raise exception 'DISPATCH_GUIDE_INVOICE_LOCKED';
  end if;
  if exists (
    select 1 from public.batch_guides batch_relation
    where batch_relation.guide_id = v_guide.id
      and batch_relation.project_id = v_guide.project_id
      and batch_relation.removed_at is not null
  ) then
    raise exception 'DISPATCH_GUIDE_BATCH_LOCKED';
  end if;
  if v_order_number is null then raise exception 'ORDER_NUMBER_REQUIRED'; end if;
  if char_length(v_order_number) > 120 then
    raise exception 'ORDER_NUMBER_INVALID';
  end if;
  if v_reason is null then
    raise exception 'DISPATCH_CORRECTION_REASON_REQUIRED';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'DISPATCH_CORRECTION_REASON_INVALID';
  end if;

  select project.company_id into v_company_id
  from public.projects project
  where project.id = v_dispatch.project_id;

  if not exists (
    select 1 from public.dispatch_guide_revisions revision
    where revision.dispatch_id = v_dispatch.id
      and revision.action = 'DISPATCH_GUIDE_BASELINE'
  ) then
    perform app_private.snapshot_dispatch_guide(
      v_dispatch.id, v_actor, 'DISPATCH_GUIDE_BASELINE', null
    );
  end if;

  update public.dispatch_guides
  set order_number = v_order_number,
      updated_at = now()
  where id = v_guide.id;

  v_new_version := v_dispatch.version + 1;
  update public.dispatches
  set version = v_new_version,
      updated_at = now()
  where id = v_dispatch.id;

  perform app_private.snapshot_dispatch_guide(
    v_dispatch.id, v_actor, 'DISPATCH_GUIDE_CORRECTED', v_reason
  );

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values, comment
  ) values (
    v_actor, v_company_id, v_dispatch.project_id, 'dispatch_guide',
    v_guide.id, 'GUIDE_ORDER_NUMBER_CORRECTED',
    jsonb_build_object(
      'order_number', v_guide.order_number,
      'dispatch_version', v_dispatch.version
    ),
    jsonb_build_object(
      'order_number', v_order_number,
      'normalized_order_number',
        app_private.normalize_reconciliation_order_number(v_order_number),
      'dispatch_version', v_new_version
    ),
    v_reason
  );

  return v_new_version;
exception
  when no_data_found then raise exception 'DISPATCH_GUIDE_NOT_FOUND';
  when too_many_rows then raise exception 'DISPATCH_GUIDE_CONTEXT_AMBIGUOUS';
end;
$$;

alter function public.correct_dispatch_guide_order_number(uuid,integer,text,text)
owner to postgres;
revoke all on function public.correct_dispatch_guide_order_number(uuid,integer,text,text)
from public, anon;
grant execute on function public.correct_dispatch_guide_order_number(uuid,integer,text,text)
to authenticated, service_role;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.correct_dispatch_guide_with_lines(uuid,integer,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,numeric,numeric,uuid,jsonb,text)'::regprocedure
  ) into v_definition;

  if position(
       'v_dispatch.status not in (''REGISTERED'', ''BATCHED'')'
       in v_definition
     ) = 0
     or position('and bg.removed_at is not null' in v_definition) = 0
     or not has_function_privilege(
       'authenticated',
       'public.correct_dispatch_guide_order_number(uuid,integer,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.correct_dispatch_guide_order_number(uuid,integer,text,text)',
       'EXECUTE'
     ) then
    raise exception 'DISPATCH_ORDER_CORRECTION_SECURITY_NOT_ALIGNED';
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * new Dispatch without Pedido is rejected with ORDER_NUMBER_REQUIRED;
--   * Reception can edit REGISTERED or actively BATCHED Guides before Invoice;
--   * Purchasing can correct only Pedido through the dedicated RPC;
--   * correcting the QA-B Guide to 47 creates Pedido 47 in its active Batch;
--   * any Invoice or historical Batch relation keeps the Guide immutable;
--   * baseline/correction revisions and audit event preserve the prior NULL.
