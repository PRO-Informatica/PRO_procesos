-- Preserve existing periods and invoice snapshots when introducing full weeks.
begin;

alter table public.batches
  add column period_kind text not null default 'LEGACY',
  add constraint batches_period_kind_ck check (period_kind in ('LEGACY', 'WEEKLY', 'HISTORICAL'));
alter table public.batches alter column period_kind set default 'WEEKLY';

drop index public.batches_project_period_start_uq;
create unique index batches_project_period_start_uq
  on public.batches(project_id, period_start) where period_kind <> 'HISTORICAL';

create or replace function app_private.resolve_weekly_batch_period(
  p_project_id uuid, p_reference_date date default null
)
returns table(reference_date date, project_timezone text, period_start date,
  period_end date, accounting_period date)
language plpgsql stable security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_timezone text;
  v_reference date;
  v_monday date;
begin
  select timezone into v_timezone from public.projects where id = p_project_id;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_timezone) then
    v_timezone := 'America/Guatemala';
  end if;
  v_reference := coalesce(p_reference_date, (now() at time zone v_timezone)::date);
  if not isfinite(v_reference) then raise exception 'BATCH_DATE_INVALID'; end if;
  v_monday := date_trunc('week', v_reference)::date;
  return query select v_reference, v_timezone, v_monday, v_monday + 6,
    date_trunc('month', v_monday)::date;
end;
$$;

drop trigger guard_batch_month_segment on public.batches;
drop function app_private.guard_batch_month_segment();

create function app_private.guard_batch_period()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_period record;
begin
  if tg_op = 'UPDATE' and row(new.project_id, new.period_start, new.period_end, new.accounting_period, new.period_kind)
    is not distinct from row(old.project_id, old.period_start, old.period_end, old.accounting_period, old.period_kind)
  then return new; end if;
  if tg_op = 'UPDATE' and new.period_kind is distinct from old.period_kind then
    raise exception 'BATCH_PERIOD_KIND_IMMUTABLE';
  end if;
  if new.period_kind = 'LEGACY' then raise exception 'BATCH_LEGACY_PERIOD_REVIEW_REQUIRED'; end if;
  if new.period_kind = 'HISTORICAL' and (
    new.period_start is null or not isfinite(new.period_start)
    or new.period_end is null or not isfinite(new.period_end) or new.period_start > new.period_end
  ) then raise exception 'BATCH_HISTORICAL_RANGE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('batch-period:' || new.project_id::text, 0));
  select * into v_period from app_private.resolve_weekly_batch_period(new.project_id, new.period_start);
  if new.period_kind = 'HISTORICAL' then
    if new.period_end >= (now() at time zone v_period.project_timezone)::date
      or new.accounting_period is distinct from date_trunc('month', new.period_start)::date
    then raise exception 'BATCH_HISTORICAL_RANGE_INVALID'; end if;
    return new;
  end if;
  if new.period_start is distinct from v_period.period_start
     or new.period_end is distinct from v_period.period_end
     or new.accounting_period is distinct from v_period.accounting_period
  then raise exception 'BATCH_MONDAY_TO_SUNDAY_REQUIRED'; end if;
  if exists (
    select 1 from public.batches batch where batch.project_id = new.project_id
      and batch.id <> new.id and batch.period_kind <> 'HISTORICAL'
      and batch.period_start <= new.period_end and batch.period_end >= new.period_start
  ) then raise exception 'BATCH_WEEK_OR_CODE_ALREADY_EXISTS'; end if;
  if tg_op = 'INSERT' and new.creation_source = 'USER' and exists (
    select 1 from public.batches batch where batch.project_id = new.project_id
      and batch.status = 'OPEN' and batch.period_kind <> 'HISTORICAL'
      and date_trunc('week', batch.period_start)::date + 6 < (now() at time zone v_period.project_timezone)::date
      and date_trunc('week', batch.period_start)::date <> new.period_start
  ) then raise exception 'BATCH_OVERDUE_OPEN_EXISTS'; end if;
  return new;
end;
$$;

create trigger guard_batch_period
before insert or update of project_id, period_start, period_end, accounting_period, period_kind
on public.batches for each row execute function app_private.guard_batch_period();

create function app_private.create_user_batch(
  p_project_id uuid, p_code text, p_period_start date, p_period_end date, p_kind text
)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.batches%rowtype;
  v_code text := nullif(btrim(p_code), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app_private.has_project_permission(p_project_id, 'batch.create') then raise exception 'PERMISSION_DENIED'; end if;
  if v_code is null or char_length(v_code) > 80 then raise exception 'BATCH_CODE_REQUIRED'; end if;
  insert into public.batches(project_id, code, period_start, period_end, accounting_period,
    period_kind, status, creation_source, created_by)
  values (p_project_id, v_code, p_period_start, p_period_end,
    date_trunc('month', p_period_start)::date, p_kind, 'OPEN', 'USER', v_actor)
  returning * into v_batch;
  insert into public.audit_events(actor_user_id, project_id, entity_type, entity_id, action, new_values)
  values (v_actor, p_project_id, 'batch', v_batch.id, 'BATCH_CREATED', jsonb_build_object(
    'code', v_code, 'period_start', v_batch.period_start, 'period_end', v_batch.period_end,
    'accounting_period', v_batch.accounting_period, 'status', v_batch.status, 'period_kind', v_batch.period_kind));
  return v_batch.id;
exception when unique_violation then raise exception 'BATCH_WEEK_OR_CODE_ALREADY_EXISTS';
end;
$$;

create or replace function public.create_batch(
  p_project_id uuid, p_code text, p_period_start date, p_period_end date
)
returns uuid language sql security definer
set search_path = pg_catalog, public, app_private
as $$
  select app_private.create_user_batch(p_project_id, p_code, p_period_start, p_period_end, 'WEEKLY');
$$;

create function public.create_historical_batch(
  p_project_id uuid, p_code text, p_period_start date, p_period_end date
)
returns uuid language sql security definer
set search_path = pg_catalog, public, app_private
as $$
  select app_private.create_user_batch(p_project_id, p_code, p_period_start, p_period_end, 'HISTORICAL');
$$;

create or replace function public.create_weekly_batches(p_project_id uuid, p_code text, p_reference_date date)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_period record; v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app_private.has_project_permission(p_project_id, 'batch.create') then raise exception 'PERMISSION_DENIED'; end if;
  if p_reference_date is null then raise exception 'BATCH_DATE_INVALID'; end if;
  select * into v_period from app_private.resolve_weekly_batch_period(p_project_id, p_reference_date);
  v_id := public.create_batch(p_project_id, p_code, v_period.period_start, v_period.period_end);
  return jsonb_build_object('batch_id', v_id, 'batch_ids', jsonb_build_array(v_id), 'split', false);
end;
$$;

-- Legacy split weeks retain their rows and original close sequence.
create function app_private.find_operational_batch(p_project_id uuid, p_reference date)
returns public.batches language sql stable security definer
set search_path = pg_catalog, public, app_private
as $$
  select batch.* from public.batches batch
  where batch.project_id = p_project_id and batch.period_kind <> 'HISTORICAL'
    and batch.period_start <= date_trunc('week', p_reference)::date + 6
    and batch.period_end >= p_reference
  order by batch.period_start
  limit 1;
$$;

create function app_private.batch_rollover_reference(p_batch public.batches)
returns date language sql stable security definer
set search_path = pg_catalog, public, app_private
as $$
  select case
    when p_batch.period_kind = 'HISTORICAL' then null
    when p_batch.period_end < date_trunc('week', p_batch.period_end)::date + 6
      and (app_private.find_operational_batch(p_batch.project_id, p_batch.period_end + 1)).id is null
      then date_trunc('week', p_batch.period_end)::date + 7
    else p_batch.period_end + 1 end;
$$;

alter function app_private.ensure_batch_month_segment(uuid, date) rename to ensure_operational_batch;
create or replace function app_private.ensure_operational_batch(p_project_id uuid, p_reference_date date)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_period record; v_batch public.batches%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('batch-period:' || p_project_id::text, 0));
  select * into v_period from app_private.resolve_weekly_batch_period(p_project_id, p_reference_date);
  select * into v_batch from public.batches
  where id = (app_private.find_operational_batch(p_project_id, v_period.reference_date)).id for update;
  if found then
    if v_batch.status <> 'OPEN' then raise exception 'BATCH_DESTINATION_CLOSED'; end if;
    return v_batch.id;
  end if;
  if exists (
    select 1 from public.batches where project_id = p_project_id and period_kind <> 'HISTORICAL'
      and period_start <= v_period.period_end and period_end >= v_period.period_start
  ) then raise exception 'BATCH_LEGACY_PERIOD_REVIEW_REQUIRED'; end if;
  insert into public.batches(project_id, code, period_start, period_end,
    accounting_period, period_kind, status, creation_source)
  values (p_project_id, 'LOT-' || to_char(v_period.period_start, 'YYYY-MM-DD'),
    v_period.period_start, v_period.period_end, v_period.accounting_period, 'WEEKLY', 'OPEN', 'SYSTEM')
  returning * into v_batch;
  return v_batch.id;
end;
$$;

create or replace function public.ensure_weekly_batch(p_project_id uuid, p_reference_date date default null)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  return app_private.ensure_operational_batch(p_project_id, p_reference_date);
end;
$$;

create function app_private.guard_historical_batch_dispatch()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_batch public.batches%rowtype;
  v_date date;
begin
  select * into v_batch from public.batches where id = new.batch_id and project_id = new.project_id;
  if v_batch.period_kind is distinct from 'HISTORICAL' then return new; end if;
  select (programming.scheduled_at at time zone period.project_timezone)::date into v_date
  from public.dispatches dispatch
  join public.programming programming on programming.id = dispatch.programming_id
    and programming.project_id = dispatch.project_id
  cross join app_private.resolve_weekly_batch_period(v_batch.project_id, v_batch.period_start) period
  where dispatch.id = new.dispatch_id and dispatch.project_id = v_batch.project_id;
  if v_date is null or v_date not between v_batch.period_start and v_batch.period_end then
    raise exception 'BATCH_HISTORICAL_DISPATCH_DATE_INVALID';
  end if;
  return new;
end;
$$;

create trigger guard_historical_batch_dispatch
before insert or update of batch_id, dispatch_id, project_id on public.batch_dispatches
for each row execute function app_private.guard_historical_batch_dispatch();

-- Restrict historic candidates in PostgreSQL before the REST row limit.
-- The caller's existing batch, dispatch and programming read policies still apply.
create function public.get_batch_detail_dispatches(p_batch_id uuid)
returns setof public.dispatches language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select dispatch.* from public.batches batch
  join public.projects project on project.id = batch.project_id
  join public.dispatches dispatch on dispatch.project_id = batch.project_id
  left join public.programming programming on programming.id = dispatch.programming_id
    and programming.project_id = dispatch.project_id
  left join pg_timezone_names timezone on timezone.name = project.timezone
  cross join lateral (
    select exists (select 1 from public.batch_dispatches relation
      where relation.batch_id = batch.id and relation.dispatch_id = dispatch.id) as belongs_to_batch
  ) membership
  where batch.id = p_batch_id and dispatch.status in ('IN_EXECUTION', 'COMPLETED')
    and (batch.period_kind <> 'HISTORICAL' or membership.belongs_to_batch
      or (batch.status = 'OPEN' and dispatch.status = 'COMPLETED' and programming.status <> 'CANCELLED'
        and programming.scheduled_at >= (batch.period_start::timestamp at time zone coalesce(timezone.name, 'America/Guatemala'))
        and programming.scheduled_at < ((batch.period_end + 1)::timestamp at time zone coalesce(timezone.name, 'America/Guatemala'))
        and not exists (select 1 from public.batch_dispatches relation
          where relation.dispatch_id = dispatch.id and relation.removed_at is null)))
  order by membership.belongs_to_batch desc, dispatch.id;
$$;

create or replace function public.preview_weekly_batch_rollover(p_batch_id uuid)
returns table(
  batch_dispatch_id uuid, dispatch_id uuid, reconciled boolean,
  rollover_action text, rollover_reason text, destination_batch_id uuid,
  destination_period_start date, destination_period_end date, destination_accounting_period date
)
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_batch public.batches%rowtype;
  v_destination public.batches%rowtype;
  v_reference date;
  v_period record;
begin
  select * into v_batch from public.batches where id = p_batch_id;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_batch.project_id, 'batch.view') then raise exception 'PERMISSION_DENIED'; end if;
  v_reference := app_private.batch_rollover_reference(v_batch);
  if v_reference is not null then
    v_destination := app_private.find_operational_batch(v_batch.project_id, v_reference);
    if v_destination.id is null then
      select * into v_period from app_private.resolve_weekly_batch_period(v_batch.project_id, v_reference);
      v_destination.period_start := v_period.period_start;
      v_destination.period_end := v_period.period_end;
      v_destination.accounting_period := v_period.accounting_period;
    end if;
  end if;

  return query
  with billing as materialized (
    select relation.id, relation.dispatch_id, relation.added_at,
      app_private.dispatch_billing_complete(relation.dispatch_id) as complete
    from public.batch_dispatches relation
    where relation.batch_id = v_batch.id and relation.removed_at is null
  )
  select billing.id, billing.dispatch_id, billing.complete,
    case when billing.complete then 'STAY' when v_batch.period_kind = 'HISTORICAL' then 'PENDING' else 'MOVE' end,
    case when billing.complete then 'Producto y Servicio requeridos conciliados'
      else 'Pendiente de conciliación de Producto o Servicio requerido, facturas o decisiones fiscales' end,
    v_destination.id, v_destination.period_start, v_destination.period_end, v_destination.accounting_period
  from billing order by billing.added_at, billing.id;
end;
$$;

create or replace function public.rollover_weekly_batch(p_batch_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.batches%rowtype;
  v_project uuid;
  v_reference date;
  v_destination uuid;
  v_relation record;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select project_id into v_project from public.batches where id = p_batch_id;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_project, 'batch.modify') then raise exception 'PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('batch-period:' || v_project::text, 0));
  select * into v_batch from public.batches where id = p_batch_id for update;
  if v_batch.status <> 'OPEN' then raise exception 'WEEKLY_BATCH_ROLLOVER_STATE_INVALID'; end if;

  v_reference := app_private.batch_rollover_reference(v_batch);
  if v_reference is not null then
    v_destination := app_private.ensure_operational_batch(v_project, v_reference);
  end if;
  for v_relation in
    select relation.id, relation.dispatch_id from public.batch_dispatches relation
    where relation.batch_id = v_batch.id and relation.removed_at is null
      and not app_private.dispatch_billing_complete(relation.dispatch_id)
    for update
  loop
    if v_reference is null then raise exception 'BATCH_HISTORICAL_PENDING_RECONCILIATION'; end if;
    update public.batch_dispatches set removed_at = now(),
      removal_reason = 'Continuidad de período automática', rolled_to_batch_id = v_destination,
      removal_metadata = jsonb_build_object('source', 'SYSTEM_ROLLOVER') where id = v_relation.id;
    insert into public.batch_dispatches(project_id, batch_id, dispatch_id, added_by,
      assignment_source, removal_metadata)
    values (v_project, v_destination, v_relation.dispatch_id, null, 'SYSTEM',
      jsonb_build_object('source', 'SYSTEM_ROLLOVER', 'from_batch_id', v_batch.id));
  end loop;
  update public.batches set status = 'CLOSED', closed_at = now(), version = version + 1,
    updated_at = now() where id = v_batch.id;
  insert into public.audit_events(actor_user_id, project_id, entity_type, entity_id, action, new_values)
  values (v_actor, v_project, 'batch', v_batch.id,
    case when v_batch.period_kind = 'HISTORICAL' then 'HISTORICAL_BATCH_CLOSED' else 'WEEKLY_BATCH_CLOSED' end,
    jsonb_build_object('destination_batch_id', v_destination, 'period_kind', v_batch.period_kind,
      'completion_policy', 'REQUIRED_INVOICES_V1'));
  return v_destination;
end;
$$;

-- All months covered by a new batch are eligible. For the preceding month,
-- the same existing five-business-day grace still applies from the first month.
create function app_private.batch_invoice_period_end(p_batch public.batches)
returns date language sql immutable strict parallel safe
set search_path = pg_catalog
as $$
  select case when p_batch.period_kind = 'LEGACY' then p_batch.accounting_period
    else date_trunc('month', p_batch.period_end)::date end;
$$;

create function app_private.invoice_period_valid(
  p_invoice_date date, p_accounting_period date, p_received_date date, p_accounting_end date
)
returns boolean language sql immutable parallel safe
set search_path = pg_catalog, app_private
as $$
  select app_private.invoice_period_valid(p_invoice_date, p_accounting_period, p_received_date)
    or coalesce(isfinite(p_received_date) and date_trunc('month', p_invoice_date)::date
      between p_accounting_period and p_accounting_end, false);
$$;

create or replace function app_private.guard_invoice_accounting_period()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_batch public.batches%rowtype; v_period record;
begin
  select batch.* into v_batch from public.batch_dispatches relation
  join public.batches batch on batch.id = relation.batch_id
  where relation.dispatch_id = new.dispatch_id and relation.project_id = new.project_id
    and relation.removed_at is null and batch.status = 'OPEN' for update of batch;
  if not found then raise exception 'INVOICE_BATCH_CONTEXT_INVALID'; end if;
  select * into v_period from app_private.resolve_weekly_batch_period(new.project_id, null);
  if not app_private.invoice_period_valid(new.invoice_date, v_batch.accounting_period,
    (clock_timestamp() at time zone v_period.project_timezone)::date,
    app_private.batch_invoice_period_end(v_batch)) then
    raise exception 'INVOICE_ACCOUNTING_PERIOD_MISMATCH';
  end if;
  return new;
end;
$$;

-- Preserve the original invoice period decision on extraction updates.
create or replace function app_private.snapshot_invoice_accounting_period()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_invoice public.invoices%rowtype;
  v_batch public.batches%rowtype;
  v_period record;
  v_received timestamptz := clock_timestamp();
  v_date date;
  v_snapshot jsonb;
  v_valid boolean;
  v_last_month date;
begin
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then raise exception 'INVOICE_CONTEXT_IMMUTABLE'; end if;
  select * into v_invoice from public.invoices where id = new.invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if (new.normalized_payload ->> 'invoice_date') is distinct from v_invoice.invoice_date::text
     or (new.corrected_payload is not null and
       (new.corrected_payload ->> 'invoice_date') is distinct from v_invoice.invoice_date::text) then
    raise exception 'INVOICE_DATE_MISMATCH';
  end if;
  if tg_op = 'UPDATE' then
    v_snapshot := old.normalized_payload -> 'period_validation';
    v_valid := coalesce((old.normalized_payload -> 'validations' ->> 'period_valid')::boolean, false);
  else
    select batch.* into v_batch from public.batch_dispatches relation
    join public.batches batch on batch.id = relation.batch_id
    where relation.dispatch_id = v_invoice.dispatch_id and relation.project_id = v_invoice.project_id
      and relation.removed_at is null and batch.status = 'OPEN' for update of batch;
    if not found then raise exception 'INVOICE_BATCH_CONTEXT_INVALID'; end if;
    select * into v_period from app_private.resolve_weekly_batch_period(v_invoice.project_id, null);
    v_date := (v_received at time zone v_period.project_timezone)::date;
    v_last_month := app_private.batch_invoice_period_end(v_batch);
    v_valid := app_private.invoice_period_valid(v_invoice.invoice_date, v_batch.accounting_period, v_date, v_last_month);
    if not v_valid then raise exception 'INVOICE_ACCOUNTING_PERIOD_MISMATCH'; end if;
    v_snapshot := jsonb_build_object('policy',
      case when v_batch.period_kind = 'LEGACY' then 'FIVE_BUSINESS_DAYS_V1' else 'BATCH_MONTHS_FIVE_BUSINESS_DAYS_V2' end,
      'batch_id', v_batch.id, 'invoice_date', v_invoice.invoice_date,
      'accounting_period', v_batch.accounting_period, 'received_at', v_received,
      'received_date', v_date, 'timezone', v_period.project_timezone,
      'grace_used', date_trunc('month', v_invoice.invoice_date)::date < v_batch.accounting_period,
      'grace_deadline', app_private.fifth_business_day(v_batch.accounting_period));
    if v_batch.period_kind <> 'LEGACY' then
      v_snapshot := v_snapshot || jsonb_build_object('accounting_period_end', v_last_month);
    end if;
  end if;
  new.normalized_payload := new.normalized_payload || jsonb_build_object(
    'validations', coalesce(new.normalized_payload -> 'validations', '{}'::jsonb) || jsonb_build_object('period_valid', v_valid),
    'period_validation', v_snapshot);
  if new.corrected_payload is not null then
    new.corrected_payload := new.corrected_payload || jsonb_build_object(
      'validations', coalesce(new.corrected_payload -> 'validations', '{}'::jsonb) || jsonb_build_object('period_valid', v_valid),
      'period_validation', v_snapshot);
  end if;
  return new;
end;
$$;

alter function app_private.guard_batch_period() owner to postgres;
alter function app_private.create_user_batch(uuid,text,date,date,text) owner to postgres;
alter function app_private.find_operational_batch(uuid,date) owner to postgres;
alter function app_private.batch_rollover_reference(public.batches) owner to postgres;
alter function app_private.guard_historical_batch_dispatch() owner to postgres;
alter function app_private.batch_invoice_period_end(public.batches) owner to postgres;
alter function app_private.invoice_period_valid(date,date,date,date) owner to postgres;
revoke all on function app_private.guard_batch_period(),
  app_private.create_user_batch(uuid,text,date,date,text), app_private.find_operational_batch(uuid,date),
  app_private.batch_rollover_reference(public.batches), app_private.guard_historical_batch_dispatch(),
  app_private.batch_invoice_period_end(public.batches), app_private.invoice_period_valid(date,date,date,date)
  from public, anon, authenticated, service_role;

alter function public.create_historical_batch(uuid,text,date,date) owner to postgres;
revoke all on function public.create_historical_batch(uuid,text,date,date) from public, anon;
grant execute on function public.create_historical_batch(uuid,text,date,date) to authenticated, service_role;
alter function public.get_batch_detail_dispatches(uuid) owner to postgres;
revoke all on function public.get_batch_detail_dispatches(uuid) from public, anon;
grant execute on function public.get_batch_detail_dispatches(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
