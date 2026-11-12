-- Product and required Service must both be reconciled before financial completion.
-- Operational completion stays separate so pending invoices can still be processed.
-- No historical business rows are changed by this schema migration.
begin;

do $$ begin
  if to_regprocedure('app_private.dispatch_billing_complete(uuid)') is null
     or not exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
       where t.typnamespace='public'::regnamespace and t.typname='programming_status' and e.enumlabel='DISPATCH_COMPLETED')
  then raise exception 'BOTH_RECONCILIATIONS_PREREQUISITE_MISSING'; end if;
end $$;

create or replace function app_private.dispatch_billing_complete(p_dispatch_id uuid)
returns boolean language sql volatile security definer
set search_path = pg_catalog, public, app_private
as $$
  select exists (
    select 1 from public.dispatches dispatch
    join public.programming programming
      on programming.id=dispatch.programming_id and programming.project_id=dispatch.project_id
    join public.dispatch_reconciliations reconciliation
      on reconciliation.dispatch_id=dispatch.id and reconciliation.project_id=dispatch.project_id
    where dispatch.id=p_dispatch_id and dispatch.status='COMPLETED'
      and reconciliation.status='RECONCILED'
      and reconciliation.current_product_invoice_id is not null
      and (programming.delivery_modes = array['DIRECT']::text[]
        or (reconciliation.current_service_invoice_id is not null
          and reconciliation.service_status='RECONCILED'))
      and not exists (
        select 1 from public.invoice_recipient_exceptions exception
        where exception.invoice_id in (reconciliation.current_product_invoice_id,
          reconciliation.current_service_invoice_id) and exception.status='PENDING'
      )
  );
$$;

create or replace function app_private.sync_programming_completion_from_dispatch(p_dispatch_id uuid)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_programming public.programming%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_target public.programming_status;
  v_actor uuid;
  v_company_id uuid;
  v_action text;
  v_reason text;
begin
  select * into v_dispatch from public.dispatches where id=p_dispatch_id;
  if not found then return false; end if;
  select * into v_programming from public.programming
    where id=v_dispatch.programming_id and project_id=v_dispatch.project_id for update;
  -- A pending reconciliation reopens financial completion; cancelled or unstarted records are untouched.
  if not found or v_programming.status not in ('IN_EXECUTION','DISPATCH_COMPLETED','COMPLETED') then return false; end if;
  if exists(select 1 from public.dispatches where programming_id=v_programming.id
    and project_id=v_programming.project_id and status<>'COMPLETED') then
    v_target:='IN_EXECUTION';
  elsif not exists(select 1 from public.dispatches where programming_id=v_programming.id
    and project_id=v_programming.project_id and not app_private.dispatch_billing_complete(id)) then
    v_target:='COMPLETED';
  else
    v_target:='DISPATCH_COMPLETED';
  end if;
  if v_target=v_programming.status then return false; end if;
  v_actor:=coalesce(auth.uid(),v_programming.created_by);
  select company_id into v_company_id from public.projects where id=v_programming.project_id;
  v_action:=case when v_programming.status='COMPLETED' and v_target<>'COMPLETED' then 'PROGRAMMING_BILLING_REOPENED' else case v_target when 'COMPLETED' then 'PROGRAMMING_COMPLETED'
    when 'DISPATCH_COMPLETED' then 'PROGRAMMING_DISPATCH_COMPLETED' else 'PROGRAMMING_IN_EXECUTION' end end;
  v_reason:=case v_target when 'COMPLETED' then 'Cierre automático: despacho completado, Producto y Servicio requeridos conciliados según modalidad.'
    when 'DISPATCH_COMPLETED' then 'Operación finalizada; la programación permanece pendiente hasta conciliar Producto y Servicio requeridos.'
    else 'El despacho continúa en ejecución.' end;
  update public.programming set status=v_target,version=version+1,updated_at=now()
    where id=v_programming.id;
  perform app_private.snapshot_programming(v_programming.id,v_actor,v_action,v_reason);
  insert into public.audit_events(actor_user_id,company_id,project_id,entity_type,entity_id,
    action,old_values,new_values,comment)
  values(v_actor,v_company_id,v_programming.project_id,'programming',v_programming.id,
    case when v_target='COMPLETED' then 'PROGRAMMING_AUTO_COMPLETED' else v_action end,
    jsonb_build_object('status',v_programming.status,'version',v_programming.version),
    jsonb_build_object('status',v_target,'version',v_programming.version+1,
      'dispatch_id',v_dispatch.id,'delivery_modes',v_programming.delivery_modes,
      'completion_source',case when v_target='COMPLETED' then 'DISPATCH_INVOICES_RECONCILED' else 'INVOICE_RECONCILIATION_PENDING' end),v_reason);
  return true;
end;
$$;

create or replace function public.preview_weekly_batch_rollover(
  p_batch_id uuid
)
returns table(
  batch_dispatch_id uuid,
  dispatch_id uuid,
  reconciled boolean,
  rollover_action text,
  rollover_reason text,
  destination_batch_id uuid,
  destination_period_start date,
  destination_period_end date,
  destination_accounting_period date
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_batch public.batches%rowtype;
  v_period record;
  v_destination uuid;
begin
  select * into v_batch from public.batches where id = p_batch_id;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_batch.project_id, 'batch.view')
  then raise exception 'PERMISSION_DENIED'; end if;
  select resolved.* into v_period
  from app_private.resolve_weekly_batch_period(
    v_batch.project_id, v_batch.period_end + 1
  ) resolved;
  select id into v_destination from public.batches
  where project_id = v_batch.project_id
    and period_start = v_period.period_start;

  return query
  select relation.id, relation.dispatch_id,
    app_private.dispatch_billing_complete(relation.dispatch_id),
    case when app_private.dispatch_billing_complete(relation.dispatch_id)
      then 'STAY' else 'MOVE' end,
    case when app_private.dispatch_billing_complete(relation.dispatch_id)
      then 'Producto y Servicio requeridos conciliados'
      else 'Pendiente de conciliación de Producto o Servicio requerido, facturas o decisiones fiscales' end,
    v_destination, v_period.period_start, v_period.period_end,
    v_period.accounting_period
  from public.batch_dispatches relation
  left join public.dispatch_reconciliations reconciliation
    on reconciliation.dispatch_id = relation.dispatch_id
  where relation.batch_id = v_batch.id and relation.removed_at is null
  order by relation.added_at, relation.id;
end;
$$;

-- Re-evaluate on Service changes as well as Product/pointer changes.
drop trigger programming_completion_from_reconciliation on public.dispatch_reconciliations;
create trigger programming_completion_from_reconciliation
  after insert or update of status, service_status, current_product_invoice_id, current_service_invoice_id
  on public.dispatch_reconciliations for each row
  execute function app_private.trigger_programming_completion_from_reconciliation();

-- One authoritative completion map for all lists, cards and batch counters.
-- Return booleans only, restricted to projects visible to the authenticated user.
create function public.get_dispatch_billing_completion(p_project_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_project_ids is null or cardinality(p_project_ids)>1000
    or array_position(p_project_ids,null) is not null then raise exception 'PROJECT_IDS_INVALID'; end if;
  if exists(select 1 from unnest(p_project_ids) project_id where not (
    app_private.has_project_permission(project_id,'batch.view')
    or app_private.has_project_permission(project_id,'dispatch.view')
    or app_private.has_project_permission(project_id,'programming.view')
  )) then raise exception 'PERMISSION_DENIED'; end if;
  return coalesce((select jsonb_object_agg(d.id::text,app_private.dispatch_billing_complete(d.id))
    from public.dispatches d where d.project_id=any(p_project_ids)), '{}'::jsonb);
end;
$$;

alter function app_private.dispatch_billing_complete(uuid) owner to postgres;
revoke all on function app_private.dispatch_billing_complete(uuid) from public,anon,authenticated,service_role;
alter function app_private.sync_programming_completion_from_dispatch(uuid) owner to postgres;
revoke all on function app_private.sync_programming_completion_from_dispatch(uuid) from public,anon,authenticated,service_role;
alter function public.get_dispatch_billing_completion(uuid[]) owner to postgres;
revoke all on function public.get_dispatch_billing_completion(uuid[]) from public,anon;
grant execute on function public.get_dispatch_billing_completion(uuid[]) to authenticated,service_role;
comment on function app_private.dispatch_billing_complete(uuid) is 'Completed operation, reconciled Product and reconciled required Service; exclusive DIRECT retains its Service exception.';
comment on column public.dispatch_reconciliations.service_status is 'Required Service reconciliation blocks programming completion and keeps incomplete dispatches moving to the next batch.';
notify pgrst, 'reload schema';
commit;
