-- 083_phase3_batch_dispatch_membership.sql
-- APPLIED SUCCESSFULLY — EXECUTED ON 2026-09-03.
--
-- Phase 3, part A: weekly batches are built from Dispatches. Guide rows remain
-- internal traceability of a Dispatch and no longer define batch membership.

begin;

do $$
begin
  if to_regclass('public.batches') is null
     or to_regclass('public.batch_guides') is null
     or to_regclass('public.dispatches') is null
     or to_regprocedure('app_private.has_project_permission(uuid,text)') is null
     or to_regprocedure(
       'app_private.resolve_weekly_batch_period(uuid,date)'
     ) is null then
    raise exception 'PHASE3_BATCH_REQUIRED_CONTRACT_MISSING';
  end if;
end;
$$;

create type public.batch_status_phase3 as enum ('OPEN', 'CLOSED');

alter table public.batches alter column status drop default;
alter table public.batches
  alter column status type public.batch_status_phase3
  using (
    case when status::text = 'CLOSED' then 'CLOSED' else 'OPEN' end
  )::public.batch_status_phase3;
alter table public.batches alter column status set default 'OPEN';

drop type public.batch_status;
alter type public.batch_status_phase3 rename to batch_status;

create table public.batch_dispatches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  batch_id uuid not null references public.batches(id) on delete restrict,
  dispatch_id uuid not null references public.dispatches(id) on delete restrict,
  added_by uuid references public.profiles(id) on delete restrict,
  added_at timestamptz not null default now(),
  removed_by uuid references public.profiles(id) on delete restrict,
  removed_at timestamptz,
  removal_reason text,
  assignment_source public.batch_creation_source not null default 'USER',
  rolled_to_batch_id uuid references public.batches(id) on delete restrict,
  removal_metadata jsonb not null default '{}'::jsonb,
  constraint batch_dispatches_id_project_uq unique (id, project_id),
  constraint batch_dispatches_batch_project_fk
    foreign key (batch_id, project_id)
    references public.batches(id, project_id) on delete restrict,
  constraint batch_dispatches_dispatch_project_fk
    foreign key (dispatch_id, project_id)
    references public.dispatches(id, project_id) on delete restrict,
  constraint batch_dispatches_removal_ck check (
    (removed_at is null and removed_by is null and removal_reason is null
      and rolled_to_batch_id is null)
    or
    (removed_at is not null and removal_reason is not null)
  )
);

create unique index batch_dispatches_one_active_batch_uq
on public.batch_dispatches(dispatch_id)
where removed_at is null;

create index idx_batch_dispatches_batch_active
on public.batch_dispatches(batch_id, added_at)
where removed_at is null;

create index idx_batch_dispatches_project_history
on public.batch_dispatches(project_id, dispatch_id, added_at desc);

do $$
begin
  if exists (
    select guide.dispatch_id
    from public.batch_guides relation
    join public.dispatch_guides guide on guide.id = relation.guide_id
    where relation.removed_at is null
    group by guide.dispatch_id
    having count(distinct relation.batch_id) > 1
  ) then
    raise exception 'PHASE3_DISPATCH_HAS_MULTIPLE_ACTIVE_BATCHES';
  end if;
end;
$$;

-- Preserve any useful pre-migration relation. Several guide relations for the
-- same Dispatch collapse into one active Dispatch relation; guide membership
-- remains derivable through dispatch_guides.dispatch_id.
insert into public.batch_dispatches(
  project_id, batch_id, dispatch_id, added_by, added_at,
  assignment_source, removal_metadata
)
select distinct on (guide.dispatch_id)
  relation.project_id,
  relation.batch_id,
  guide.dispatch_id,
  relation.added_by,
  relation.added_at,
  relation.assignment_source::text::public.batch_creation_source,
  jsonb_build_object(
    'migration', 'PHASE3_BATCH_GUIDES_TO_DISPATCH',
    'source_batch_guide_id', relation.id
  )
from public.batch_guides relation
join public.dispatch_guides guide on guide.id = relation.guide_id
where relation.removed_at is null
order by guide.dispatch_id, relation.added_at, relation.id;

alter table public.batch_dispatches enable row level security;

create policy batch_dispatches_select
on public.batch_dispatches for select to authenticated
using (app_private.has_project_permission(project_id, 'batch.view'));

create policy platform_admin_read_batch_dispatches
on public.batch_dispatches for select to authenticated
using (app_private.is_platform_admin());

revoke all on table public.batch_dispatches from public, anon, authenticated;
grant select on table public.batch_dispatches to authenticated;
grant all on table public.batch_dispatches to service_role;

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
  v_period record;
  v_batch_id uuid;
  v_code text := nullif(btrim(p_code), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not app_private.has_project_permission(p_project_id, 'batch.create') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_code is null then raise exception 'BATCH_CODE_REQUIRED'; end if;

  select resolved.* into v_period
  from app_private.resolve_weekly_batch_period(
    p_project_id, p_period_start
  ) resolved;
  if p_period_start is null or p_period_end is null
     or p_period_start <> v_period.period_start
     or p_period_end <> v_period.period_end then
    raise exception 'BATCH_PERIOD_MUST_BE_MONDAY_TO_SUNDAY';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_project_id::text || ':' || p_period_start::text, 0)
  );
  insert into public.batches(
    project_id, code, period_start, period_end, accounting_period,
    status, creation_source, created_by
  ) values (
    p_project_id, v_code, v_period.period_start, v_period.period_end,
    v_period.accounting_period, 'OPEN', 'USER', v_actor
  ) returning id into v_batch_id;

  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id, action, new_values
  ) values (
    v_actor, p_project_id, 'batch', v_batch_id, 'BATCH_CREATED',
    jsonb_build_object(
      'code', v_code,
      'period_start', v_period.period_start,
      'period_end', v_period.period_end,
      'accounting_period', v_period.accounting_period,
      'status', 'OPEN'
    )
  );
  return v_batch_id;
exception when unique_violation then
  raise exception 'BATCH_WEEK_OR_CODE_ALREADY_EXISTS';
end;
$$;

create function public.add_dispatch_to_batch(
  p_batch_id uuid,
  p_dispatch_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.batches%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_relation_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_batch from public.batches where id = p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_batch.project_id, 'batch.modify')
  then raise exception 'PERMISSION_DENIED'; end if;
  if v_batch.status <> 'OPEN' then raise exception 'BATCH_NOT_EDITABLE'; end if;

  select * into v_dispatch from public.dispatches
  where id = p_dispatch_id for update;
  if not found or v_dispatch.project_id <> v_batch.project_id then
    raise exception 'DISPATCH_BATCH_CONTEXT_INVALID';
  end if;
  if v_dispatch.status not in ('IN_EXECUTION', 'COMPLETED') then
    raise exception 'DISPATCH_NOT_ELIGIBLE_FOR_BATCH';
  end if;

  insert into public.batch_dispatches(
    project_id, batch_id, dispatch_id, added_by, assignment_source
  ) values (
    v_batch.project_id, v_batch.id, v_dispatch.id, v_actor, 'USER'
  ) returning id into v_relation_id;

  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id, action, new_values
  ) values (
    v_actor, v_batch.project_id, 'batch_dispatch', v_relation_id,
    'DISPATCH_ADDED_TO_BATCH', jsonb_build_object(
      'batch_id', v_batch.id,
      'dispatch_id', v_dispatch.id,
      'dispatch_status', v_dispatch.status
    )
  );
  return v_relation_id;
exception when unique_violation then
  raise exception 'DISPATCH_ALREADY_IN_ACTIVE_BATCH';
end;
$$;

create function public.remove_dispatch_from_batch(
  p_batch_id uuid,
  p_dispatch_id uuid,
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
  v_relation public.batch_dispatches%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'BATCH_DISPATCH_REMOVAL_REASON_INVALID';
  end if;

  select * into v_batch
  from public.batches batch
  where batch.id = p_batch_id
  for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;

  select * into v_relation
  from public.batch_dispatches relation
  where relation.batch_id = p_batch_id
    and relation.dispatch_id = p_dispatch_id
    and relation.removed_at is null
  for update;
  if not found then raise exception 'BATCH_DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(
    v_relation.project_id, 'batch.modify'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_batch.status <> 'OPEN' then raise exception 'BATCH_NOT_EDITABLE'; end if;

  update public.batch_dispatches
  set removed_at = now(), removed_by = v_actor, removal_reason = v_reason,
      removal_metadata = jsonb_build_object('source', 'HUMAN')
  where id = v_relation.id;

  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id,
    action, old_values, new_values
  ) values (
    v_actor, v_relation.project_id, 'batch_dispatch', v_relation.id,
    'DISPATCH_REMOVED_FROM_BATCH',
    jsonb_build_object('batch_id', p_batch_id, 'dispatch_id', p_dispatch_id),
    jsonb_build_object('reason', v_reason, 'source', 'HUMAN')
  );
  return v_relation.id;
end;
$$;

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
  v_period record;
  v_batch_id uuid;
begin
  if v_role <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  select resolved.* into v_period
  from app_private.resolve_weekly_batch_period(
    p_project_id, p_reference_date
  ) resolved;
  perform pg_advisory_xact_lock(
    hashtextextended(p_project_id::text || ':' || v_period.period_start::text, 0)
  );
  select id into v_batch_id from public.batches
  where project_id = p_project_id and period_start = v_period.period_start;
  if found then return v_batch_id; end if;
  insert into public.batches(
    project_id, code, period_start, period_end, accounting_period,
    status, creation_source, created_by
  ) values (
    p_project_id,
    format('LOT-%s-%s', to_char(v_period.period_start, 'IYYY'),
      to_char(v_period.period_start, 'IW')),
    v_period.period_start, v_period.period_end, v_period.accounting_period,
    'OPEN', 'SYSTEM', null
  ) returning id into v_batch_id;
  return v_batch_id;
end;
$$;

drop function if exists public.preview_weekly_batch_rollover(uuid);

create function public.preview_weekly_batch_rollover(
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
    coalesce(reconciliation.status::text = 'RECONCILED', false),
    case when reconciliation.status::text = 'RECONCILED'
      then 'STAY' else 'MOVE' end,
    case when reconciliation.status::text = 'RECONCILED'
      then 'Conciliado' else 'Proceso pendiente' end,
    v_destination, v_period.period_start, v_period.period_end,
    v_period.accounting_period
  from public.batch_dispatches relation
  left join public.dispatch_reconciliations reconciliation
    on reconciliation.dispatch_id = relation.dispatch_id
  where relation.batch_id = v_batch.id and relation.removed_at is null
  order by relation.added_at, relation.id;
end;
$$;

-- Defined after migration 084 creates dispatch_reconciliations. PostgreSQL
-- resolves PL/pgSQL relation names when the function is first executed.
create or replace function public.rollover_weekly_batch(p_batch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_batch public.batches%rowtype;
  v_period record;
  v_destination_id uuid;
  v_relation record;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_batch from public.batches where id = p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_batch.project_id, 'batch.modify')
  then raise exception 'PERMISSION_DENIED'; end if;
  if v_batch.status <> 'OPEN' then
    raise exception 'WEEKLY_BATCH_ROLLOVER_STATE_INVALID';
  end if;

  select resolved.* into v_period
  from app_private.resolve_weekly_batch_period(
    v_batch.project_id, v_batch.period_end + 1
  ) resolved;
  insert into public.batches(
    project_id, code, period_start, period_end, accounting_period,
    status, creation_source, created_by
  ) values (
    v_batch.project_id,
    format('LOT-%s-%s', to_char(v_period.period_start, 'IYYY'),
      to_char(v_period.period_start, 'IW')),
    v_period.period_start, v_period.period_end, v_period.accounting_period,
    'OPEN', 'SYSTEM', null
  ) on conflict (project_id, period_start) do update
    set updated_at = public.batches.updated_at
  returning id into v_destination_id;

  for v_relation in
    select relation.* from public.batch_dispatches relation
    left join public.dispatch_reconciliations reconciliation
      on reconciliation.dispatch_id = relation.dispatch_id
    where relation.batch_id = v_batch.id
      and relation.removed_at is null
      and coalesce(reconciliation.status::text, '') <> 'RECONCILED'
    for update of relation
  loop
    update public.batch_dispatches
    set removed_at = now(), removal_reason = 'Continuidad semanal automática',
        rolled_to_batch_id = v_destination_id,
        removal_metadata = jsonb_build_object('source', 'SYSTEM_ROLLOVER')
    where id = v_relation.id;
    insert into public.batch_dispatches(
      project_id, batch_id, dispatch_id, added_by, assignment_source,
      removal_metadata
    ) values (
      v_relation.project_id, v_destination_id, v_relation.dispatch_id,
      null, 'SYSTEM', jsonb_build_object(
        'source', 'SYSTEM_ROLLOVER', 'from_batch_id', v_batch.id
      )
    );
  end loop;

  update public.batches
  set status = 'CLOSED', closed_at = now(), version = version + 1,
      updated_at = now()
  where id = v_batch.id;

  insert into public.audit_events(
    actor_user_id, project_id, entity_type, entity_id, action, new_values
  ) values (
    v_actor, v_batch.project_id, 'batch', v_batch.id,
    'WEEKLY_BATCH_CLOSED',
    jsonb_build_object('destination_batch_id', v_destination_id)
  );
  return v_destination_id;
end;
$$;

alter function public.create_batch(uuid,text,date,date) owner to postgres;
alter function public.add_dispatch_to_batch(uuid,uuid) owner to postgres;
alter function public.remove_dispatch_from_batch(uuid,uuid,text) owner to postgres;
alter function public.ensure_weekly_batch(uuid,date) owner to postgres;
alter function public.preview_weekly_batch_rollover(uuid) owner to postgres;
alter function public.rollover_weekly_batch(uuid) owner to postgres;

revoke all on function public.create_batch(uuid,text,date,date) from public, anon;
revoke all on function public.add_dispatch_to_batch(uuid,uuid) from public, anon;
revoke all on function public.remove_dispatch_from_batch(uuid,uuid,text)
from public, anon;
revoke all on function public.preview_weekly_batch_rollover(uuid)
from public, anon;
revoke all on function public.rollover_weekly_batch(uuid) from public, anon;
grant execute on function public.create_batch(uuid,text,date,date)
to authenticated, service_role;
grant execute on function public.add_dispatch_to_batch(uuid,uuid)
to authenticated, service_role;
grant execute on function public.remove_dispatch_from_batch(uuid,uuid,text)
to authenticated, service_role;
grant execute on function public.preview_weekly_batch_rollover(uuid)
to authenticated, service_role;
grant execute on function public.rollover_weekly_batch(uuid)
to authenticated, service_role;

commit;

-- Live QA after manual execution:
--   * batches use only OPEN/CLOSED;
--   * IN_EXECUTION and COMPLETED Dispatches can be associated;
--   * one Dispatch has at most one active Batch relation;
--   * batch membership never changes dispatches.status;
--   * rollover keeps RECONCILED Dispatches and moves every pending process.
