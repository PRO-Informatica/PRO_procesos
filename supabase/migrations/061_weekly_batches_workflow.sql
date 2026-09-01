-- 061_weekly_batches_workflow.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Operational Phase 8, Migration B only.
-- Defines canonical project-local weekly periods, manual Guide assignment and
-- removal, and protected SYSTEM rollover into READY_FOR_REVIEW.
--
-- Known configuration gap deliberately left unchanged:
-- the current model has no reliable per-Guide flag saying whether a billable
-- SERVICE invoice is required. programming.requires_pumping is operational,
-- not an invoicing obligation, and template presence is not a per-dispatch
-- rule. Therefore this migration does NOT replace or weaken
-- app_private.guide_ready_for_batch(uuid, uuid). That decision belongs to the
-- invoice/configuration phase after the missing business signal is modeled.

begin;

-- ============================================================
-- 1. PRECONDITIONS / SECURITY HANDOFF / DRIFT GUARDS
-- ============================================================

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.create_batch(uuid,text,date,date)',
    'public.add_guide_to_batch(uuid,uuid)',
    'public.remove_guide_from_batch(uuid,uuid)',
    'public.ensure_weekly_batch(uuid,date)',
    'public.rollover_weekly_batch(uuid)',
    'app_private.guide_ready_for_batch(uuid,uuid)',
    'app_private.has_project_permission(uuid,text)'
  ]
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'WEEKLY_BATCH_WORKFLOW_REQUIRED_RPC_MISSING: %',
        v_signature;
    end if;
  end loop;

  if to_regclass('public.batches') is null
     or to_regclass('public.batch_guides') is null
     or to_regclass('public.dispatch_guides') is null
     or to_regclass('public.dispatches') is null
     or to_regclass('public.projects') is null
     or to_regclass('public.audit_events') is null then
    raise exception 'WEEKLY_BATCH_WORKFLOW_REQUIRED_RELATION_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'projects'
      and c.column_name = 'timezone'
  ) then
    raise exception 'WEEKLY_BATCH_PROJECT_TIMEZONE_COLUMN_MISSING';
  end if;

  -- Migration 060 must be applied first. Browser table mutation and SYSTEM
  -- RPC execution are not accepted merely because RLS would currently block
  -- them.
  if has_table_privilege('authenticated', 'public.batches', 'INSERT')
     or has_table_privilege('authenticated', 'public.batches', 'UPDATE')
     or has_table_privilege('authenticated', 'public.batch_guides', 'INSERT')
     or has_table_privilege('authenticated', 'public.batch_guides', 'UPDATE')
     or has_function_privilege(
       'authenticated', 'public.ensure_weekly_batch(uuid,date)', 'EXECUTE'
     )
     or has_function_privilege(
       'authenticated', 'public.rollover_weekly_batch(uuid)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.ensure_weekly_batch(uuid,date)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.rollover_weekly_batch(uuid)', 'EXECUTE'
     ) then
    raise exception 'WEEKLY_BATCH_SECURITY_MIGRATION_060_REQUIRED';
  end if;

  if to_regprocedure(
    'app_private.resolve_weekly_batch_period(uuid,date)'
  ) is not null
     or to_regprocedure(
       'public.preview_weekly_batch_rollover(uuid)'
     ) is not null then
    raise exception 'WEEKLY_BATCH_WORKFLOW_NEW_FUNCTION_ALREADY_EXISTS';
  end if;

  if exists (
    select 1
    from public.batches b
    group by b.project_id, b.period_start
    having count(*) > 1
  ) then
    raise exception 'WEEKLY_BATCH_DUPLICATE_PROJECT_WEEK_REQUIRES_REVIEW';
  end if;

  if exists (
    select 1
    from public.batches b
    where extract(isodow from b.period_start) <> 1
       or extract(isodow from b.period_end) <> 7
       or b.period_end <> b.period_start + 6
       or b.accounting_period <> date_trunc(
         'month',
         case
           when date_trunc('month', b.period_start)
                <> date_trunc('month', b.period_end)
             then b.period_end
           else b.period_start
         end
       )::date
  ) then
    raise exception 'WEEKLY_BATCH_EXISTING_PERIOD_REQUIRES_REVIEW';
  end if;
end;
$$;

-- ============================================================
-- 2. CANONICAL WEEK AND ACCOUNTING PERIOD
-- ============================================================

create function app_private.resolve_weekly_batch_period(
  p_project_id uuid,
  p_reference_date date default null
)
returns table (
  reference_date date,
  project_timezone text,
  period_start date,
  period_end date,
  accounting_period date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_timezone text;
  v_reference_date date;
  v_period_start date;
  v_period_end date;
begin
  select nullif(btrim(p.timezone), '')
  into v_timezone
  from public.projects p
  where p.id = p_project_id;

  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_timezone is null
     or not exists (
       select 1
       from pg_timezone_names z
       where z.name = v_timezone
     ) then
    v_timezone := 'America/Guatemala';
  end if;

  v_reference_date := coalesce(
    p_reference_date,
    (now() at time zone v_timezone)::date
  );
  v_period_start := date_trunc('week', v_reference_date)::date;
  v_period_end := v_period_start + 6;

  return query
  select
    v_reference_date,
    v_timezone,
    v_period_start,
    v_period_end,
    date_trunc(
      'month',
      case
        when date_trunc('month', v_period_start)
             <> date_trunc('month', v_period_end)
          then v_period_end
        else v_period_start
      end
    )::date;
end;
$$;

alter function app_private.resolve_weekly_batch_period(uuid,date)
owner to postgres;

revoke all
on function app_private.resolve_weekly_batch_period(uuid,date)
from public, anon, authenticated;

grant execute
on function app_private.resolve_weekly_batch_period(uuid,date)
to service_role;

alter table public.batches
add constraint batches_week_exact_ck
check (
  extract(isodow from period_start) = 1
  and extract(isodow from period_end) = 7
  and period_end = period_start + 6
  and accounting_period = date_trunc(
    'month',
    case
      when date_trunc('month', period_start)
           <> date_trunc('month', period_end)
        then period_end
      else period_start
    end
  )::date
);

create unique index batches_project_period_start_uq
on public.batches(project_id, period_start);

-- ============================================================
-- 3. CORRECTED HUMAN BATCH CREATION
-- ============================================================

create or replace function public.create_batch(
  p_project_id uuid,
  p_code text,
  p_period_start date,
  p_period_end date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid;
  v_period record;
  v_batch_id uuid;
  v_code text := nullif(btrim(p_code), '');
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not app_private.has_project_permission(p_project_id, 'batch.create') then
    raise exception 'PERMISSION_DENIED';
  end if;

  if v_code is null then
    raise exception 'BATCH_CODE_REQUIRED';
  end if;

  if p_period_start is null or p_period_end is null then
    raise exception 'BATCH_PERIOD_REQUIRED';
  end if;

  select resolved.*
  into v_period
  from app_private.resolve_weekly_batch_period(
    p_project_id,
    p_period_start
  ) resolved;

  if p_period_start <> v_period.period_start
     or p_period_end <> v_period.period_end then
    raise exception 'BATCH_PERIOD_MUST_BE_MONDAY_TO_SUNDAY';
  end if;

  select p.company_id
  into v_company_id
  from public.projects p
  where p.id = p_project_id
    and p.status = 'ACTIVE';

  if not found then
    raise exception 'BATCH_PROJECT_INACTIVE';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_project_id::text || ':' || v_period.period_start::text,
      0
    )
  );

  if exists (
    select 1
    from public.batches b
    where b.project_id = p_project_id
      and b.period_start = v_period.period_start
  ) then
    raise exception 'BATCH_WEEK_ALREADY_EXISTS';
  end if;

  insert into public.batches (
    project_id,
    code,
    period_start,
    period_end,
    accounting_period,
    status,
    creation_source,
    created_by
  )
  values (
    p_project_id,
    v_code,
    v_period.period_start,
    v_period.period_end,
    v_period.accounting_period,
    'ASSEMBLING',
    'USER',
    v_actor
  )
  returning id into v_batch_id;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    new_values
  )
  values (
    v_actor,
    v_company_id,
    p_project_id,
    'batch',
    v_batch_id,
    'BATCH_CREATED',
    jsonb_build_object(
      'batch_id', v_batch_id,
      'code', v_code,
      'period_start', v_period.period_start,
      'period_end', v_period.period_end,
      'accounting_period', v_period.accounting_period,
      'creation_source', 'USER'
    )
  );

  return v_batch_id;
exception
  when unique_violation then
    raise exception 'BATCH_WEEK_OR_CODE_ALREADY_EXISTS';
end;
$$;

alter function public.create_batch(uuid,text,date,date)
owner to postgres;

revoke all on function public.create_batch(uuid,text,date,date)
from public, anon;
grant execute on function public.create_batch(uuid,text,date,date)
to authenticated, service_role;

-- ============================================================
-- 4. MANUAL GUIDE ASSIGNMENT
-- ============================================================

create or replace function public.add_guide_to_batch(
  p_batch_id uuid,
  p_guide_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.batches%rowtype;
  v_guide public.dispatch_guides%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_company_id uuid;
  v_relation_id uuid;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select b.*
  into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'BATCH_NOT_FOUND';
  end if;

  if v_batch.status not in ('DRAFT', 'ASSEMBLING') then
    raise exception 'BATCH_NOT_EDITABLE';
  end if;

  if not app_private.has_project_permission(
    v_batch.project_id,
    'batch.add_guide'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  select dg.*
  into v_guide
  from public.dispatch_guides dg
  where dg.id = p_guide_id
    and dg.project_id = v_batch.project_id
  for update;

  if not found then
    raise exception 'BATCH_GUIDE_CONTEXT_INVALID';
  end if;

  select d.*
  into v_dispatch
  from public.dispatches d
  where d.id = v_guide.dispatch_id
    and d.project_id = v_guide.project_id
  for update;

  if not found then
    raise exception 'BATCH_DISPATCH_CONTEXT_INVALID';
  end if;

  if v_dispatch.status <> 'REGISTERED' then
    raise exception 'BATCH_GUIDE_DISPATCH_NOT_REGISTERED';
  end if;

  if v_guide.guide_date < v_batch.period_start
     or v_guide.guide_date > v_batch.period_end then
    raise exception 'BATCH_GUIDE_DATE_OUTSIDE_WEEK';
  end if;

  -- Physical result is intentionally not an eligibility filter. COMPLETE,
  -- PARTIAL, RETURNED, REJECTED, NOT_DISPATCHED and CANCELLED may all require
  -- later administrative or accounting treatment.
  if exists (
    select 1
    from public.batch_guides bg
    where bg.guide_id = p_guide_id
      and bg.removed_at is null
  ) then
    raise exception 'GUIDE_ALREADY_IN_ACTIVE_BATCH';
  end if;

  insert into public.batch_guides (
    project_id,
    batch_id,
    guide_id,
    added_by,
    assignment_source
  )
  values (
    v_batch.project_id,
    v_batch.id,
    v_guide.id,
    v_actor,
    'USER'
  )
  returning id into v_relation_id;

  update public.dispatches
  set status = 'BATCHED',
      updated_at = now()
  where id = v_dispatch.id
    and status = 'REGISTERED';

  if not found then
    raise exception 'BATCH_GUIDE_DISPATCH_STATUS_CHANGED';
  end if;

  select p.company_id
  into v_company_id
  from public.projects p
  where p.id = v_batch.project_id;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    new_values
  )
  values (
    v_actor,
    v_company_id,
    v_batch.project_id,
    'batch_guide',
    v_relation_id,
    'GUIDE_ADDED_TO_BATCH',
    jsonb_build_object(
      'batch_id', v_batch.id,
      'guide_id', v_guide.id,
      'dispatch_id', v_dispatch.id,
      'assignment_source', 'USER',
      'previous_dispatch_status', 'REGISTERED',
      'new_dispatch_status', 'BATCHED'
    )
  );

  return v_relation_id;
exception
  when unique_violation then
    raise exception 'GUIDE_ALREADY_IN_ACTIVE_BATCH';
end;
$$;

alter function public.add_guide_to_batch(uuid,uuid)
owner to postgres;

revoke all on function public.add_guide_to_batch(uuid,uuid)
from public, anon;
grant execute on function public.add_guide_to_batch(uuid,uuid)
to authenticated, service_role;

-- ============================================================
-- 5. HUMAN REMOVAL WITH REQUIRED REASON
-- ============================================================

drop function public.remove_guide_from_batch(uuid,uuid);

create function public.remove_guide_from_batch(
  p_batch_id uuid,
  p_guide_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.batches%rowtype;
  v_guide public.dispatch_guides%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_relation public.batch_guides%rowtype;
  v_company_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_new_dispatch_status text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'BATCH_GUIDE_REMOVAL_REASON_INVALID';
  end if;

  select b.*
  into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'BATCH_NOT_FOUND';
  end if;

  if v_batch.status not in ('DRAFT', 'ASSEMBLING') then
    raise exception 'BATCH_NOT_EDITABLE';
  end if;

  if not app_private.has_project_permission(
    v_batch.project_id,
    'batch.modify'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  select bg.*
  into v_relation
  from public.batch_guides bg
  where bg.batch_id = v_batch.id
    and bg.guide_id = p_guide_id
    and bg.project_id = v_batch.project_id
    and bg.removed_at is null
  for update;

  if not found then
    raise exception 'ACTIVE_BATCH_GUIDE_NOT_FOUND';
  end if;

  select dg.*
  into v_guide
  from public.dispatch_guides dg
  where dg.id = v_relation.guide_id
    and dg.project_id = v_relation.project_id
  for update;

  select d.*
  into v_dispatch
  from public.dispatches d
  where d.id = v_guide.dispatch_id
    and d.project_id = v_guide.project_id
  for update;

  if not found then
    raise exception 'BATCH_DISPATCH_CONTEXT_INVALID';
  end if;

  if v_dispatch.status <> 'BATCHED' then
    raise exception 'BATCH_GUIDE_DISPATCH_NOT_BATCHED';
  end if;

  update public.batch_guides
  set removed_at = now(),
      removed_by = v_actor,
      removal_reason = v_reason,
      rolled_to_batch_id = null,
      removal_metadata = coalesce(removal_metadata, '{}'::jsonb)
        || jsonb_build_object('source', 'HUMAN')
  where id = v_relation.id;

  v_new_dispatch_status := v_dispatch.status::text;

  if not exists (
    select 1
    from public.batch_guides bg
    where bg.guide_id = v_guide.id
      and bg.removed_at is null
  ) then
    update public.dispatches
    set status = 'REGISTERED',
        updated_at = now()
    where id = v_dispatch.id
      and status = 'BATCHED';

    if found then
      v_new_dispatch_status := 'REGISTERED';
    end if;
  end if;

  select p.company_id
  into v_company_id
  from public.projects p
  where p.id = v_batch.project_id;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values,
    comment
  )
  values (
    v_actor,
    v_company_id,
    v_batch.project_id,
    'batch_guide',
    v_relation.id,
    'GUIDE_REMOVED_FROM_BATCH',
    jsonb_build_object(
      'batch_id', v_batch.id,
      'guide_id', v_guide.id,
      'dispatch_id', v_dispatch.id,
      'dispatch_status', v_dispatch.status
    ),
    jsonb_build_object(
      'removal_source', 'HUMAN',
      'removal_reason', v_reason,
      'dispatch_status', v_new_dispatch_status
    ),
    v_reason
  );

  return v_relation.id;
end;
$$;

alter function public.remove_guide_from_batch(uuid,uuid,text)
owner to postgres;

revoke all on function public.remove_guide_from_batch(uuid,uuid,text)
from public, anon;
grant execute on function public.remove_guide_from_batch(uuid,uuid,text)
to authenticated, service_role;

-- ============================================================
-- 6. PROJECT-LOCAL IDEMPOTENT SYSTEM BATCH ENSURE
-- ============================================================

create or replace function public.ensure_weekly_batch(
  p_project_id uuid,
  p_reference_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_company_id uuid;
  v_period record;
  v_batch_id uuid;
  v_code text;
begin
  if v_role <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  select resolved.*
  into v_period
  from app_private.resolve_weekly_batch_period(
    p_project_id,
    p_reference_date
  ) resolved;

  select p.company_id
  into v_company_id
  from public.projects p
  where p.id = p_project_id
    and p.status = 'ACTIVE';

  if not found then
    raise exception 'BATCH_PROJECT_INACTIVE';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_project_id::text || ':' || v_period.period_start::text,
      0
    )
  );

  select b.id
  into v_batch_id
  from public.batches b
  where b.project_id = p_project_id
    and b.period_start = v_period.period_start;

  if found then
    return v_batch_id;
  end if;

  v_code := format(
    'WB-%s-%s',
    to_char(v_period.period_start, 'IYYY'),
    to_char(v_period.period_start, 'IW')
  );

  insert into public.batches (
    project_id,
    code,
    period_start,
    period_end,
    accounting_period,
    status,
    creation_source,
    created_by
  )
  values (
    p_project_id,
    v_code,
    v_period.period_start,
    v_period.period_end,
    v_period.accounting_period,
    'ASSEMBLING',
    'SYSTEM',
    null
  )
  returning id into v_batch_id;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    new_values
  )
  values (
    null,
    v_company_id,
    p_project_id,
    'batch',
    v_batch_id,
    'WEEKLY_BATCH_ENSURED',
    jsonb_build_object(
      'batch_id', v_batch_id,
      'period_start', v_period.period_start,
      'period_end', v_period.period_end,
      'accounting_period', v_period.accounting_period,
      'project_timezone', v_period.project_timezone,
      'creation_source', 'SYSTEM'
    )
  );

  return v_batch_id;
end;
$$;

alter function public.ensure_weekly_batch(uuid,date)
owner to postgres;

revoke all on function public.ensure_weekly_batch(uuid,date)
from public, anon, authenticated;
grant execute on function public.ensure_weekly_batch(uuid,date)
to service_role;

-- ============================================================
-- 7. READ-ONLY ROLLOVER PREVIEW
-- ============================================================

create function public.preview_weekly_batch_rollover(
  p_batch_id uuid
)
returns table (
  batch_guide_id uuid,
  guide_id uuid,
  dispatch_id uuid,
  ready_for_review boolean,
  rollover_action text,
  rollover_reason text,
  removal_source text,
  destination_batch_id uuid,
  destination_period_start date,
  destination_period_end date,
  destination_accounting_period date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.batches%rowtype;
  v_next_period record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select b.*
  into v_batch
  from public.batches b
  where b.id = p_batch_id;

  if not found then
    raise exception 'BATCH_NOT_FOUND';
  end if;

  if not app_private.has_project_permission(
    v_batch.project_id,
    'batch.view'
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  select resolved.*
  into v_next_period
  from app_private.resolve_weekly_batch_period(
    v_batch.project_id,
    v_batch.period_end + 1
  ) resolved;

  return query
  select
    bg.id,
    bg.guide_id,
    dg.dispatch_id,
    app_private.guide_ready_for_batch(bg.guide_id, v_batch.id),
    case
      when app_private.guide_ready_for_batch(bg.guide_id, v_batch.id)
        then 'STAY'
      else 'MOVE'
    end,
    case
      when app_private.guide_ready_for_batch(bg.guide_id, v_batch.id)
        then 'READY_FOR_REVIEW'
      else 'PENDING_WEEKLY_CONTINUATION'
    end,
    case
      when app_private.guide_ready_for_batch(bg.guide_id, v_batch.id)
        then null::text
      else 'SYSTEM'
    end,
    next_batch.id,
    v_next_period.period_start,
    v_next_period.period_end,
    v_next_period.accounting_period
  from public.batch_guides bg
  join public.dispatch_guides dg
    on dg.id = bg.guide_id
   and dg.project_id = bg.project_id
  left join public.batches next_batch
    on next_batch.project_id = v_batch.project_id
   and next_batch.period_start = v_next_period.period_start
  where bg.batch_id = v_batch.id
    and bg.removed_at is null
  order by dg.guide_date, bg.guide_id;
end;
$$;

alter function public.preview_weekly_batch_rollover(uuid)
owner to postgres;

revoke all on function public.preview_weekly_batch_rollover(uuid)
from public, anon;
grant execute on function public.preview_weekly_batch_rollover(uuid)
to authenticated, service_role;

-- ============================================================
-- 8. PROTECTED, IDEMPOTENT SYSTEM ROLLOVER
-- ============================================================

create or replace function public.rollover_weekly_batch(
  p_batch_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_role text := coalesce(auth.jwt() ->> 'role', '');
  v_batch public.batches%rowtype;
  v_company_id uuid;
  v_next_batch_id uuid;
  v_next_batch public.batches%rowtype;
  v_existing_next_batch_id uuid;
  v_relation record;
  v_moved_count integer := 0;
  v_ready_count integer := 0;
begin
  if v_role <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  select b.*
  into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'BATCH_NOT_FOUND';
  end if;

  if v_batch.status = 'READY_FOR_REVIEW'
     and exists (
       select 1
       from public.audit_events ae
       where ae.project_id = v_batch.project_id
         and ae.entity_type = 'batch'
         and ae.entity_id = v_batch.id
         and ae.action = 'WEEKLY_BATCH_ROLLOVER_COMPLETED'
     ) then
    select b.id
    into v_existing_next_batch_id
    from public.batches b
    where b.project_id = v_batch.project_id
      and b.period_start = v_batch.period_start + 7;

    if not found then
      raise exception 'WEEKLY_BATCH_ROLLOVER_HISTORY_INCOMPLETE';
    end if;

    return v_existing_next_batch_id;
  end if;

  if v_batch.status <> 'ASSEMBLING' then
    raise exception 'WEEKLY_BATCH_ROLLOVER_STATE_INVALID';
  end if;

  v_next_batch_id := public.ensure_weekly_batch(
    v_batch.project_id,
    v_batch.period_end + 1
  );

  select b.*
  into v_next_batch
  from public.batches b
  where b.id = v_next_batch_id
    and b.project_id = v_batch.project_id
    and b.period_start = v_batch.period_start + 7
  for update;

  if not found then
    raise exception 'WEEKLY_BATCH_ROLLOVER_DESTINATION_INVALID';
  end if;

  if v_next_batch.status not in ('DRAFT', 'ASSEMBLING') then
    raise exception 'WEEKLY_BATCH_ROLLOVER_DESTINATION_NOT_EDITABLE';
  end if;

  select p.company_id
  into v_company_id
  from public.projects p
  where p.id = v_batch.project_id;

  for v_relation in
    select bg.id, bg.guide_id
    from public.batch_guides bg
    where bg.batch_id = v_batch.id
      and bg.removed_at is null
    order by bg.added_at, bg.id
    for update
  loop
    if app_private.guide_ready_for_batch(
      v_relation.guide_id,
      v_batch.id
    ) then
      v_ready_count := v_ready_count + 1;
      continue;
    end if;

    update public.batch_guides
    set removed_at = now(),
        removed_by = null,
        removal_reason = 'WEEKLY_ROLLOVER_PENDING',
        rolled_to_batch_id = v_next_batch_id,
        removal_metadata = coalesce(removal_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'source', 'SYSTEM',
            'reason', 'PENDING_WEEKLY_CONTINUATION'
          )
    where id = v_relation.id;

    insert into public.batch_guides (
      project_id,
      batch_id,
      guide_id,
      added_by,
      assignment_source
    )
    values (
      v_batch.project_id,
      v_next_batch_id,
      v_relation.guide_id,
      null,
      'SYSTEM'
    );

    v_moved_count := v_moved_count + 1;

    insert into public.audit_events (
      actor_user_id,
      company_id,
      project_id,
      entity_type,
      entity_id,
      action,
      old_values,
      new_values
    )
    values (
      null,
      v_company_id,
      v_batch.project_id,
      'dispatch_guide',
      v_relation.guide_id,
      'GUIDE_ROLLED_TO_WEEKLY_BATCH',
      jsonb_build_object(
        'batch_id', v_batch.id,
        'batch_guide_id', v_relation.id
      ),
      jsonb_build_object(
        'batch_id', v_next_batch_id,
        'assignment_source', 'SYSTEM',
        'removal_source', 'SYSTEM'
      )
    );
  end loop;

  update public.batches
  set status = 'READY_FOR_REVIEW',
      closed_at = null,
      version = version + 1,
      updated_at = now()
  where id = v_batch.id
    and status = 'ASSEMBLING';

  if not found then
    raise exception 'WEEKLY_BATCH_ROLLOVER_STATE_CHANGED';
  end if;

  insert into public.audit_events (
    actor_user_id,
    company_id,
    project_id,
    entity_type,
    entity_id,
    action,
    old_values,
    new_values
  )
  values (
    null,
    v_company_id,
    v_batch.project_id,
    'batch',
    v_batch.id,
    'WEEKLY_BATCH_ROLLOVER_COMPLETED',
    jsonb_build_object(
      'status', v_batch.status,
      'version', v_batch.version
    ),
    jsonb_build_object(
      'status', 'READY_FOR_REVIEW',
      'version', v_batch.version + 1,
      'next_batch_id', v_next_batch_id,
      'ready_guide_count', v_ready_count,
      'moved_guide_count', v_moved_count,
      'source', 'SYSTEM'
    )
  );

  return v_next_batch_id;
end;
$$;

alter function public.rollover_weekly_batch(uuid)
owner to postgres;

revoke all on function public.rollover_weekly_batch(uuid)
from public, anon, authenticated;
grant execute on function public.rollover_weekly_batch(uuid)
to service_role;

-- ============================================================
-- 9. FINAL SAFETY ASSERTIONS
-- ============================================================

do $$
declare
  v_definition text;
begin
  if to_regprocedure(
    'public.remove_guide_from_batch(uuid,uuid)'
  ) is not null
     or to_regprocedure(
       'public.remove_guide_from_batch(uuid,uuid,text)'
     ) is null
     or to_regprocedure(
       'public.preview_weekly_batch_rollover(uuid)'
     ) is null then
    raise exception 'WEEKLY_BATCH_WORKFLOW_CANONICAL_SIGNATURE_MISSING';
  end if;

  if not exists (
    select 1
    from pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'batches'
      and i.indexname = 'batches_project_period_start_uq'
      and position('UNIQUE' in upper(i.indexdef)) > 0
  ) then
    raise exception 'WEEKLY_BATCH_PROJECT_WEEK_UNIQUE_MISSING';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'batches'
      and c.conname = 'batches_week_exact_ck'
      and c.contype = 'c'
  ) then
    raise exception 'WEEKLY_BATCH_EXACT_WEEK_CONSTRAINT_MISSING';
  end if;

  if has_function_privilege(
    'anon', 'public.remove_guide_from_batch(uuid,uuid,text)', 'EXECUTE'
  )
     or not has_function_privilege(
       'authenticated',
       'public.remove_guide_from_batch(uuid,uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated', 'public.ensure_weekly_batch(uuid,date)', 'EXECUTE'
     )
     or has_function_privilege(
       'authenticated', 'public.rollover_weekly_batch(uuid)', 'EXECUTE'
     )
     or not has_function_privilege(
       'service_role', 'public.ensure_weekly_batch(uuid,date)', 'EXECUTE'
     )
     or not has_function_privilege(
       'service_role', 'public.rollover_weekly_batch(uuid)', 'EXECUTE'
     ) then
    raise exception 'WEEKLY_BATCH_WORKFLOW_RPC_GRANTS_NOT_ALIGNED';
  end if;

  select pg_get_functiondef(
    'public.add_guide_to_batch(uuid,uuid)'::regprocedure
  ) into v_definition;

  if position('REGISTERED' in v_definition) = 0
     or position('BATCHED' in v_definition) = 0
     or position('guide_date' in v_definition) = 0
     or position('GUIDE_ADDED_TO_BATCH' in v_definition) = 0 then
    raise exception 'WEEKLY_BATCH_ADD_CONTRACT_NOT_ALIGNED';
  end if;

  select pg_get_functiondef(
    'public.remove_guide_from_batch(uuid,uuid,text)'::regprocedure
  ) into v_definition;

  if position('HUMAN' in v_definition) = 0
     or position('REGISTERED' in v_definition) = 0
     or position('GUIDE_REMOVED_FROM_BATCH' in v_definition) = 0 then
    raise exception 'WEEKLY_BATCH_REMOVE_CONTRACT_NOT_ALIGNED';
  end if;

  select pg_get_functiondef(
    'public.rollover_weekly_batch(uuid)'::regprocedure
  ) into v_definition;

  if position('READY_FOR_REVIEW' in v_definition) = 0
     or position('WEEKLY_BATCH_ROLLOVER_COMPLETED' in v_definition) = 0
     or position('SERVICE_ROLE_REQUIRED' in v_definition) = 0
     or position('guide_ready_for_batch' in v_definition) = 0 then
    raise exception 'WEEKLY_BATCH_ROLLOVER_CONTRACT_NOT_ALIGNED';
  end if;

  -- CLOSED may appear in comments outside the function, but never in the
  -- canonical rollover definition. Calendar rollover is not terminal closure.
  if position('CLOSED' in v_definition) > 0 then
    raise exception 'WEEKLY_BATCH_ROLLOVER_TERMINAL_CLOSE_REMAINS';
  end if;

  if exists (
    select 1
    from public.batches b
    where extract(isodow from b.period_start) <> 1
       or extract(isodow from b.period_end) <> 7
       or b.period_end <> b.period_start + 6
       or b.accounting_period <> date_trunc(
         'month',
         case
           when date_trunc('month', b.period_start)
                <> date_trunc('month', b.period_end)
             then b.period_end
           else b.period_start
         end
       )::date
  ) then
    raise exception 'WEEKLY_BATCH_PERIOD_INVARIANT_LOST';
  end if;
end;
$$;

-- ============================================================
-- 10. QA PLAN — RUN ONLY AFTER BOTH MANUAL EXECUTIONS
-- ============================================================

-- Run live QA with reversible domain rows and compare counts before/after:
--   * authenticated SELECT works through batch.view RLS; anon reads zero;
--   * authenticated and anon have no direct batch/batch_guides DML;
--   * human RPCs reject anon; ensure/rollover reject anon and authenticated;
--   * service_role alone can ensure and rollover;
--   * omitted ensure reference date uses valid project timezone and falls back
--     to America/Guatemala for null, blank or invalid configuration;
--   * Monday/Sunday and exactly seven days are enforced;
--   * cross-month week uses the month containing period_end; other weeks use
--     the month containing period_start; accounting_period is first-of-month;
--   * duplicate project + period_start is rejected under concurrency;
--   * create_batch supplies accounting_period and emits BATCH_CREATED;
--   * manual add accepts only REGISTERED, same-project, in-week guides;
--   * manual add accepts every physical dispatch.result value and changes only
--     REGISTERED -> BATCHED with GUIDE_ADDED_TO_BATCH audit;
--   * manual add rejects BATCHED, UNDER_REVIEW, RECONCILED,
--     REQUIRES_CORRECTION and CLOSED dispatches;
--   * manual remove requires a bounded reason, preserves the historical row,
--     records HUMAN metadata/audit and changes BATCHED -> REGISTERED only when
--     no active batch relation remains;
--   * preview is read-only and reports STAY/MOVE plus next canonical period;
--   * rollover accepts only ASSEMBLING and is idempotent after completion;
--   * ready Guides remain active in the origin; pending Guides receive closed
--     SYSTEM history plus one active SYSTEM relation in the next batch;
--   * rollover leaves dispatch status BATCHED and changes origin to
--     READY_FOR_REVIEW, never CLOSED;
--   * rollover audits each move and the final counts;
--   * PLATFORM_ADMIN read policies remain independent;
--   * guide_ready_for_batch definition is unchanged in this migration;
--   * rollback removes every QA row and restores batch, relationship, dispatch
--     and audit counts exactly.

commit;
