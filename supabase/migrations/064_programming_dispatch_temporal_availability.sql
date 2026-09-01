-- 064_programming_dispatch_temporal_availability.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Derives EXPIRED for a CONFIRMED Programming whose scheduled instant passed
-- before its physical operation started. Historical rows are preserved and no
-- new persisted programming_status value is introduced.

begin;

-- ============================================================
-- 1. PRECONDITIONS / DRIFT GUARDS
-- ============================================================

do $$
begin
  if to_regclass('public.programming') is null
     or to_regclass('public.dispatches') is null then
    raise exception 'PROGRAMMING_TEMPORAL_REQUIRED_RELATION_MISSING';
  end if;

  if to_regprocedure(
    'public.create_programming_with_lines(uuid,uuid,timestamp with time zone,jsonb,text,text,boolean,uuid)'
  ) is null
     or to_regprocedure(
       'public.update_programming_with_lines(uuid,integer,uuid,timestamp with time zone,jsonb,text)'
     ) is null
     or to_regprocedure(
       'public.confirm_programming(uuid,numeric,integer,text)'
     ) is null
     or to_regprocedure(
       'public.register_dispatch_with_lines(uuid,text,text,date,text,jsonb,timestamp with time zone,timestamp with time zone,timestamp with time zone,public.dispatch_result,numeric,numeric,uuid,jsonb)'
     ) is null then
    raise exception 'PROGRAMMING_TEMPORAL_REQUIRED_RPC_MISSING';
  end if;

  if to_regprocedure(
    'app_private.programming_dispatch_availability(uuid)'
  ) is not null
     or to_regprocedure(
       'app_private.guard_programming_future_schedule()'
     ) is not null
     or to_regprocedure(
       'app_private.guard_dispatch_programming_availability()'
     ) is not null then
    raise exception 'PROGRAMMING_TEMPORAL_FUNCTION_ALREADY_EXISTS';
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (
        (c.relname = 'programming'
         and t.tgname = 'programming_future_schedule_guard')
        or
        (c.relname = 'dispatches'
         and t.tgname = 'dispatch_programming_availability_guard')
      )
      and not t.tgisinternal
  ) then
    raise exception 'PROGRAMMING_TEMPORAL_TRIGGER_ALREADY_EXISTS';
  end if;
end;
$$;

-- ============================================================
-- 2. CANONICAL DOMAIN AVAILABILITY
-- ============================================================

create function app_private.programming_dispatch_availability(
  p_programming_id uuid
)
returns table (
  raw_status public.programming_status,
  effective_status text,
  operation_started boolean,
  can_create_dispatch boolean,
  unavailable_reason text
)
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
  select
    p.status,
    case
      when p.status = 'CONFIRMED'
           and p.scheduled_at < now()
           and not started.value
        then 'EXPIRED'
      else p.status::text
    end,
    started.value,
    case
      when p.status = 'IN_EXECUTION' then true
      when p.status = 'CONFIRMED'
        then p.scheduled_at >= now() or started.value
      else false
    end,
    case
      when p.status = 'CONFIRMED'
           and p.scheduled_at < now()
           and not started.value
        then 'DISPATCH_PROGRAMMING_EXPIRED'
      when p.status not in ('CONFIRMED', 'IN_EXECUTION')
        then 'DISPATCH_PROGRAMMING_INVALID_STATE'
      else null
    end
  from public.programming p
  cross join lateral (
    select exists (
      select 1
      from public.dispatches d
      where d.programming_id = p.id
        and d.project_id = p.project_id
    ) as value
  ) started
  where p.id = p_programming_id;
$$;

alter function app_private.programming_dispatch_availability(uuid)
owner to postgres;

revoke all
on function app_private.programming_dispatch_availability(uuid)
from public, anon, authenticated;

grant execute
on function app_private.programming_dispatch_availability(uuid)
to service_role;

-- ============================================================
-- 3. FUTURE SCHEDULE AUTHORITY
-- ============================================================

create function app_private.guard_programming_future_schedule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.scheduled_at is null then
    raise exception 'PROGRAMMING_SCHEDULE_REQUIRED';
  end if;

  if tg_op = 'INSERT' and new.scheduled_at <= clock_timestamp() then
    raise exception 'PROGRAMMING_SCHEDULE_MUST_BE_FUTURE';
  end if;

  if tg_op = 'UPDATE'
     and new.scheduled_at is distinct from old.scheduled_at
     and new.scheduled_at <= clock_timestamp() then
    raise exception 'PROGRAMMING_SCHEDULE_MUST_BE_FUTURE';
  end if;

  if tg_op = 'UPDATE'
     and new.status = 'CONFIRMED'
     and old.status is distinct from new.status
     and new.scheduled_at <= clock_timestamp() then
    raise exception 'PROGRAMMING_SCHEDULE_MUST_BE_FUTURE';
  end if;

  return new;
end;
$$;

alter function app_private.guard_programming_future_schedule()
owner to postgres;

revoke all
on function app_private.guard_programming_future_schedule()
from public, anon, authenticated, service_role;

create trigger programming_future_schedule_guard
before insert or update of scheduled_at, status
on public.programming
for each row
execute function app_private.guard_programming_future_schedule();

-- ============================================================
-- 4. DISPATCH INSERT AUTHORITY
-- ============================================================

create function app_private.guard_dispatch_programming_availability()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_availability record;
begin
  select availability.*
  into v_availability
  from app_private.programming_dispatch_availability(
    new.programming_id
  ) availability;

  if not found then
    raise exception 'DISPATCH_PROGRAMMING_INVALID_STATE';
  end if;

  if not v_availability.can_create_dispatch then
    if v_availability.unavailable_reason = 'DISPATCH_PROGRAMMING_EXPIRED' then
      raise exception 'DISPATCH_PROGRAMMING_EXPIRED';
    end if;

    raise exception 'DISPATCH_PROGRAMMING_INVALID_STATE';
  end if;

  return new;
end;
$$;

alter function app_private.guard_dispatch_programming_availability()
owner to postgres;

revoke all
on function app_private.guard_dispatch_programming_availability()
from public, anon, authenticated, service_role;

-- register_dispatch_with_lines() inserts the Dispatch while holding the
-- Programming row lock. This guard therefore protects that RPC and any future
-- insertion path without duplicating the temporal rule inside each command.
create trigger dispatch_programming_availability_guard
before insert
on public.dispatches
for each row
execute function app_private.guard_dispatch_programming_availability();

-- ============================================================
-- 5. FINAL ASSERTIONS
-- ============================================================

do $$
declare
  v_definition text;
begin
  if to_regprocedure(
    'app_private.programming_dispatch_availability(uuid)'
  ) is null
     or to_regprocedure(
       'app_private.guard_programming_future_schedule()'
     ) is null
     or to_regprocedure(
       'app_private.guard_dispatch_programming_availability()'
     ) is null then
    raise exception 'PROGRAMMING_TEMPORAL_CANONICAL_FUNCTION_MISSING';
  end if;

  if exists (
    select 1
    from (
      values
        ('programming', 'programming_future_schedule_guard'),
        ('dispatches', 'dispatch_programming_availability_guard')
    ) expected(table_name, trigger_name)
    where not exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = expected.table_name
        and t.tgname = expected.trigger_name
        and t.tgenabled <> 'D'
        and not t.tgisinternal
    )
  ) then
    raise exception 'PROGRAMMING_TEMPORAL_TRIGGER_MISSING';
  end if;

  select pg_get_functiondef(
    'app_private.programming_dispatch_availability(uuid)'::regprocedure
  ) into v_definition;

  if position('EXPIRED' in v_definition) = 0
     or position('scheduled_at < now()' in v_definition) = 0
     or position('IN_EXECUTION' in v_definition) = 0
     or position('DISPATCH_PROGRAMMING_EXPIRED' in v_definition) = 0 then
    raise exception 'PROGRAMMING_TEMPORAL_AVAILABILITY_NOT_ALIGNED';
  end if;

  -- EXPIRED remains derived. The persisted enum must not be altered here.
  if exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'programming_status'
      and e.enumlabel = 'EXPIRED'
  ) then
    raise exception 'PROGRAMMING_EXPIRED_MUST_NOT_BE_PERSISTED';
  end if;
end;
$$;

-- Live QA after manual execution:
--   * future CONFIRMED accepts Dispatch registration;
--   * past CONFIRMED without Dispatch returns effective EXPIRED and rejects;
--   * past IN_EXECUTION continues to accept multiple Dispatches;
--   * COMPLETED and CANCELLED reject Dispatch insertion;
--   * remaining zero does not change status or block IN_EXECUTION;
--   * explicit close still supports exact, short and excess reception;
--   * create, reschedule and confirm with a past instant reject;
--   * all QA rows are removed or rolled back without touching history.

commit;
