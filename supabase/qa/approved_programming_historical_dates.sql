-- DEV only. Exercise authenticated RPCs, then roll back all fixtures.
begin;
do $$
declare
  v_project uuid; v_supplier uuid; v_actor uuid; v_other uuid; v_timezone text;
  v_today date; v_past timestamptz; v_lines jsonb; v_item jsonb; v_result jsonb;
  v_ids uuid[]; v_dispatch uuid; v_manual uuid; v_count bigint; v_bad jsonb; candidate record;
begin
  -- Use actual operational roles; being a platform admin alone grants no
  -- programming/dispatch permissions. Never grant roles for this test.
  for candidate in
    select p.id, r.supplier_id, coalesce(nullif(p.timezone,''),'America/Guatemala') timezone, actor.id actor_id
    from public.projects p join public.companies c on c.id=p.company_id and c.status='ACTIVE'
    join public.project_suppliers r on r.project_id=p.id and r.active
    join public.suppliers s on s.id=r.supplier_id and s.company_id=r.company_id and s.active
    cross join public.profiles actor
    where p.status='ACTIVE' and actor.active order by p.id,actor.id
  loop
    perform set_config('request.jwt.claim.sub',candidate.actor_id::text,true);
    if app_private.has_project_permission(candidate.id,'programming.create')
       and app_private.has_project_permission(candidate.id,'programming.confirm')
       and app_private.has_project_permission(candidate.id,'dispatch.create') then
      v_project:=candidate.id; v_supplier:=candidate.supplier_id;
      v_timezone:=candidate.timezone; v_actor:=candidate.actor_id;
      exit;
    end if;
  end loop;
  if v_actor is null then raise exception 'QA_OPERATIONAL_ACTOR_REQUIRED'; end if;
  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_past := (v_today-7+time '07:00') at time zone v_timezone;
  v_lines := '[{"quantity":7,"unit_code":"M3","concrete_type":"QA-122-CONCRETE"}]'::jsonb;
  v_item := jsonb_build_object('supplier_id',v_supplier,'scheduled_at',v_past,
    'order_number','QA-122-'||gen_random_uuid()::text,'lines',v_lines,'delivery_modes',jsonb_build_array('PUMP'));
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  execute 'set local role authenticated';
  v_result := public.create_programming_batch(v_project,jsonb_build_array(v_item,
    v_item||jsonb_build_object('scheduled_at',(v_today+time '00:01') at time zone v_timezone),
    v_item||jsonb_build_object('scheduled_at',(v_today+7+time '15:00') at time zone v_timezone)));
  execute 'reset role';
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_result->'programming_ids');
  if cardinality(v_ids)<>3 or (select count(*) from public.programming where id=any(v_ids) and status='CONFIRMED' and delivery_modes=array['PUMP'])<>3
    or (select scheduled_at from public.programming where id=v_ids[1])<>v_past then raise exception 'QA_HISTORICAL_BATCH_FAILED'; end if;
  if (select count(*) from public.audit_events where entity_id=any(v_ids) and action='PROGRAMMING_CONFIRMED' and new_values->>'confirmation_source'='APPROVED_MIXTO_WORKBOOK')<>3 then raise exception 'QA_APPROVAL_AUDIT_MISSING'; end if;
  if nullif(current_setting('app.programming_confirmation_source',true),'') is not null then raise exception 'QA_APPROVAL_FLAG_LEAKED'; end if;
  execute 'set local role authenticated';
  v_dispatch := public.start_dispatch(v_ids[1],v_past,'QA historical receiver');
  execute 'reset role';
  if not exists(select 1 from public.dispatches where id=v_dispatch and programming_id=v_ids[1] and order_number=v_item->>'order_number')
    or not exists(select 1 from public.programming where id=v_ids[1] and status='IN_EXECUTION' and scheduled_at=v_past) then raise exception 'QA_HISTORICAL_DISPATCH_FAILED'; end if;

  -- Manual creation cannot inherit the workbook's temporary exception.
  execute 'set local role authenticated';
  begin
    perform public.create_programming_with_details(v_project,v_supplier,v_past,v_lines,'QA manual past');
    raise exception 'QA_MANUAL_PAST_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_SCHEDULE_DATE_IN_PAST' then raise; end if; end;
  -- Manual confirmation still requires a future time, even on the current day.
  v_manual := public.create_programming_with_details(v_project,v_supplier,
    (v_today+time '00:00') at time zone v_timezone,v_lines,'QA manual today');
  begin
    perform public.confirm_programming(v_manual,7,1);
    raise exception 'QA_MANUAL_CONFIRMATION_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_SCHEDULE_MUST_BE_FUTURE' then raise; end if; end;
  execute 'reset role';
  -- Invalid rows cannot partially create their preceding valid row.
  select count(*) into v_count from public.programming;
  foreach v_bad in array array[
    v_item-'scheduled_at',v_item||'{"scheduled_at":"infinity"}',
    v_item||'{"scheduled_at":"not-a-date"}',v_item||'{"order_number":""}',
    v_item||jsonb_build_object('supplier_id',gen_random_uuid()),
    v_item||'{"delivery_modes":["UNKNOWN"]}',
    v_item||'{"lines":[{"quantity":0,"unit_code":"M3","concrete_type":"QA"}]}'
  ] loop
    execute 'set local role authenticated';
    begin
      perform public.create_programming_batch(v_project,jsonb_build_array(v_item,v_bad));
      raise exception 'QA_INVALID_BATCH_ALLOWED';
    exception when raise_exception or invalid_datetime_format then
      if sqlerrm='QA_INVALID_BATCH_ALLOWED' then raise; end if;
    end;
    execute 'reset role';
    if (select count(*) from public.programming)<>v_count then raise exception 'QA_PARTIAL_BATCH_INSERT'; end if;
  end loop;
  -- Backdating an existing manual row also remains guarded.
  begin
    update public.programming set scheduled_at=v_past where id=v_manual;
    raise exception 'QA_MANUAL_RESCHEDULE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_SCHEDULE_DATE_IN_PAST' then raise; end if; end;
  select p.id into v_other from public.profiles p where p.active and p.id<>v_actor
    and not exists(select 1 from public.platform_admins a where a.user_id=p.id and a.active)
    and not exists(select 1 from public.project_members m where m.user_id=p.id and m.project_id=v_project)
    and not exists(select 1 from public.company_members m join public.projects pr on pr.company_id=m.company_id where m.user_id=p.id and pr.id=v_project)
    limit 1;
  if v_other is null then raise exception 'QA_UNAUTHORIZED_ACTOR_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',v_other::text,true);
  execute 'set local role authenticated';
  begin
    perform public.create_programming_batch(v_project,jsonb_build_array(v_item));
    raise exception 'QA_PERMISSION_BYPASSED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role authenticated';
  begin
    perform public.create_programming_batch(v_project,jsonb_build_array(v_item));
    raise exception 'QA_AUTH_BYPASSED';
  exception when raise_exception then if sqlerrm<>'AUTH_REQUIRED' then raise; end if; end;
  execute 'reset role';
  raise notice 'PASS: historical/today/future approved import, audit, historical dispatch, manual guards, atomicity, finite dates, supplier, modalities, quantity, permission and authentication';
end;
$$;
rollback;
