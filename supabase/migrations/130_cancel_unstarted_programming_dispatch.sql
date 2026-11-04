-- An operation started by mistake can be cancelled before any guide or billing.
-- Keep its dispatch as NOT_DISPATCHED and retain the reason and actor in history.
begin;

create or replace function public.cancel_programming(
  p_programming_id uuid,
  p_expected_version integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_programming public.programming%rowtype;
  v_dispatch public.dispatches%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_expected_version is null then raise exception 'PROGRAMMING_EXPECTED_VERSION_REQUIRED'; end if;
  if v_reason is null then raise exception 'PROGRAMMING_CANCELLATION_REASON_REQUIRED'; end if;
  if char_length(v_reason) > 1000 then raise exception 'PROGRAMMING_CANCELLATION_REASON_TOO_LONG'; end if;

  select * into v_programming from public.programming where id = p_programming_id for update;
  if not found then raise exception 'PROGRAMMING_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_programming.project_id, 'programming.cancel') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_programming.version <> p_expected_version then raise exception 'PROGRAMMING_VERSION_CONFLICT'; end if;
  if v_programming.status not in ('DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'IN_EXECUTION') then
    raise exception 'PROGRAMMING_CANNOT_BE_CANCELLED';
  end if;

  -- Serialize against guide entry and dispatch changes, then check persisted data.
  -- A service-only guide also counts as activity, even though its volume is zero.
  for v_dispatch in
    select * from public.dispatches
    where programming_id = v_programming.id and project_id = v_programming.project_id
    order by id for update
  loop
    if v_dispatch.status <> 'IN_EXECUTION'
       or (v_dispatch.result is not null and v_dispatch.result <> 'NOT_DISPATCHED')
       or coalesce(v_dispatch.real_volume, 0) > 0
       or exists (select 1 from public.dispatch_guides where dispatch_id = v_dispatch.id)
       or exists (select 1 from public.invoices where dispatch_id = v_dispatch.id)
       or exists (select 1 from public.batch_dispatches where dispatch_id = v_dispatch.id)
       or exists (select 1 from public.dispatch_reconciliations where dispatch_id = v_dispatch.id)
    then raise exception 'PROGRAMMING_HAS_RECORDED_ACTIVITY'; end if;
  end loop;

  update public.programming
  set status = 'CANCELLED', version = version + 1, updated_at = now()
  where id = v_programming.id;

  for v_dispatch in
    select * from public.dispatches
    where programming_id = v_programming.id and project_id = v_programming.project_id
    order by id
  loop
    update public.dispatches
    set status = 'COMPLETED', result = 'NOT_DISPATCHED', real_volume = 0,
        real_unit_code = coalesce(real_unit_code, v_programming.unit_code),
        completed_at = now(), completed_by = v_actor, version = version + 1
    where id = v_dispatch.id;

    insert into public.audit_events(actor_user_id, project_id, entity_type, entity_id,
      action, old_values, new_values, comment)
    values (v_actor, v_programming.project_id, 'dispatch', v_dispatch.id,
      'DISPATCH_CANCELLED_WITH_PROGRAMMING',
      jsonb_build_object('status', v_dispatch.status, 'result', v_dispatch.result,
        'real_volume', v_dispatch.real_volume, 'version', v_dispatch.version),
      jsonb_build_object('status', 'COMPLETED', 'result', 'NOT_DISPATCHED',
        'real_volume', 0, 'version', v_dispatch.version + 1, 'programming_id', v_programming.id),
      v_reason);
  end loop;

  perform app_private.snapshot_programming(v_programming.id, v_actor, 'PROGRAMMING_CANCELLED', v_reason);
  insert into public.audit_events(actor_user_id, project_id, entity_type, entity_id,
    action, old_values, new_values, comment)
  values (v_actor, v_programming.project_id, 'programming', v_programming.id, 'PROGRAMMING_CANCELLED',
    jsonb_build_object('status', v_programming.status, 'version', v_programming.version),
    jsonb_build_object('status', 'CANCELLED', 'version', v_programming.version + 1, 'reason', v_reason), v_reason);
  return v_programming.version + 1;
end;
$$;

alter function public.cancel_programming(uuid,integer,text) owner to postgres;
revoke all on function public.cancel_programming(uuid,integer,text) from public,anon;
grant execute on function public.cancel_programming(uuid,integer,text) to authenticated,service_role;

-- These cancellations do not create an invoice/reconciliation obligation.
create or replace function app_private.sync_completed_dispatch_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.status = 'COMPLETED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not exists (select 1 from public.programming where id = new.programming_id
       and project_id = new.project_id and status = 'CANCELLED') then
    perform app_private.refresh_dispatch_reconciliation(new.id);
  end if;
  return new;
end;
$$;

-- Manual assignment must also reject preserved dispatches of cancelled schedules.
do $$
declare
  v_definition text := pg_get_functiondef('public.add_dispatch_to_batch(uuid,uuid)'::regprocedure);
  v_anchor text := '  insert into public.batch_dispatches(';
  v_guard text := '  if exists (select 1 from public.programming where id = v_dispatch.programming_id
    and project_id = v_dispatch.project_id and status = ''CANCELLED'') then
    raise exception ''DISPATCH_PROGRAMMING_CANCELLED'';
  end if;

';
begin
  if length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor) then
    raise exception 'CANCEL_PROGRAMMING_BATCH_PREREQUISITE_CHANGED';
  end if;
  execute replace(v_definition, v_anchor, v_guard || v_anchor);
end;
$$;

notify pgrst, 'reload schema';
commit;
