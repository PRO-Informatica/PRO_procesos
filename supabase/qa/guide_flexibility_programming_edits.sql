-- DEV only. Real authenticated RPCs; every fixture and catalog change rolls back.
begin;
do $$
declare
  v_project uuid; v_supplier uuid; v_actor uuid; v_other uuid; v_timezone text;
  v_today date; v_past timestamptz; v_lines jsonb; v_item jsonb;
  v_result jsonb; v_dispatch uuid; v_program uuid; v_product uuid; v_reference text;
  v_service uuid; v_service_unit text; v_service_price numeric; v_service_line uuid;
  v_service_guide uuid; v_mixed_guide uuid; v_program_version integer; v_manual uuid;
  v_version integer; candidate record;
begin
  -- Use actual operational roles; being a platform admin alone grants no
  -- programming/dispatch permissions. Never grant roles for this test.
  for candidate in
    select p.id, r.supplier_id, coalesce(nullif(p.timezone,''),'America/Guatemala') timezone, actor.id actor_id
    from public.projects p join public.companies c on c.id=p.company_id and c.status='ACTIVE'
    join public.project_suppliers r on r.project_id=p.id and r.active
    join public.suppliers s on s.id=r.supplier_id and s.company_id=r.company_id and s.active
    cross join public.profiles actor
    where p.status='ACTIVE' and actor.active and exists(select 1 from public.project_product_prices price where price.project_id=p.id) and exists(select 1 from public.project_service_prices service where service.project_id=p.id) order by p.id,actor.id
  loop
    perform set_config('request.jwt.claim.sub',candidate.actor_id::text,true);
    if app_private.has_project_permission(candidate.id,'programming.create')
       and app_private.has_project_permission(candidate.id,'programming.confirm')
       and app_private.has_project_permission(candidate.id,'dispatch.create')
       and app_private.has_project_permission(candidate.id,'dispatch.modify')
       and app_private.has_project_permission(candidate.id,'programming.modify') then
      v_project:=candidate.id; v_supplier:=candidate.supplier_id;
      v_timezone:=candidate.timezone; v_actor:=candidate.actor_id;
      exit;
    end if;
  end loop;
  if v_actor is null then raise exception 'QA_OPERATIONAL_ACTOR_REQUIRED'; end if;
  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_past := (v_today-7+time '07:00') at time zone v_timezone;
  select id,reference into strict v_product,v_reference from public.project_product_prices where project_id=v_project order by id limit 1;
  select id,coalesce(unit_code,'UN'),price into strict v_service,v_service_unit,v_service_price from public.project_service_prices where project_id=v_project order by id limit 1;
  v_lines := jsonb_build_array(jsonb_build_object('quantity',7,'unit_code','M3','concrete_type',v_reference));
  v_item := jsonb_build_object('supplier_id',v_supplier,'scheduled_at',v_past,
    'order_number','QA-flex-'||gen_random_uuid()::text,'lines',v_lines,'delivery_modes',jsonb_build_array('PUMP'));
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  execute 'set local role authenticated';
  v_result := public.create_programming_batch(v_project,jsonb_build_array(v_item));
  v_program := (v_result->'programming_ids'->>0)::uuid;
  -- Both the old and the new date are historical, including a delivery-mode change.
  v_program_version:=public.update_programming_with_details(v_program,2,v_supplier,v_past+interval '1 day',v_lines,v_item->>'order_number','QA correction','Historical edit',array['DIRECT']);
  execute 'reset role';
  if not exists(select 1 from public.programming where id=v_program and status='PENDING_CONFIRMATION' and confirmed_at is null and confirmed_by is null and confirmed_quantity is null and delivery_modes=array['DIRECT'] and version=v_program_version)
    or not exists(select 1 from public.programming_revisions where programming_id=v_program and programming_version=v_program_version and action='PROGRAMMING_UPDATED' and change_reason='QA correction') then raise exception 'QA_EDIT_AUDIT_OR_RECONFIRMATION_FAILED'; end if;
  if nullif(current_setting('app.programming_edit_source',true),'') is not null then raise exception 'QA_EDIT_FLAG_LEAKED'; end if;
  execute 'set local role authenticated';
  v_program_version:=public.confirm_programming(v_program,7,v_program_version);
  -- A schedule on today's date can also be edited and reconfirmed after its hour.
  v_result:=public.create_programming_batch(v_project,jsonb_build_array(v_item||jsonb_build_object('scheduled_at',(v_today+time '00:00') at time zone v_timezone)));
  v_manual:=(v_result->'programming_ids'->>0)::uuid;
  v_version:=public.update_programming_with_details(v_manual,2,v_supplier,(v_today+time '00:01') at time zone v_timezone,v_lines,'QA today','QA today edit',null,array['PUMP']);
  v_version:=public.confirm_programming(v_manual,7,v_version);
  begin
    perform public.create_programming_with_details(v_project,v_supplier,v_past,v_lines,'QA manual past');
    raise exception 'QA_MANUAL_PAST_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_SCHEDULE_DATE_IN_PAST' then raise; end if; end;
  v_manual:=public.create_programming_with_details(v_project,v_supplier,(v_today+time '00:00') at time zone v_timezone,v_lines,'QA unedited today');
  begin
    perform public.confirm_programming(v_manual,7,1);
    raise exception 'QA_UNEDITED_PAST_CONFIRMATION_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_SCHEDULE_MUST_BE_FUTURE' then raise; end if; end;
  -- Dispatch registration happens after the first truck left. No clock correction.
  v_past:=v_past+interval '1 day';
  v_dispatch:=public.start_dispatch(v_program,v_past+interval '5 minutes','QA receiver');
  v_version:=1;
  begin
    perform public.update_programming_with_details(v_program,v_program_version+1,v_supplier,v_past,v_lines,'QA','QA forbidden edit');
    raise exception 'QA_PROGRAM_WITH_DISPATCH_EDITABLE';
  exception when raise_exception then if sqlerrm not in ('PROGRAMMING_NOT_EDITABLE','PROGRAMMING_EDIT_HAS_DISPATCHES') then raise; end if; end;
  v_lines:=jsonb_build_array(jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_service,'quantity',2,'unit_code',v_service_unit));
  v_result:=public.create_dispatch_guide_with_lines(v_dispatch,v_version,'QA-service-'||gen_random_uuid()::text,(v_today-6),v_lines,time '07:00',time '07:02');
  v_service_guide:=(v_result->>'guide_id')::uuid;v_version:=(v_result->>'dispatch_version')::integer;
  execute 'reset role';
  if not exists(select 1 from public.dispatch_guides where id=v_service_guide and quantity=0 and unit_code='M3')
    or not exists(select 1 from public.dispatches where id=v_dispatch and arrival_at=v_past+interval '5 minutes' and departure_at=v_past+interval '2 minutes') then raise exception 'QA_SERVICE_ONLY_OR_CLOCK_INDEPENDENCE_FAILED'; end if;
  select id into strict v_service_line from public.dispatch_guide_lines where guide_id=v_service_guide;
  if not exists(select 1 from public.dispatch_guide_lines where id=v_service_line and quantity=2 and unit_price=v_service_price and estimated_subtotal=2*v_service_price) then raise exception 'QA_SERVICE_PRICE_FAILED'; end if;
  -- Existing lines retain their original price after a catalog update.
  update public.project_service_prices set price=price+123 where id=v_service;
  v_lines:=jsonb_build_array(jsonb_build_object('line_id',v_service_line,'catalog_type','SERVICE','catalog_item_id',v_service,'quantity',3,'unit_code',v_service_unit));
  execute 'set local role authenticated';
  v_version:=public.update_dispatch_guide_with_lines(v_service_guide,v_version,'QA-service-edit',(v_today-6),v_lines,time '06:00',time '06:30');
  execute 'reset role';
  if not exists(select 1 from public.dispatch_guides where id=v_service_guide and quantity=0)
    or not exists(select 1 from public.dispatch_guide_lines where id=v_service_line and quantity=3 and unit_price=v_service_price and estimated_subtotal=3*v_service_price) then raise exception 'QA_SERVICE_EDIT_OR_SNAPSHOT_FAILED'; end if;
  v_lines:=jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',7,'unit_code','M3'),jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_service,'quantity',5,'unit_code',v_service_unit));
  execute 'set local role authenticated';
  v_result:=public.create_dispatch_guide_with_lines(v_dispatch,v_version,'QA-mixed',(v_today-6),v_lines,time '07:00',time '08:00');
  v_mixed_guide:=(v_result->>'guide_id')::uuid;v_version:=(v_result->>'dispatch_version')::integer;
  execute 'reset role';
  if (select sum(quantity) from public.dispatch_guides where dispatch_id=v_dispatch)<>7 then raise exception 'QA_SERVICES_CHANGED_PHYSICAL_VOLUME'; end if;
  execute 'set local role authenticated';
  v_version:=public.delete_dispatch_guide(v_mixed_guide,v_version);
  -- Registration can be corrected independently of all recorded truck times.
  v_version:=public.update_dispatch(v_dispatch,v_version,v_past+interval '1 hour',null,'QA receiver',null,null,7,'M3');
  execute 'reset role';
  if not exists(select 1 from public.dispatches where id=v_dispatch and arrival_at=v_past+interval '1 hour' and departure_at=v_past-interval '30 minutes') then raise exception 'QA_GUIDE_ROLLUP_REGRESSED'; end if;
  begin
    update public.dispatch_guides set quantity=-1 where id=v_service_guide;
    raise exception 'QA_NEGATIVE_VOLUME_ALLOWED';
  exception when check_violation then null; end;
  execute 'set local role authenticated';
  begin
    perform public.create_dispatch_guide_with_lines(v_dispatch,v_version,'QA-empty',(v_today-6),'[]',time '06:00',time '06:30');
    raise exception 'QA_EMPTY_GUIDE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_GUIDE_LINES_REQUIRED' then raise; end if; end;
  begin
    perform public.create_dispatch_guide_with_lines(v_dispatch,v_version,'QA-reverse',(v_today-6),v_lines,time '08:00',time '07:00');
    raise exception 'QA_REVERSED_TRUCK_ALLOWED';
  exception when raise_exception then if sqlerrm<>'GUIDE_TRUCK_INVALID_TIME_SEQUENCE' then raise; end if; end;
  begin
    perform public.update_dispatch(v_dispatch,v_version,v_past+interval '1 day',null,'QA receiver',null,null,7,'M3');
    raise exception 'QA_OTHER_DAY_ALLOWED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_ARRIVAL_DATE_MISMATCH' then raise; end if; end;
  begin
    perform public.update_dispatch_guide_with_lines(v_service_guide,v_version-1,'QA-stale',(v_today-6),v_lines,time '06:00',time '06:30');
    raise exception 'QA_STALE_GUIDE_VERSION_ALLOWED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_VERSION_CONFLICT' then raise; end if; end;
  v_version:=public.delete_dispatch_guide(v_service_guide,v_version);
  -- With no timed guides, manually entered dispatch times are still ordered.
  begin
    perform public.update_dispatch(v_dispatch,v_version,v_past,v_past-interval '1 minute','QA receiver',null,null,7,'M3');
    raise exception 'QA_MANUAL_SEQUENCE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_INVALID_TIME_SEQUENCE' then raise; end if; end;
  execute 'reset role';
  select p.id into v_other from public.profiles p where p.active and p.id<>v_actor
    and not exists(select 1 from public.platform_admins a where a.user_id=p.id and a.active)
    and not exists(select 1 from public.project_members m where m.user_id=p.id and m.project_id=v_project)
    and not exists(select 1 from public.company_members m join public.projects pr on pr.company_id=m.company_id where m.user_id=p.id and pr.id=v_project) limit 1;
  if v_other is null then raise exception 'QA_UNAUTHORIZED_ACTOR_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',v_other::text,true);
  execute 'set local role authenticated';
  begin
    perform public.create_dispatch_guide_with_lines(v_dispatch,v_version,'QA-forbidden',(v_today-6),v_lines,time '06:00',time '06:30');
    raise exception 'QA_PERMISSION_BYPASSED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  execute 'reset role';
  raise notice 'PASS: service-only create/edit, physical totals, catalog snapshots, independent truck/dispatch clocks, max rollup, deletion, manual/truck sequences, dates, permissions, versions, historical/today edit/reconfirmation and dispatch lock';
end;
$$;
rollback;
