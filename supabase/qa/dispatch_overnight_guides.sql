-- DEV only. Actual authenticated overnight guide/dispatch RPCs. All fixtures roll back.
begin;
do $$
declare
  v_project uuid; v_supplier uuid; v_actor uuid; v_other uuid; v_timezone text;
  v_today date; v_past timestamptz; v_lines jsonb; v_item jsonb;
  v_result jsonb; v_dispatch uuid; v_program uuid; v_product uuid; v_reference text;
  v_version integer; v_document uuid; v_a uuid; v_b uuid; v_c uuid; v_day date; v_expected timestamptz; candidate record;
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
    'order_number','QA-validator-'||gen_random_uuid()::text,'lines',v_lines,'delivery_modes',jsonb_build_array('PUMP'));
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  execute 'set local role authenticated';
  v_result:=public.create_programming_batch(v_project,jsonb_build_array(v_item));
  v_program:=(v_result->'programming_ids'->>0)::uuid;
  execute 'reset role';
  v_day:=v_today-7;
  v_dispatch:=public.start_dispatch(v_program,(v_day+time '19:15') at time zone v_timezone,'QA overnight');
  v_version:=1;
  -- Legacy clients send manual clocks on the same date; the server handles rollover.
  v_version:=public.update_dispatch(v_dispatch,v_version,(v_day+time '23:00') at time zone v_timezone,
    (v_day+time '03:00') at time zone v_timezone,'QA overnight',null,v_item->>'order_number',7,'M3');
  execute 'reset role';
  if (select departure_at from public.dispatches where id=v_dispatch) is distinct from ((v_day+1+time '03:00') at time zone v_timezone) then raise exception 'QA_MANUAL_ROLLOVER_FAILED'; end if;
  execute 'set local role authenticated';
  v_lines:=jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',7,'unit_code','M3'));
  v_result:=public.create_dispatch_guide_with_lines(v_dispatch,v_version,'QA-night',v_day,v_lines,time '23:22',time '03:20');
  v_a:=(v_result->>'guide_id')::uuid;v_version:=(v_result->>'dispatch_version')::integer;
  execute 'reset role';
  v_expected:=(v_day+1+time '03:20') at time zone v_timezone;
  if not exists(select 1 from public.dispatch_guides where id=v_a and truck_arrival_at=(v_day+time '23:22') at time zone v_timezone and truck_departure_at=v_expected)
    or (select departure_at from public.dispatches where id=v_dispatch) is distinct from v_expected then raise exception 'QA_NIGHT_GUIDE_OR_ROLLUP_FAILED'; end if;
  -- An earlier same-day clock is not later than an overnight timestamp.
  execute 'set local role authenticated';
  v_result:=public.create_dispatch_guide_with_lines(v_dispatch,v_version,'QA-earlier',v_day,v_lines,time '22:00',time '23:50');
  v_b:=(v_result->>'guide_id')::uuid;v_version:=(v_result->>'dispatch_version')::integer;
  execute 'reset role';
  if (select departure_at from public.dispatches where id=v_dispatch) is distinct from v_expected then raise exception 'QA_SAME_DAY_ROLLUP_REPLACED_NIGHT'; end if;
  execute 'set local role authenticated';
  -- Trucks arriving after midnight use the selected guide date, not the programming date.
  v_result:=public.create_dispatch_guide_with_lines(v_dispatch,v_version,'QA-next-day',v_day+1,v_lines,time '01:00',time '04:00');
  v_c:=(v_result->>'guide_id')::uuid;v_version:=(v_result->>'dispatch_version')::integer;
  execute 'reset role';
  if not exists(select 1 from public.dispatch_guides where id=v_c and truck_arrival_at=(v_day+1+time '01:00') at time zone v_timezone)
    or (select departure_at from public.dispatches where id=v_dispatch) is distinct from ((v_day+1+time '04:00') at time zone v_timezone) then raise exception 'QA_NEXT_DAY_GUIDE_DATE_IGNORED'; end if;
  begin
    update public.dispatch_guides set guide_date=v_day where id=v_c;
    raise exception 'QA_DIRECT_DATE_GUARD_BYPASSED';
  exception when raise_exception then if sqlerrm<>'GUIDE_TRUCK_DATE_MISMATCH' then raise; end if; end;
  execute 'set local role authenticated';
  v_version:=public.update_dispatch_guide_with_lines(v_c,v_version,'QA-next-day-edit',v_day+1,v_lines,time '01:00',time '03:00');
  execute 'reset role';
  if (select departure_at from public.dispatches where id=v_dispatch) is distinct from v_expected then raise exception 'QA_EDIT_MAX_ROLLUP_FAILED'; end if;
  execute 'set local role authenticated';
  v_version:=public.delete_dispatch_guide(v_a,v_version);
  execute 'reset role';
  if (select departure_at from public.dispatches where id=v_dispatch) is distinct from ((v_day+1+time '03:00') at time zone v_timezone) then raise exception 'QA_DELETE_MAX_ROLLUP_FAILED'; end if;
  execute 'set local role authenticated';
  v_version:=public.delete_dispatch_guide(v_c,v_version);
  v_version:=public.update_dispatch_guide_with_lines(v_b,v_version,'QA-final-night',v_day,v_lines,time '23:00',time '03:00');
  begin
    perform public.update_dispatch_guide_with_lines(v_b,v_version-1,'QA-stale',v_day,v_lines,time '23:00',time '03:00');
    raise exception 'QA_VERSION_LOCK_BYPASSED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_VERSION_CONFLICT' then raise; end if; end;
  begin
    perform public.create_dispatch_guide_with_lines(v_dispatch,v_version,'QA-no-time',v_day,v_lines,null,time '03:00');
    raise exception 'QA_NULL_TIME_ALLOWED';
  exception when raise_exception then if sqlerrm<>'GUIDE_TRUCK_TIMES_REQUIRED' then raise; end if; end;
  v_version:=public.update_dispatch(v_dispatch,v_version,(v_day+time '23:05') at time zone v_timezone,
    null,'QA overnight','DISPATCHED',v_item->>'order_number',7,'M3');
  execute 'reset role';
  if (select departure_at from public.dispatches where id=v_dispatch) is distinct from ((v_day+1+time '03:00') at time zone v_timezone) then raise exception 'QA_DISPATCH_SAVE_LOST_NEXT_DAY'; end if;
  -- Calendar arithmetic also handles year/month boundaries.
  if not exists(select 1 from app_private.dispatch_guide_truck_timestamps(v_dispatch,date '2026-12-31',time '23:00',time '03:00') t
    where (t.departure_at at time zone v_timezone)::date=date '2027-01-01') then raise exception 'QA_YEAR_ROLLOVER_FAILED'; end if;
  -- Evidence is still required to complete, and completed guides remain immutable.
  execute 'set local role authenticated';
  begin
    perform public.complete_dispatch(v_dispatch,v_version);
    raise exception 'QA_EVIDENCE_REQUIRED_BYPASSED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_EVIDENCE_REQUIRED' then raise; end if; end;
  execute 'reset role';
  insert into public.documents(project_id,category,created_by) values(v_project,'DISPATCH_EVIDENCE',v_actor) returning id into v_document;
  insert into public.dispatch_documents(project_id,dispatch_id,document_id,purpose) values(v_project,v_dispatch,v_document,'DISPATCH_EVIDENCE');
  insert into public.document_versions(document_id,version,storage_bucket,storage_path,file_name,mime_type,upload_status,uploaded_at,is_current,uploaded_by)
    values(v_document,1,'private-documents','qa-only/'||v_document::text,'qa.pdf','application/pdf','UPLOADED',now(),true,v_actor);
  execute 'set local role authenticated';
  v_version:=public.complete_dispatch(v_dispatch,v_version);
  begin
    perform public.update_dispatch_guide_with_lines(v_b,v_version,'QA-completed',v_day,v_lines,time '23:00',time '03:00');
    raise exception 'QA_COMPLETED_EDIT_ALLOWED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_COMPLETED_NOT_EDITABLE' then raise; end if; end;
  execute 'reset role';
  if not exists(select 1 from public.dispatches where id=v_dispatch and status='COMPLETED' and completed_by=v_actor and departure_at=((v_day+1+time '03:00') at time zone v_timezone)) then raise exception 'QA_NIGHT_COMPLETION_FAILED'; end if;
  for candidate in select id from public.profiles where active and id<>v_actor loop
    perform set_config('request.jwt.claim.sub',candidate.id::text,true);
    if not app_private.has_project_permission(v_project,'dispatch.modify') then v_other:=candidate.id;exit;end if;
  end loop;
  if v_other is null then raise exception 'QA_UNAUTHORIZED_ACTOR_REQUIRED'; end if;
  execute 'set local role authenticated';
  begin
    perform public.create_dispatch_guide_with_lines(v_dispatch,v_version,'QA-forbidden',v_day,v_lines,time '23:00',time '03:00');
    raise exception 'QA_PERMISSION_BYPASSED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  execute 'reset role';
  raise notice 'PASS: midnight create/edit, manual rollover, guide dates, timestamp max across dates, deletion, version/permission/completion locks, evidence requirement and completed_by; full rollback';
end;
$$;
rollback;
