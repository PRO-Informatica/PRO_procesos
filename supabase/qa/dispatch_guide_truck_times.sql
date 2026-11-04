-- DEV only. Full rollback, real authenticated RPCs, no permanent fixtures.
begin;
-- Keep the actual scenario in one block so all version changes are exercised.
do $$
declare
  d public.dispatches%rowtype;
  v_timezone text; v_day date; v_unit text; v_product uuid; v_actor uuid; v_other uuid;
  v_lines jsonb; v_result jsonb; v_version integer; g1 uuid; g2 uuid; g3 uuid;
  v_prefix text := 'QA-121-'||gen_random_uuid()::text;
begin
  select ds.* into strict d from public.dispatches ds
  join public.projects p on p.id=ds.project_id and p.status='ACTIVE'
  join public.companies c on c.id=p.company_id and c.status='ACTIVE'
  join public.platform_admins a on a.user_id=ds.created_by and a.active
  where ds.status='IN_EXECUTION' order by ds.created_at desc limit 1;
  v_actor := d.created_by;
  select coalesce(nullif(p.timezone,''),'America/Guatemala'),
    (pr.scheduled_at at time zone coalesce(nullif(p.timezone,''),'America/Guatemala'))::date,pr.unit_code
  into v_timezone,v_day,v_unit
  from public.programming pr join public.projects p on p.id=pr.project_id where pr.id=d.programming_id;
  select id into strict v_product from public.project_product_prices where project_id=d.project_id order by id limit 1;
  v_lines := jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',1,'unit_code',v_unit));
  -- Only inside this rollback: allow a full working-day range for the scenario.
  update public.dispatches set arrival_at=(v_day+time '08:00') at time zone v_timezone where id=d.id;
  v_version := d.version;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  execute 'set local role authenticated';
  v_result := public.create_dispatch_guide_with_lines(d.id,v_version,v_prefix||'-1',v_day,v_lines,time '09:00',time '10:00');
  g1 := (v_result->>'guide_id')::uuid; v_version := v_version+1;
  if (v_result->>'dispatch_version')::integer<>v_version then raise exception 'QA_VERSION_INCREMENT'; end if;
  execute 'reset role';
  if not exists(select 1 from public.dispatch_guides where id=g1 and truck_arrival_at=(v_day+time '09:00') at time zone v_timezone and truck_departure_at=(v_day+time '10:00') at time zone v_timezone)
    or not exists(select 1 from public.dispatches where id=d.id and departure_at=(v_day+time '10:00') at time zone v_timezone) then raise exception 'QA_FIRST_GUIDE_TIMES'; end if;
  execute 'set local role authenticated';
  v_result := public.create_dispatch_guide_with_lines(d.id,v_version,v_prefix||'-2',v_day,v_lines,time '11:00',time '12:00');
  g2 := (v_result->>'guide_id')::uuid; v_version := v_version+1;
  v_result := public.create_dispatch_guide_with_lines(d.id,v_version,v_prefix||'-3',v_day,v_lines,time '08:45',time '09:30');
  g3 := (v_result->>'guide_id')::uuid; v_version := v_version+1;
  execute 'reset role';
  if not exists(select 1 from public.dispatches where id=d.id and departure_at=(v_day+time '12:00') at time zone v_timezone and version=v_version) then raise exception 'QA_OUT_OF_ORDER_GUIDE_REGRESSED_EXIT'; end if;
  execute 'set local role authenticated';
  -- Stale/malicious dispatch form must not overwrite the aggregate (even with null).
  v_version := public.update_dispatch(d.id,v_version,(v_day+time '08:00') at time zone v_timezone,null,d.received_by_name,null,d.order_number,d.real_volume,d.real_unit_code);
  execute 'reset role';
  if not exists(select 1 from public.dispatches where id=d.id and departure_at=(v_day+time '12:00') at time zone v_timezone) then raise exception 'QA_FORM_OVERWROTE_EXIT'; end if;
  if not exists(select 1 from public.audit_events where entity_id=d.id and action='DISPATCH_SAVED' and (new_values->>'departure_at')::timestamptz=(v_day+time '12:00') at time zone v_timezone) then raise exception 'QA_AUDIT_EXIT_INCORRECT'; end if;
  execute 'set local role authenticated';
  v_version := public.update_dispatch_guide_with_lines(g2,v_version,v_prefix||'-2',v_day,v_lines,time '09:15',time '09:45');
  execute 'reset role';
  if not exists(select 1 from public.dispatches where id=d.id and departure_at=(v_day+time '10:00') at time zone v_timezone and version=v_version) then raise exception 'QA_EDIT_DID_NOT_RECALCULATE'; end if;
  execute 'set local role authenticated';
  v_version := public.delete_dispatch_guide(g1,v_version);
  execute 'reset role';
  if not exists(select 1 from public.dispatches where id=d.id and departure_at=(v_day+time '09:45') at time zone v_timezone) then raise exception 'QA_DELETE_DID_NOT_RECALCULATE'; end if;
  execute 'set local role authenticated';
  begin
    perform public.create_dispatch_guide_with_lines(d.id,v_version,v_prefix||'-missing',v_day,v_lines,null::time,time '11:00');
    raise exception 'QA_MISSING_TIMES_ALLOWED';
  exception when raise_exception then if sqlerrm<>'GUIDE_TRUCK_TIMES_REQUIRED' then raise; end if; end;
  begin
    perform public.create_dispatch_guide_with_lines(d.id,v_version,v_prefix||'-old-client',v_day,v_lines);
    raise exception 'QA_OLD_CLIENT_OMITTED_TIMES';
  exception when raise_exception then if sqlerrm<>'GUIDE_TRUCK_TIMES_REQUIRED' then raise; end if; end;
  begin
    perform public.create_dispatch_guide_with_lines(d.id,v_version,v_prefix||'-reverse',v_day,v_lines,time '11:00',time '10:00');
    raise exception 'QA_REVERSED_TIMES_ALLOWED';
  exception when raise_exception then if sqlerrm<>'GUIDE_TRUCK_INVALID_TIME_SEQUENCE' then raise; end if; end;
  begin
    perform public.update_dispatch_guide_with_lines(g2,v_version-1,v_prefix||'-2',v_day,v_lines,time '10:00',time '11:00');
    raise exception 'QA_STALE_VERSION_ALLOWED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_VERSION_CONFLICT' then raise; end if; end;
  execute 'reset role';
  -- Direct writes cannot evade the required pair or programming-day boundary.
  begin
    update public.dispatch_guides set truck_departure_at=(v_day+1+time '10:00') at time zone v_timezone where id=g2;
    raise exception 'QA_OTHER_DAY_ALLOWED';
  exception when raise_exception then if sqlerrm<>'GUIDE_TRUCK_DATE_MISMATCH' then raise; end if; end;
  begin
    update public.dispatch_guides set truck_arrival_at=null where id=g2;
    raise exception 'QA_PARTIAL_TIMES_ALLOWED';
  exception when raise_exception then if sqlerrm<>'GUIDE_TRUCK_TIMES_REQUIRED' then raise; end if; end;
  -- Project-scoped permission checks remain enforced for all new overloads.
  select id into v_other from public.profiles where id<>v_actor
    and not exists(select 1 from public.platform_admins a where a.user_id=profiles.id and a.active)
    and not exists(select 1 from public.project_members m where m.user_id=profiles.id and m.project_id=d.project_id)
    and not exists(select 1 from public.company_members m join public.projects p on p.company_id=m.company_id where m.user_id=profiles.id and p.id=d.project_id)
    limit 1;
  if v_other is null then raise exception 'QA_UNAUTHORIZED_ACTOR_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',v_other::text,true);
  execute 'set local role authenticated';
  begin
    perform public.create_dispatch_guide_with_lines(d.id,v_version,v_prefix||'-forbidden',v_day,v_lines,time '10:00',time '11:00');
    raise exception 'QA_PERMISSION_BYPASSED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  execute 'set local role authenticated';
  v_version := public.delete_dispatch_guide(g2,v_version);
  v_version := public.delete_dispatch_guide(g3,v_version);
  execute 'reset role';
  if not exists(select 1 from public.dispatches where id=d.id and departure_at is null and version=v_version) then raise exception 'QA_LAST_GUIDE_EXIT_NOT_CLEARED'; end if;
  -- Guard immutable completed dispatches without creating evidence or invoices.
  update public.dispatches set status='COMPLETED',result='NOT_DISPATCHED',real_volume=0,completed_at=now(),completed_by=v_actor where id=d.id;
  execute 'set local role authenticated';
  begin
    perform public.create_dispatch_guide_with_lines(d.id,v_version,v_prefix||'-closed',v_day,v_lines,time '10:00',time '11:00');
    raise exception 'QA_COMPLETED_DISPATCH_EDITABLE';
  exception when raise_exception then if sqlerrm<>'DISPATCH_COMPLETED_NOT_EDITABLE' then raise; end if; end;
  execute 'reset role';
  raise notice 'PASS: authenticated create/edit/delete, max not last entered, per-guide timezone, audit, conflicts, permissions, stale forms, historical coexistence, completion guards';
end;
$$;
rollback;
