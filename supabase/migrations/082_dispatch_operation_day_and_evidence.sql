-- 082_dispatch_operation_day_and_evidence.sql
-- APPLIED CORRECTLY — EXECUTED ON 2026-09-03.
--
-- Anchors Dispatch arrival/departure times to the Programming calendar day,
-- requires uploaded evidence before completion and provides one atomic RPC
-- that saves the current form values before completing the Dispatch.

begin;

do $$
begin
  if to_regclass('public.dispatches') is null
     or to_regclass('public.dispatch_documents') is null
     or to_regclass('public.dispatch_guides') is null
     or to_regclass('public.dispatch_incidents') is null
     or to_regclass('public.document_versions') is null
     or to_regprocedure('public.update_dispatch(uuid,integer,timestamp with time zone,timestamp with time zone,text,public.dispatch_result,text,numeric,text)') is null
     or to_regprocedure('public.complete_dispatch(uuid,integer)') is null then
    raise exception 'DISPATCH_TIME_EVIDENCE_REQUIRED_CONTRACT_MISSING';
  end if;
end;
$$;

create or replace function app_private.guard_dispatch_programming_day()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_timezone text;
  v_programming_date date;
begin
  select
    coalesce(nullif(btrim(project.timezone), ''), 'America/Guatemala'),
    (programming.scheduled_at at time zone coalesce(
      nullif(btrim(project.timezone), ''), 'America/Guatemala'
    ))::date
  into v_timezone, v_programming_date
  from public.programming programming
  join public.projects project on project.id = programming.project_id
  where programming.id = new.programming_id
    and programming.project_id = new.project_id;

  if not found then
    raise exception 'DISPATCH_PROGRAMMING_CONTEXT_INVALID';
  end if;
  if new.arrival_at is null then
    raise exception 'DISPATCH_ARRIVAL_REQUIRED';
  end if;
  if (new.arrival_at at time zone v_timezone)::date <> v_programming_date then
    raise exception 'DISPATCH_ARRIVAL_DATE_MISMATCH';
  end if;
  if new.departure_at is not null
     and (new.departure_at at time zone v_timezone)::date <> v_programming_date then
    raise exception 'DISPATCH_DEPARTURE_DATE_MISMATCH';
  end if;
  if new.departure_at is not null and new.departure_at < new.arrival_at then
    raise exception 'DISPATCH_INVALID_TIME_SEQUENCE';
  end if;
  return new;
end;
$$;

alter function app_private.guard_dispatch_programming_day() owner to postgres;
revoke all on function app_private.guard_dispatch_programming_day()
from public, anon, authenticated, service_role;

drop trigger if exists dispatches_programming_day_guard on public.dispatches;
create trigger dispatches_programming_day_guard
before insert or update of programming_id, project_id, arrival_at, departure_at
on public.dispatches
for each row execute function app_private.guard_dispatch_programming_day();

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
              and nullif(btrim(line.product_code), '') is not null
              and nullif(btrim(line.product_description), '') is not null
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

create or replace function public.finalize_dispatch(
  p_dispatch_id uuid,
  p_expected_version integer,
  p_arrival_at timestamptz,
  p_departure_at timestamptz,
  p_received_by_name text,
  p_result public.dispatch_result,
  p_order_number text,
  p_real_volume numeric,
  p_real_unit_code text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_saved_version integer;
begin
  v_saved_version := public.update_dispatch(
    p_dispatch_id,
    p_expected_version,
    p_arrival_at,
    p_departure_at,
    p_received_by_name,
    p_result,
    p_order_number,
    p_real_volume,
    p_real_unit_code
  );
  return public.complete_dispatch(p_dispatch_id, v_saved_version);
end;
$$;

alter function public.complete_dispatch(uuid,integer) owner to postgres;
alter function public.finalize_dispatch(
  uuid,integer,timestamptz,timestamptz,text,
  public.dispatch_result,text,numeric,text
) owner to postgres;

revoke all on function public.finalize_dispatch(
  uuid,integer,timestamptz,timestamptz,text,
  public.dispatch_result,text,numeric,text
) from public, anon;
grant execute on function public.finalize_dispatch(
  uuid,integer,timestamptz,timestamptz,text,
  public.dispatch_result,text,numeric,text
) to authenticated, service_role;

do $$
declare
  v_complete_definition text;
begin
  select pg_get_functiondef(
    'public.complete_dispatch(uuid,integer)'::regprocedure
  ) into v_complete_definition;

  if position('DISPATCH_EVIDENCE_REQUIRED' in v_complete_definition) = 0
     or to_regprocedure(
       'public.finalize_dispatch(uuid,integer,timestamp with time zone,timestamp with time zone,text,public.dispatch_result,text,numeric,text)'
     ) is null
     or not exists (
       select 1 from pg_trigger trigger_definition
       where trigger_definition.tgrelid = 'public.dispatches'::regclass
         and trigger_definition.tgname = 'dispatches_programming_day_guard'
         and not trigger_definition.tgisinternal
     ) then
    raise exception 'DISPATCH_TIME_EVIDENCE_CONTRACT_NOT_ALIGNED';
  end if;
end;
$$;

commit;

-- Live QA after manual execution:
--   * arrival and departure use the Programming day in the Project timezone;
--   * another calendar day is rejected by the Dispatch trigger;
--   * Finalize saves the submitted form and completes it atomically;
--   * completion without at least one uploaded Evidence is rejected;
--   * a failed completion leaves the Dispatch in its previous state.
