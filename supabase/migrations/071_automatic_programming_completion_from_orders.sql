-- 071_automatic_programming_completion_from_orders.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Makes Order reconciliation the completion authority for its Dispatch and
-- Programming. A Programming completes only when every related Dispatch has
-- an active Batch Guide whose current Order is MATCHED. Pending Orders that
-- continue through weekly rollover keep the Programming IN_EXECUTION.

begin;

do $$
begin
  if to_regclass('public.programming') is null
     or to_regclass('public.dispatches') is null
     or to_regclass('public.dispatch_guides') is null
     or to_regclass('public.batch_guides') is null
     or to_regclass('public.reconciliation_orders') is null
     or to_regprocedure(
       'app_private.snapshot_programming(uuid,uuid,text,text)'
     ) is null
     or to_regprocedure(
       'app_private.normalize_reconciliation_order_number(text)'
     ) is null then
    raise exception 'PROGRAMMING_ORDER_COMPLETION_REQUIRED_CONTRACT_MISSING';
  end if;

  if to_regprocedure(
       'app_private.guard_dispatch_programming_unit()'
     ) is not null
     or to_regprocedure(
       'app_private.sync_programming_completion_from_order(uuid)'
     ) is not null then
    raise exception 'PROGRAMMING_ORDER_COMPLETION_CONTRACT_ALREADY_EXISTS';
  end if;
end;
$$;

-- A Dispatch Guide is a physical execution of its Programming and therefore
-- must use the same UM. This prevents invalid totals such as M3 counted as KM.
create function app_private.guard_dispatch_programming_unit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_programming_unit text;
begin
  select programming.unit_code
  into v_programming_unit
  from public.dispatches dispatch
  join public.programming programming
    on programming.id = dispatch.programming_id
   and programming.project_id = dispatch.project_id
  where dispatch.id = new.dispatch_id
    and dispatch.project_id = new.project_id;

  if not found then
    raise exception 'DISPATCH_PROGRAMMING_CONTEXT_INVALID';
  end if;
  if new.unit_code is distinct from v_programming_unit then
    raise exception 'DISPATCH_PROGRAMMING_UNIT_MISMATCH';
  end if;
  return new;
end;
$$;

alter function app_private.guard_dispatch_programming_unit()
owner to postgres;
revoke all on function app_private.guard_dispatch_programming_unit()
from public, anon, authenticated, service_role;

create trigger dispatch_programming_unit_guard
before insert or update of unit_code on public.dispatch_guides
for each row execute function app_private.guard_dispatch_programming_unit();

create function app_private.sync_programming_completion_from_order(
  p_reconciliation_order_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_order public.reconciliation_orders%rowtype;
  v_dispatch record;
  v_programming public.programming%rowtype;
  v_programming_id uuid;
  v_actor uuid;
  v_company_id uuid;
  v_completed integer := 0;
  v_new_dispatch_status public.dispatches.status%type;
begin
  select reconciliation_order.* into v_order
  from public.reconciliation_orders reconciliation_order
  where reconciliation_order.id = p_reconciliation_order_id;
  if not found then return 0; end if;

  select project.company_id into v_company_id
  from public.projects project
  where project.id = v_order.project_id;

  -- Keep the Dispatch badge aligned with the current active Order. A later
  -- recalculation can return it to BATCHED before the Programming completes.
  for v_dispatch in
    select distinct dispatch.id, dispatch.status
    from public.batch_guides batch_guide
    join public.dispatch_guides guide
      on guide.id = batch_guide.guide_id
     and guide.project_id = batch_guide.project_id
    join public.dispatches dispatch
      on dispatch.id = guide.dispatch_id
     and dispatch.project_id = guide.project_id
    where batch_guide.batch_id = v_order.batch_id
      and batch_guide.project_id = v_order.project_id
      and batch_guide.removed_at is null
      and app_private.normalize_reconciliation_order_number(
        guide.order_number
      ) = v_order.normalized_order_number
      and dispatch.status in (
        'BATCHED', 'UNDER_REVIEW', 'REQUIRES_CORRECTION', 'RECONCILED'
      )
  loop
    v_new_dispatch_status := case
      when v_order.reconciliation_status = 'MATCHED'
        then 'RECONCILED'
      else 'BATCHED'
    end;

    if v_dispatch.status is distinct from v_new_dispatch_status then
      update public.dispatches
      set status = v_new_dispatch_status,
          updated_at = now()
      where id = v_dispatch.id;

      insert into public.audit_events(
        actor_user_id, company_id, project_id, entity_type,
        entity_id, action, old_values, new_values
      ) values (
        auth.uid(), v_company_id, v_order.project_id, 'dispatch',
        v_dispatch.id,
        case when v_new_dispatch_status = 'RECONCILED'
          then 'DISPATCH_RECONCILED'
          else 'DISPATCH_RECONCILIATION_REOPENED' end,
        jsonb_build_object('status', v_dispatch.status),
        jsonb_build_object(
          'status', v_new_dispatch_status,
          'reconciliation_order_id', v_order.id,
          'normalized_order_number', v_order.normalized_order_number
        )
      );
    end if;
  end loop;

  -- The last MATCHED Order completes a Programming. An active relation is
  -- required, so a pending Guide moved by rollover prevents completion until
  -- its destination Order is also MATCHED.
  for v_programming_id in
    select distinct dispatch.programming_id
    from public.batch_guides batch_guide
    join public.dispatch_guides guide
      on guide.id = batch_guide.guide_id
     and guide.project_id = batch_guide.project_id
    join public.dispatches dispatch
      on dispatch.id = guide.dispatch_id
     and dispatch.project_id = guide.project_id
    where batch_guide.batch_id = v_order.batch_id
      and batch_guide.project_id = v_order.project_id
      and batch_guide.removed_at is null
      and app_private.normalize_reconciliation_order_number(
        guide.order_number
      ) = v_order.normalized_order_number
  loop
    select programming.* into v_programming
    from public.programming programming
    where programming.id = v_programming_id
    for update;

    if v_programming.status = 'IN_EXECUTION'
       and exists (
         select 1 from public.dispatches dispatch
         where dispatch.programming_id = v_programming.id
           and dispatch.project_id = v_programming.project_id
       )
       and not exists (
         select 1
         from public.dispatches dispatch
         where dispatch.programming_id = v_programming.id
           and dispatch.project_id = v_programming.project_id
           and not exists (
             select 1
             from public.dispatch_guides guide
             join public.batch_guides batch_guide
               on batch_guide.guide_id = guide.id
              and batch_guide.project_id = guide.project_id
              and batch_guide.removed_at is null
             join public.reconciliation_orders reconciliation_order
               on reconciliation_order.batch_id = batch_guide.batch_id
              and reconciliation_order.project_id = batch_guide.project_id
              and reconciliation_order.normalized_order_number =
                app_private.normalize_reconciliation_order_number(
                  guide.order_number
                )
              and reconciliation_order.reconciliation_status = 'MATCHED'
             where guide.dispatch_id = dispatch.id
               and guide.project_id = dispatch.project_id
           )
       ) then
      v_actor := coalesce(auth.uid(), v_programming.created_by);

      update public.programming
      set status = 'COMPLETED',
          version = version + 1,
          updated_at = now()
      where id = v_programming.id;

      perform app_private.snapshot_programming(
        v_programming.id,
        v_actor,
        'PROGRAMMING_COMPLETED',
        'Cierre automático: todos los Pedidos de sus despachos están conciliados.'
      );

      insert into public.audit_events(
        actor_user_id, company_id, project_id, entity_type,
        entity_id, action, old_values, new_values, comment
      ) values (
        v_actor, v_company_id, v_programming.project_id, 'programming',
        v_programming.id, 'PROGRAMMING_AUTO_COMPLETED',
        jsonb_build_object(
          'status', v_programming.status,
          'version', v_programming.version
        ),
        jsonb_build_object(
          'status', 'COMPLETED',
          'version', v_programming.version + 1,
          'completion_source', 'ALL_DISPATCH_ORDERS_MATCHED'
        ),
        'Todos los despachos relacionados tienen un Pedido activo conciliado.'
      );
      v_completed := v_completed + 1;
    end if;
  end loop;

  return v_completed;
end;
$$;

alter function app_private.sync_programming_completion_from_order(uuid)
owner to postgres;
revoke all on function app_private.sync_programming_completion_from_order(uuid)
from public, anon, authenticated;
grant execute on function app_private.sync_programming_completion_from_order(uuid)
to service_role;

create function app_private.trigger_programming_completion_from_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  perform app_private.sync_programming_completion_from_order(new.id);
  return null;
end;
$$;

alter function app_private.trigger_programming_completion_from_order()
owner to postgres;
revoke all on function app_private.trigger_programming_completion_from_order()
from public, anon, authenticated, service_role;

create trigger programming_completion_from_order
after update of reconciliation_status on public.reconciliation_orders
for each row
execute function app_private.trigger_programming_completion_from_order();

-- Align existing data, including Orders that were already MATCHED before this
-- trigger existed. No incomplete Programming is force-closed.
do $$
declare
  v_order record;
begin
  for v_order in
    select reconciliation_order.id
    from public.reconciliation_orders reconciliation_order
    order by reconciliation_order.created_at, reconciliation_order.id
  loop
    perform app_private.sync_programming_completion_from_order(v_order.id);
  end loop;
end;
$$;

do $$
begin
  if has_function_privilege(
       'authenticated',
       'app_private.sync_programming_completion_from_order(uuid)',
       'EXECUTE'
     )
     or not exists (
       select 1
       from pg_trigger trigger_definition
       join pg_class relation
         on relation.oid = trigger_definition.tgrelid
       join pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'public'
         and relation.relname = 'reconciliation_orders'
         and trigger_definition.tgname = 'programming_completion_from_order'
         and trigger_definition.tgenabled <> 'D'
         and not trigger_definition.tgisinternal
     ) then
    raise exception 'PROGRAMMING_ORDER_COMPLETION_SECURITY_NOT_ALIGNED';
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * MATCHED Order changes its active Dispatch from BATCHED to RECONCILED;
--   * one pending Dispatch keeps a multi-Dispatch Programming IN_EXECUTION;
--   * the last MATCHED Order changes the Programming to COMPLETED;
--   * a pending Guide moved by rollover continues blocking completion;
--   * matching that destination Order completes the Programming;
--   * new or corrected Guide UM different from Programming UM is rejected;
--   * existing MATCHED Orders are aligned with immutable revision and audit.
