-- 094_programming_completion_and_optional_guide_labels.sql
-- Aligns actor labels used by Reporteria, restores automatic Programming
-- completion on the canonical Phase 3 reconciliation model, and makes the
-- descriptive product fields on Dispatch Guide lines optional.

begin;

do $$
begin
  if to_regclass('public.programming') is null
     or to_regclass('public.dispatches') is null
     or to_regclass('public.dispatch_reconciliations') is null
     or to_regclass('public.dispatch_guide_lines') is null
     or to_regprocedure('app_private.snapshot_programming(uuid,uuid,text,text)') is null
     or to_regprocedure('app_private.validate_dispatch_guide_lines_payload(jsonb)') is null
     or to_regprocedure('public.complete_dispatch(uuid,integer)') is null then
    raise exception 'PROGRAMMING_COMPLETION_GUIDE_LABELS_REQUIRED_CONTRACT_MISSING';
  end if;

  if exists (
    select 1
    from public.dispatch_guide_lines line
    where line.quantity is null
       or line.quantity <= 0
       or nullif(btrim(line.unit_code), '') is null
  ) then
    raise exception 'DISPATCH_GUIDE_LINE_REQUIRED_VALUES_INVALID';
  end if;
end;
$$;

-- Reporting needs actor labels across one or more authorized projects. Direct
-- profile reads can be narrower than operational visibility because of RLS.
create function public.get_report_actor_labels(p_project_ids uuid[])
returns table(profile_id uuid, display_label text)
language sql
stable
security definer
set search_path = pg_catalog, public, app_private, auth
as $$
  with actor_ids as (
    select programming.created_by profile_id
    from public.programming programming
    where programming.project_id = any(coalesce(p_project_ids, array[]::uuid[]))
      and app_private.has_project_permission(
        programming.project_id,
        'dispatch.view'
      )
    union
    select dispatch.created_by profile_id
    from public.dispatches dispatch
    where dispatch.project_id = any(coalesce(p_project_ids, array[]::uuid[]))
      and app_private.has_project_permission(
        dispatch.project_id,
        'dispatch.view'
      )
  )
  select actor.profile_id,
    coalesce(
      nullif(btrim(profile.full_name), ''),
      nullif(btrim(auth_user.email), ''),
      'Usuario no disponible'
    )
  from actor_ids actor
  left join public.profiles profile on profile.id = actor.profile_id
  left join auth.users auth_user on auth_user.id = actor.profile_id;
$$;

alter function public.get_report_actor_labels(uuid[]) owner to postgres;
revoke all on function public.get_report_actor_labels(uuid[]) from public, anon;
grant execute on function public.get_report_actor_labels(uuid[])
to authenticated, service_role;

-- Quantity and UM remain mandatory. Code and description are optional
-- descriptive metadata and blank input is normalized to NULL.
alter table public.dispatch_guide_lines
  drop constraint if exists dispatch_guide_lines_product_code_ck,
  drop constraint if exists dispatch_guide_lines_product_description_ck,
  alter column product_code drop not null,
  alter column product_description drop not null;

create function app_private.normalize_optional_dispatch_guide_line_labels()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  new.product_code := nullif(btrim(new.product_code), '');
  new.product_description := nullif(btrim(new.product_description), '');
  return new;
end;
$$;

alter function app_private.normalize_optional_dispatch_guide_line_labels()
owner to postgres;
revoke all on function app_private.normalize_optional_dispatch_guide_line_labels()
from public, anon, authenticated, service_role;

drop trigger if exists dispatch_guide_lines_normalize_optional_labels
on public.dispatch_guide_lines;
create trigger dispatch_guide_lines_normalize_optional_labels
before insert or update of product_code, product_description
on public.dispatch_guide_lines
for each row execute function
  app_private.normalize_optional_dispatch_guide_line_labels();

create or replace function app_private.validate_dispatch_guide_lines_payload(
  p_lines jsonb
)
returns table(line_count integer, total_quantity numeric(12,3), unit_code text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0
     or jsonb_array_length(p_lines) > 100 then
    raise exception 'DISPATCH_GUIDE_LINES_REQUIRED';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) item(value)
    where jsonb_typeof(item.value) <> 'object'
       or jsonb_typeof(item.value -> 'quantity') <> 'number'
       or (item.value ->> 'quantity')::numeric <= 0
       or nullif(btrim(item.value ->> 'unit_code'), '') is null
       or char_length(btrim(item.value ->> 'product_code')) > 120
       or char_length(btrim(item.value ->> 'product_description')) > 500
  ) then
    raise exception 'DISPATCH_GUIDE_LINE_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) item(value)
    left join public.units_of_measure unit
      on unit.code = btrim(item.value ->> 'unit_code')
     and unit.active
    where unit.code is null
  ) then
    raise exception 'INVALID_OR_INACTIVE_UNIT_OF_MEASURE';
  end if;

  return query
  select count(*)::integer,
         sum((item.value ->> 'quantity')::numeric)::numeric(12,3),
         min(btrim(item.value ->> 'unit_code'))
  from jsonb_array_elements(p_lines) item(value)
  having count(distinct btrim(item.value ->> 'unit_code')) = 1;

  if not found then
    raise exception 'DISPATCH_GUIDE_MIXED_UNITS_NOT_SUPPORTED';
  end if;
end;
$$;

alter function app_private.validate_dispatch_guide_lines_payload(jsonb)
owner to postgres;
revoke all on function app_private.validate_dispatch_guide_lines_payload(jsonb)
from public, anon, authenticated, service_role;

-- Preserve every existing completion requirement except descriptive Guide
-- labels. A dispatched operation still requires a Guide with Quantity and UM.
create or replace function public.complete_dispatch(
  p_dispatch_id uuid,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_programming public.programming%rowtype;
  v_company_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select dispatch.* into v_dispatch
  from public.dispatches dispatch where dispatch.id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(
    v_dispatch.project_id, 'dispatch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.version <> p_expected_version then
    raise exception 'DISPATCH_VERSION_CONFLICT';
  end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_ALREADY_COMPLETED';
  end if;
  if v_dispatch.result is null then
    raise exception 'DISPATCH_RESULT_REQUIRED';
  end if;

  select programming.* into v_programming
  from public.programming programming
  where programming.id = v_dispatch.programming_id
    and programming.project_id = v_dispatch.project_id
  for update;
  if not found then raise exception 'DISPATCH_PROGRAMMING_CONTEXT_INVALID'; end if;

  if v_dispatch.result = 'DISPATCHED' then
    if v_dispatch.arrival_at is null then
      raise exception 'DISPATCH_ARRIVAL_REQUIRED';
    end if;
    if v_dispatch.departure_at is null then
      raise exception 'DISPATCH_DEPARTURE_REQUIRED';
    end if;
    if nullif(btrim(v_dispatch.order_number), '') is null then
      raise exception 'DISPATCH_ORDER_NUMBER_REQUIRED';
    end if;
    if v_dispatch.real_volume is null or v_dispatch.real_volume <= 0 then
      raise exception 'DISPATCH_REAL_VOLUME_REQUIRED';
    end if;
    if v_dispatch.real_unit_code is null then
      raise exception 'DISPATCH_REAL_UNIT_REQUIRED';
    end if;
    if v_dispatch.real_unit_code is distinct from v_programming.unit_code then
      raise exception 'DISPATCH_PROGRAMMING_UNIT_MISMATCH';
    end if;
    if not exists (
      select 1 from public.dispatch_guides guide
      where guide.dispatch_id = v_dispatch.id
        and guide.project_id = v_dispatch.project_id
    ) then raise exception 'DISPATCH_GUIDE_REQUIRED'; end if;
    if exists (
      select 1 from public.dispatch_guides guide
      where guide.dispatch_id = v_dispatch.id
        and (
          nullif(btrim(guide.guide_number), '') is null
          or not exists (
            select 1 from public.dispatch_guide_lines line
            where line.guide_id = guide.id
              and line.project_id = guide.project_id
              and line.quantity > 0
              and nullif(btrim(line.unit_code), '') is not null
          )
        )
    ) then raise exception 'DISPATCH_GUIDE_INCOMPLETE'; end if;
  else
    if v_dispatch.real_volume is distinct from 0 then
      raise exception 'NOT_DISPATCHED_REAL_VOLUME_MUST_BE_ZERO';
    end if;
    if not exists (
      select 1 from public.dispatch_incidents incident
      where incident.dispatch_id = v_dispatch.id
        and incident.project_id = v_dispatch.project_id
    ) then raise exception 'NOT_DISPATCHED_INCIDENT_REQUIRED'; end if;
  end if;

  if not exists (
    select 1
    from public.document_versions version
    where version.is_current
      and version.upload_status = 'UPLOADED'
      and (
        exists (
          select 1 from public.dispatch_documents relation
          where relation.document_id = version.document_id
            and relation.dispatch_id = v_dispatch.id
            and relation.project_id = v_dispatch.project_id
        )
        or exists (
          select 1
          from public.guide_documents relation
          join public.dispatch_guides guide on guide.id = relation.guide_id
          where relation.document_id = version.document_id
            and guide.dispatch_id = v_dispatch.id
            and guide.project_id = v_dispatch.project_id
        )
        or exists (
          select 1
          from public.incident_documents relation
          join public.dispatch_incidents incident
            on incident.id = relation.incident_id
          where relation.document_id = version.document_id
            and incident.dispatch_id = v_dispatch.id
            and incident.project_id = v_dispatch.project_id
        )
      )
  ) then
    raise exception 'DISPATCH_EVIDENCE_REQUIRED';
  end if;

  update public.dispatches
  set status = 'COMPLETED',
      completed_at = now(),
      completed_by = v_actor,
      version = version + 1,
      updated_at = now()
  where id = v_dispatch.id;

  select project.company_id into v_company_id
  from public.projects project where project.id = v_dispatch.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values
  ) values (
    v_actor, v_company_id, v_dispatch.project_id, 'dispatch',
    v_dispatch.id, 'DISPATCH_COMPLETED',
    jsonb_build_object('status', v_dispatch.status, 'version', v_dispatch.version),
    jsonb_build_object(
      'status', 'COMPLETED',
      'result', v_dispatch.result,
      'order_number', v_dispatch.order_number,
      'real_volume', v_dispatch.real_volume,
      'real_unit_code', v_dispatch.real_unit_code,
      'version', v_dispatch.version + 1
    )
  );
  return v_dispatch.version + 1;
end;
$$;

alter function public.complete_dispatch(uuid,integer) owner to postgres;
revoke all on function public.complete_dispatch(uuid,integer) from public, anon;
grant execute on function public.complete_dispatch(uuid,integer)
to authenticated, service_role;

-- Phase 3 completion authority: the single Dispatch must be operationally
-- complete, both current invoices must exist, and Product must be reconciled.
create function app_private.sync_programming_completion_from_dispatch(
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

  if not found then
    return false;
  end if;

  if v_dispatch.status <> 'COMPLETED'
     or v_reconciliation.current_product_invoice_id is null
     or v_reconciliation.current_service_invoice_id is null
     or v_reconciliation.status <> 'RECONCILED' then
    return false;
  end if;

  v_actor := coalesce(auth.uid(), v_programming.created_by);
  select project.company_id into v_company_id
  from public.projects project where project.id = v_programming.project_id;

  update public.programming
  set status = 'COMPLETED',
      version = version + 1,
      updated_at = now()
  where id = v_programming.id
    and status = 'IN_EXECUTION';
  if not found then return false; end if;

  perform app_private.snapshot_programming(
    v_programming.id,
    v_actor,
    'PROGRAMMING_COMPLETED',
    'Cierre automatico: despacho completado, facturas vigentes y Producto conciliado.'
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
      'completion_source', 'DISPATCH_INVOICES_RECONCILED',
      'dispatch_id', v_dispatch.id
    ),
    'Despacho completado con facturas de Producto y Servicio vigentes; Producto conciliado.'
  );

  return true;
end;
$$;

alter function app_private.sync_programming_completion_from_dispatch(uuid)
owner to postgres;
revoke all on function
  app_private.sync_programming_completion_from_dispatch(uuid)
from public, anon, authenticated, service_role;

create function app_private.trigger_programming_completion_from_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  perform app_private.sync_programming_completion_from_dispatch(new.dispatch_id);
  return null;
end;
$$;

alter function app_private.trigger_programming_completion_from_reconciliation()
owner to postgres;
revoke all on function
  app_private.trigger_programming_completion_from_reconciliation()
from public, anon, authenticated, service_role;

drop trigger if exists programming_completion_from_reconciliation
on public.dispatch_reconciliations;
create trigger programming_completion_from_reconciliation
after insert or update of
  status, current_product_invoice_id, current_service_invoice_id
on public.dispatch_reconciliations
for each row execute function
  app_private.trigger_programming_completion_from_reconciliation();

-- Re-evaluate when operational completion happens after the invoices were
-- already registered/reconciled (the universal pipeline accepts both states).
create function app_private.trigger_programming_completion_from_dispatch()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  perform app_private.sync_programming_completion_from_dispatch(new.id);
  return null;
end;
$$;

alter function app_private.trigger_programming_completion_from_dispatch()
owner to postgres;
revoke all on function
  app_private.trigger_programming_completion_from_dispatch()
from public, anon, authenticated, service_role;

drop trigger if exists programming_completion_from_dispatch
on public.dispatches;
create trigger programming_completion_from_dispatch
after update of status on public.dispatches
for each row
when (old.status is distinct from new.status)
execute function
  app_private.trigger_programming_completion_from_dispatch();

-- Align qualifying testing data without touching incomplete Programming rows.
do $$
declare
  v_dispatch record;
begin
  for v_dispatch in
    select dispatch.id
    from public.dispatches dispatch
    join public.programming programming
      on programming.id = dispatch.programming_id
     and programming.project_id = dispatch.project_id
    join public.dispatch_reconciliations reconciliation
      on reconciliation.dispatch_id = dispatch.id
     and reconciliation.project_id = dispatch.project_id
    where programming.status = 'IN_EXECUTION'
      and dispatch.status = 'COMPLETED'
      and reconciliation.current_product_invoice_id is not null
      and reconciliation.current_service_invoice_id is not null
      and reconciliation.status = 'RECONCILED'
  loop
    perform app_private.sync_programming_completion_from_dispatch(v_dispatch.id);
  end loop;
end;
$$;

commit;
