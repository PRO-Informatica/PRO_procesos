-- Weekly batches are split at month boundaries. No automatic closing/scheduler.
-- Existing dates, memberships, invoices and reconciliation history are preserved.
-- Forward migration: do not restore the old weekly CHECK after monthly rows exist.
begin;

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
  v_month date;
  v_monday date;
begin
  select timezone into v_timezone from public.projects where id = p_project_id;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_timezone) then
    v_timezone := 'America/Guatemala';
  end if;
  v_reference := coalesce(p_reference_date, (now() at time zone v_timezone)::date);
  if not isfinite(v_reference) then raise exception 'BATCH_DATE_INVALID'; end if;
  v_month := date_trunc('month', v_reference)::date;
  v_monday := date_trunc('week', v_reference)::date;
  return query select v_reference, v_timezone,
    greatest(v_monday, v_month),
    least(v_monday + 6, (v_month + interval '1 month')::date - 1), v_month;
end;
$$;

-- A trigger enforces the new canonical period on every NEW/changed period.
-- Unlike a blanket replacement CHECK, it does not invalidate historical
-- cross-month batches when only their status is changed at manual close.
alter table public.batches drop constraint batches_week_exact_ck;

create function app_private.guard_batch_month_segment()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_period record;
begin
  perform pg_advisory_xact_lock(hashtextextended('batch-period:' || new.project_id::text, 0));
  select * into v_period from app_private.resolve_weekly_batch_period(new.project_id, new.period_start);
  if new.period_start is distinct from v_period.period_start
     or new.period_end is distinct from v_period.period_end
     or new.accounting_period is distinct from v_period.accounting_period then
    raise exception 'BATCH_MONTH_SEGMENT_INVALID';
  end if;
  -- The overdue guard uses actual project-local today, not the selected date.
  if tg_op = 'INSERT' and new.creation_source = 'USER' and exists (
    select 1 from public.batches batch
    where batch.project_id = new.project_id and batch.status = 'OPEN'
      and date_trunc('week', batch.period_start)::date + 6 < (now() at time zone v_period.project_timezone)::date
      and date_trunc('week', batch.period_start) <> date_trunc('week', new.period_start)
  ) then raise exception 'BATCH_OVERDUE_OPEN_EXISTS'; end if;
  return new;
end;
$$;

create trigger guard_batch_month_segment
before insert or update of project_id, period_start, period_end, accounting_period
on public.batches for each row execute function app_private.guard_batch_month_segment();

create or replace function public.create_batch(
  p_project_id uuid, p_code text, p_period_start date, p_period_end date
)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_period record;
  v_batch_id uuid;
  v_code text := nullif(btrim(p_code), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app_private.has_project_permission(p_project_id, 'batch.create') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_code is null or char_length(v_code) > 80 then raise exception 'BATCH_CODE_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('batch-period:' || p_project_id::text, 0));
  select * into v_period from app_private.resolve_weekly_batch_period(p_project_id, p_period_start);
  if p_period_start is null or p_period_end is null
     or p_period_start <> v_period.period_start or p_period_end <> v_period.period_end then
    raise exception 'BATCH_MONTH_SEGMENT_INVALID';
  end if;
  insert into public.batches(project_id, code, period_start, period_end,
    accounting_period, status, creation_source, created_by)
  values (p_project_id, v_code, v_period.period_start, v_period.period_end,
    v_period.accounting_period, 'OPEN', 'USER', v_actor) returning id into v_batch_id;
  insert into public.audit_events(actor_user_id, project_id, entity_type, entity_id, action, new_values)
  values (v_actor, p_project_id, 'batch', v_batch_id, 'BATCH_CREATED', jsonb_build_object(
    'code', v_code, 'period_start', v_period.period_start, 'period_end', v_period.period_end,
    'accounting_period', v_period.accounting_period, 'status', 'OPEN', 'period_policy', 'MONTH_SEGMENT_V1'));
  return v_batch_id;
exception when unique_violation then raise exception 'BATCH_WEEK_OR_CODE_ALREADY_EXISTS';
end;
$$;

-- Both parts are created together or neither is created. The normal create RPC
-- remains safe for direct calls: canonical dates and overdue guards still apply.
create function public.create_weekly_batches(p_project_id uuid, p_code text, p_reference_date date)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_cursor date;
  v_sunday date;
  v_period record;
  v_split boolean;
  v_id uuid;
  v_selected uuid;
  v_ids uuid[] := '{}';
  v_code text := nullif(btrim(p_code), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app_private.has_project_permission(p_project_id, 'batch.create') then raise exception 'PERMISSION_DENIED'; end if;
  if p_reference_date is null or not isfinite(p_reference_date) then raise exception 'BATCH_DATE_INVALID'; end if;
  if v_code is null or char_length(v_code) > 70 then raise exception 'BATCH_CODE_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('batch-period:' || p_project_id::text, 0));
  v_cursor := date_trunc('week', p_reference_date)::date;
  v_sunday := v_cursor + 6;
  v_split := date_trunc('month', v_cursor) <> date_trunc('month', v_sunday);
  while v_cursor <= v_sunday loop
    select * into v_period from app_private.resolve_weekly_batch_period(p_project_id, v_cursor);
    v_id := public.create_batch(p_project_id,
      v_code || case when v_split then '-' || to_char(v_cursor, 'YYYY-MM') else '' end,
      v_period.period_start, v_period.period_end);
    v_ids := array_append(v_ids, v_id);
    if p_reference_date between v_period.period_start and v_period.period_end then v_selected := v_id; end if;
    v_cursor := v_period.period_end + 1;
  end loop;
  return jsonb_build_object('batch_id', v_selected, 'batch_ids', v_ids, 'split', v_split);
end;
$$;

create function app_private.ensure_batch_month_segment(p_project_id uuid, p_reference_date date)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_period record; v_batch public.batches%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('batch-period:' || p_project_id::text, 0));
  select * into v_period from app_private.resolve_weekly_batch_period(p_project_id, p_reference_date);
  select * into v_batch from public.batches where project_id = p_project_id
    and period_start = v_period.period_start for update;
  if found then
    if v_batch.status <> 'OPEN' then raise exception 'BATCH_DESTINATION_CLOSED'; end if;
    if v_batch.period_end <> v_period.period_end or v_batch.accounting_period <> v_period.accounting_period then
      raise exception 'BATCH_LEGACY_PERIOD_REVIEW_REQUIRED';
    end if;
    return v_batch.id;
  end if;
  insert into public.batches(project_id, code, period_start, period_end,
    accounting_period, status, creation_source, created_by)
  values (p_project_id, 'LOT-' || to_char(v_period.period_start, 'YYYY-MM-DD'),
    v_period.period_start, v_period.period_end, v_period.accounting_period, 'OPEN', 'SYSTEM', null)
  returning * into v_batch;
  return v_batch.id;
end;
$$;

create or replace function public.ensure_weekly_batch(p_project_id uuid, p_reference_date date default null)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare v_period record; v_cursor date; v_sunday date; v_id uuid; v_selected uuid; v_reference date;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  select * into v_period from app_private.resolve_weekly_batch_period(p_project_id, p_reference_date);
  v_reference := v_period.reference_date;
  v_cursor := date_trunc('week', v_reference)::date;
  v_sunday := v_cursor + 6;
  while v_cursor <= v_sunday loop
    select * into v_period from app_private.resolve_weekly_batch_period(p_project_id, v_cursor);
    v_id := app_private.ensure_batch_month_segment(p_project_id, v_cursor);
    if v_reference between v_period.period_start and v_period.period_end then v_selected := v_id; end if;
    v_cursor := v_period.period_end + 1;
  end loop;
  return v_selected;
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
  v_period record;
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
  select * into v_period from app_private.resolve_weekly_batch_period(v_project, v_batch.period_end + 1);
  v_destination := app_private.ensure_batch_month_segment(v_project, v_period.period_start);
  -- If the next week crosses a month, prepare its second part too. Closing the
  -- first part later reuses the already-open second part without duplicating it.
  if v_period.period_end < date_trunc('week', v_period.period_start)::date + 6 then
    perform app_private.ensure_batch_month_segment(v_project, v_period.period_end + 1);
  end if;
  for v_relation in
    select relation.* from public.batch_dispatches relation
    left join public.dispatch_reconciliations reconciliation on reconciliation.dispatch_id = relation.dispatch_id
    where relation.batch_id = v_batch.id and relation.removed_at is null
      and coalesce(reconciliation.status::text, '') <> 'RECONCILED'
    for update of relation
  loop
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
  values (v_actor, v_project, 'batch', v_batch.id, 'WEEKLY_BATCH_CLOSED',
    jsonb_build_object('destination_batch_id', v_destination, 'period_policy', 'MONTH_SEGMENT_V1'));
  return v_destination;
end;
$$;

create function app_private.fifth_business_day(p_month date)
returns date language plpgsql immutable strict parallel safe
set search_path = pg_catalog
as $$
declare v_day date := date_trunc('month', p_month)::date; v_count integer := 0;
begin
  if not isfinite(p_month) then raise exception 'INVALID_CALENDAR_DATE'; end if;
  loop
    if extract(isodow from v_day) between 1 and 5 then v_count := v_count + 1; end if;
    if v_count = 5 then return v_day; end if;
    v_day := v_day + 1;
  end loop;
end;
$$;

create function app_private.invoice_period_valid(p_invoice_date date, p_accounting_period date, p_received_date date)
returns boolean language sql immutable parallel safe
set search_path = pg_catalog, app_private
as $$
  select coalesce(isfinite(p_invoice_date) and isfinite(p_accounting_period) and isfinite(p_received_date) and (
    date_trunc('month', p_invoice_date) = date_trunc('month', p_accounting_period)
    or (
      date_trunc('month', p_invoice_date) = date_trunc('month', p_accounting_period) - interval '1 month'
      and p_received_date between date_trunc('month', p_accounting_period)::date
        and app_private.fifth_business_day(p_accounting_period)
    )
  ), false);
$$;

-- Reject expired/foreign-month invoices before preparing a Storage upload.
-- The receipt clock is always obtained by Postgres, never accepted from a client.
create function app_private.guard_invoice_accounting_period()
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
    (clock_timestamp() at time zone v_period.project_timezone)::date) then
    raise exception 'INVOICE_ACCOUNTING_PERIOD_MISMATCH';
  end if;
  return new;
end;
$$;
create trigger guard_invoice_accounting_period before insert
on public.invoices for each row execute function app_private.guard_invoice_accounting_period();

-- Freeze the successful processing time/decision, so reconciliation after the
-- fifth business day does not revoke a timely accepted invoice. Do not rewrite
-- historical extractions. Corrections cannot forge period_valid or its snapshot.
create function app_private.snapshot_invoice_accounting_period()
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
    v_valid := app_private.invoice_period_valid(v_invoice.invoice_date, v_batch.accounting_period, v_date);
    if not v_valid then raise exception 'INVOICE_ACCOUNTING_PERIOD_MISMATCH'; end if;
    v_snapshot := jsonb_build_object('policy', 'FIVE_BUSINESS_DAYS_V1',
      'batch_id', v_batch.id, 'invoice_date', v_invoice.invoice_date,
      'accounting_period', v_batch.accounting_period, 'received_at', v_received,
      'received_date', v_date, 'timezone', v_period.project_timezone,
      'grace_used', date_trunc('month', v_invoice.invoice_date)::date <> v_batch.accounting_period,
      'grace_deadline', app_private.fifth_business_day(v_batch.accounting_period));
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
create trigger snapshot_invoice_accounting_period
before insert or update of invoice_id, normalized_payload, corrected_payload
on public.invoice_extractions for each row execute function app_private.snapshot_invoice_accounting_period();

alter function app_private.guard_batch_month_segment() owner to postgres;
alter function app_private.ensure_batch_month_segment(uuid,date) owner to postgres;
alter function app_private.fifth_business_day(date) owner to postgres;
alter function app_private.invoice_period_valid(date,date,date) owner to postgres;
alter function app_private.guard_invoice_accounting_period() owner to postgres;
alter function app_private.snapshot_invoice_accounting_period() owner to postgres;
alter function public.create_weekly_batches(uuid,text,date) owner to postgres;
revoke all on function app_private.guard_batch_month_segment(),
  app_private.ensure_batch_month_segment(uuid,date), app_private.fifth_business_day(date),
  app_private.invoice_period_valid(date,date,date), app_private.guard_invoice_accounting_period(),
  app_private.snapshot_invoice_accounting_period() from public, anon, authenticated, service_role;
revoke all on function public.create_weekly_batches(uuid,text,date) from public, anon;
grant execute on function public.create_weekly_batches(uuid,text,date) to authenticated, service_role;

commit;
