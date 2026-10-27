-- DEV only: correct a historical dispatch arrival, then save its truck guide. Full rollback.
begin;
do $$
declare
  v_project uuid; v_supplier uuid; v_actor uuid; v_other uuid; v_timezone text;
  v_today date; v_past timestamptz; v_lines jsonb; v_item jsonb;
  v_result jsonb; v_dispatch uuid; v_program uuid; v_product uuid; v_reference text;
  v_version integer; v_guide uuid; candidate record;
begin
  -- Use actual operational roles; being a platform admin alone grants no
  -- programming/dispatch permissions. Never grant roles for this test.
  for candidate in
    select p.id, r.supplier_id, coalesce(nullif(p.timezone,''),'America/Guatemala') timezone, actor.id actor_id
    from public.projects p join public.companies c on c.id=p.company_id and c.status='ACTIVE'
    join public.project_suppliers r on r.project_id=p.id and r.active
    join public.suppliers s on s.id=r.supplier_id and s.company_id=r.company_id and s.active
    cross join public.profiles actor
    where p.status='ACTIVE' and actor.active and exists(select 1 from public.project_product_prices price where price.project_id=p.id) order by p.id,actor.id
  loop
    perform set_config('request.jwt.claim.sub',candidate.actor_id::text,true);
    if app_private.has_project_permission(candidate.id,'programming.create')
       and app_private.has_project_permission(candidate.id,'programming.confirm')
       and app_private.has_project_permission(candidate.id,'dispatch.create')
       and app_private.has_project_permission(candidate.id,'dispatch.modify') then
      v_project:=candidate.id; v_supplier:=candidate.supplier_id;
      v_timezone:=candidate.timezone; v_actor:=candidate.actor_id;
      exit;
    end if;
  end loop;
  if v_actor is null then raise exception 'QA_OPERATIONAL_ACTOR_REQUIRED'; end if;
  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_past := (v_today-7+time '07:00') at time zone v_timezone;
  select id,reference into strict v_product,v_reference from public.project_product_prices where project_id=v_project order by id limit 1;
  v_lines := jsonb_build_array(jsonb_build_object('quantity',7,'unit_code','M3','concrete_type',v_reference));
  v_item := jsonb_build_object('supplier_id',v_supplier,'scheduled_at',v_past,
    'order_number','QA-arrival-'||gen_random_uuid()::text,'lines',v_lines,'delivery_modes',jsonb_build_array('PUMP'));
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  execute 'set local role authenticated';
  v_result := public.create_programming_batch(v_project,jsonb_build_array(v_item));
  v_program := (v_result->'programming_ids'->>0)::uuid;
  v_dispatch := public.start_dispatch(v_program, v_past+interval '3 hours 32 minutes','QA receiver');
  v_version := public.update_dispatch(v_dispatch,1,v_past,null,'QA receiver',null,v_item->>'order_number',7,'M3');
  execute 'reset role';
  if not exists(select 1 from public.dispatches where id=v_dispatch and arrival_at=v_past and received_by_name='QA receiver' and version=v_version) then raise exception 'QA_ARRIVAL_NOT_SAVED'; end if;
  if not exists(select 1 from public.audit_events where entity_id=v_dispatch and action='DISPATCH_SAVED' and (new_values->>'arrival_at')::timestamptz=v_past and (old_values->>'arrival_at')::timestamptz=v_past+interval '3 hours 32 minutes') then raise exception 'QA_ARRIVAL_AUDIT_MISSING'; end if;
  v_lines:=jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',7,'unit_code','M3'));
  execute 'set local role authenticated';
  v_result:=public.create_dispatch_guide_with_lines(v_dispatch,v_version,'QA-'||gen_random_uuid()::text,(v_today-7),v_lines,time '07:00',time '07:45');
  v_version:=(v_result->>'dispatch_version')::integer;v_guide:=(v_result->>'guide_id')::uuid;
  execute 'reset role';
  if not exists(select 1 from public.dispatches where id=v_dispatch and arrival_at=v_past and departure_at=v_past+interval '45 minutes' and version=v_version)
    or not exists(select 1 from public.dispatch_guides where id=v_guide and truck_arrival_at=v_past and truck_departure_at=v_past+interval '45 minutes') then raise exception 'QA_GUIDE_AFTER_CORRECTION_FAILED'; end if;
  execute 'set local role authenticated';
  begin
    perform public.update_dispatch(v_dispatch,v_version,v_past+interval '1 day',null,'QA receiver',null,null,7,'M3');
    raise exception 'QA_OTHER_DAY_ALLOWED';
  exception when raise_exception then if sqlerrm not in ('DISPATCH_ARRIVAL_DATE_MISMATCH','DISPATCH_INVALID_TIME_SEQUENCE') then raise; end if; end;
  v_version:=public.update_dispatch(v_dispatch,v_version,v_past+interval '46 minutes',null,'QA receiver',null,null,7,'M3');
  execute 'reset role';
  if not exists(select 1 from public.dispatches where id=v_dispatch and arrival_at=v_past+interval '46 minutes' and departure_at=v_past+interval '45 minutes') then raise exception 'QA_TRUCK_AND_DISPATCH_CLOCKS_COUPLED'; end if;
  execute 'set local role authenticated';
  begin
    perform public.update_dispatch(v_dispatch,v_version-1,v_past,null,'QA receiver',null,null,7,'M3');
    raise exception 'QA_STALE_VERSION_ALLOWED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_VERSION_CONFLICT' then raise; end if; end;
  execute 'reset role';
  raise notice 'PASS: actual authenticated arrival correction, audit, earlier truck guide, latest departure, independent clocks, operation day, version conflict';
end;
$$;
rollback;
