-- A Programming cannot finish while either current invoice still requires the
-- explicit C14 recipient decision introduced in migration 097.
begin;

do $$
begin
  if to_regclass('public.invoice_recipient_exceptions') is null
     or to_regprocedure('app_private.sync_programming_completion_from_dispatch(uuid)') is null then
    raise exception 'C14_PROGRAMMING_COMPLETION_PREREQUISITES_MISSING';
  end if;
  if exists (
    select 1
    from public.programming programming
    join public.dispatches dispatch on dispatch.programming_id = programming.id
    join public.dispatch_reconciliations reconciliation on reconciliation.dispatch_id = dispatch.id
    join public.invoice_recipient_exceptions exception
      on exception.invoice_id in (
        reconciliation.current_product_invoice_id,
        reconciliation.current_service_invoice_id
      )
    where programming.status = 'COMPLETED'
      and exception.status = 'PENDING'
  ) then
    raise exception 'COMPLETED_PROGRAMMING_WITH_PENDING_C14_EXCEPTION';
  end if;
end;
$$;

create or replace function app_private.sync_programming_completion_from_dispatch(
  p_dispatch_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_programming public.programming%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_reconciliation public.dispatch_reconciliations%rowtype;
  v_actor uuid;
  v_company_id uuid;
begin
  select dispatch.* into v_dispatch
  from public.dispatches dispatch
  where dispatch.id = p_dispatch_id;
  if not found then return false; end if;

  select programming.* into v_programming
  from public.programming programming
  where programming.id = v_dispatch.programming_id
    and programming.project_id = v_dispatch.project_id
  for update;
  if not found or v_programming.status <> 'IN_EXECUTION' then
    return false;
  end if;

  select reconciliation.* into v_reconciliation
  from public.dispatch_reconciliations reconciliation
  where reconciliation.dispatch_id = v_dispatch.id
    and reconciliation.project_id = v_dispatch.project_id;
  if not found then return false; end if;

  if v_dispatch.status <> 'COMPLETED'
     or v_reconciliation.current_product_invoice_id is null
     or v_reconciliation.current_service_invoice_id is null
     or v_reconciliation.status <> 'RECONCILED'
     or exists (
       select 1
       from public.invoice_recipient_exceptions exception
       where exception.invoice_id in (
         v_reconciliation.current_product_invoice_id,
         v_reconciliation.current_service_invoice_id
       )
         and exception.status = 'PENDING'
     ) then
    return false;
  end if;

  v_actor := coalesce(auth.uid(), v_programming.created_by);
  select project.company_id into v_company_id
  from public.projects project where project.id = v_programming.project_id;

  update public.programming
  set status = 'COMPLETED', version = version + 1, updated_at = now()
  where id = v_programming.id and status = 'IN_EXECUTION';
  if not found then return false; end if;

  perform app_private.snapshot_programming(
    v_programming.id,
    v_actor,
    'PROGRAMMING_COMPLETED',
    'Cierre automatico: despacho completado, facturas vigentes, decisiones fiscales resueltas y Producto conciliado.'
  );

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values, comment
  ) values (
    v_actor, v_company_id, v_programming.project_id, 'programming',
    v_programming.id, 'PROGRAMMING_AUTO_COMPLETED',
    jsonb_build_object('status', v_programming.status, 'version', v_programming.version),
    jsonb_build_object(
      'status', 'COMPLETED',
      'version', v_programming.version + 1,
      'completion_source', 'DISPATCH_INVOICES_RECONCILED',
      'dispatch_id', v_dispatch.id,
      'recipient_exceptions_resolved', true
    ),
    'Despacho completado con ambas facturas vigentes, decisiones fiscales resueltas y Producto conciliado.'
  );

  return true;
end;
$$;

comment on function app_private.sync_programming_completion_from_dispatch(uuid) is
  'Completes Programming only after both current invoices exist, Product is reconciled, and C14 decisions are resolved.';
alter function app_private.sync_programming_completion_from_dispatch(uuid) owner to postgres;
revoke all on function app_private.sync_programming_completion_from_dispatch(uuid)
from public, anon, authenticated, service_role;

commit;
