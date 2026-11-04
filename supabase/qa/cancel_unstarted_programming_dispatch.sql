-- Synthetic operations only; all tests and fixture data are rolled back.
begin;
create function pg_temp.qa_cancel_schedule(p_project uuid,p_supplier uuid,p_date timestamptz,p_reference text)
returns uuid language plpgsql as $$
declare v_result jsonb;
begin
  v_result := public.create_programming_batch(p_project,jsonb_build_array(jsonb_build_object(
    'supplier_id',p_supplier,'scheduled_at',p_date,'order_number','QA-CANCEL-'||gen_random_uuid(),
    'delivery_modes',jsonb_build_array('DIRECT'),
    'lines',jsonb_build_array(jsonb_build_object('quantity',12,'unit_code','M3','concrete_type',p_reference)))));
  return (v_result->'programming_ids'->>0)::uuid;
end;
$$;

do $$
declare
  v_actor uuid; v_project uuid; v_supplier uuid; v_timezone text; candidate record;
  v_date date; v_when timestamptz; v_program uuid; v_dispatch uuid; v_version integer; v_dispatch_version integer;
  v_reason text := 'Proveedor no realizará la entrega; cancelar la programación';
  v_product uuid; v_reference text; v_service uuid; v_unit text; v_document uuid; v_batch uuid;
  v_result jsonb; v_count bigint; v_guides jsonb;
begin
  for candidate in
    select p.id,ps.supplier_id,coalesce(nullif(p.timezone,''),'America/Guatemala') timezone,a.id actor
    from public.projects p join public.companies c on c.id=p.company_id and c.status='ACTIVE'
    join public.project_suppliers ps on ps.project_id=p.id and ps.active
    join public.suppliers s on s.id=ps.supplier_id and s.active
    cross join public.profiles a
    where p.status='ACTIVE' and a.active
      and exists(select 1 from public.project_product_prices where project_id=p.id)
      and exists(select 1 from public.project_service_prices where project_id=p.id)
    order by p.id,a.id
  loop
    perform set_config('request.jwt.claim.sub',candidate.actor::text,true);
    if app_private.has_project_permission(candidate.id,'programming.create')
       and app_private.has_project_permission(candidate.id,'programming.cancel')
       and app_private.has_project_permission(candidate.id,'dispatch.create')
       and app_private.has_project_permission(candidate.id,'dispatch.modify')
       and app_private.has_project_permission(candidate.id,'batch.modify') then
      v_actor:=candidate.actor;v_project:=candidate.id;v_supplier:=candidate.supplier_id;v_timezone:=candidate.timezone;exit;
    end if;
  end loop;
  if v_actor is null then raise exception 'QA_CANCEL_OPERATIONAL_ACTOR_REQUIRED';end if;
  v_date := (clock_timestamp() at time zone v_timezone)::date + 12000;
  v_when := (v_date + time '07:00') at time zone v_timezone;
  select id,reference into strict v_product,v_reference from public.project_product_prices where project_id=v_project order by id limit 1;
  select id,coalesce(unit_code,'UN') into strict v_service,v_unit from public.project_service_prices where project_id=v_project order by id limit 1;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  execute 'set local role authenticated';
  v_program:=pg_temp.qa_cancel_schedule(v_project,v_supplier,v_when,v_reference);
  v_dispatch:=public.start_dispatch(v_program,v_when,'QA cancellation');
  execute 'reset role';
  select version into v_version from public.programming where id=v_program;
  select version into v_dispatch_version from public.dispatches where id=v_dispatch;

  -- All rejected requests leave the operation and its dispatch untouched.
  execute 'set local role authenticated';
  begin perform public.cancel_programming(v_program,v_version,'   ');raise exception 'QA_EMPTY_REASON_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_CANCELLATION_REASON_REQUIRED'then raise;end if;end;
  begin perform public.cancel_programming(v_program,v_version,repeat('x',1001));raise exception 'QA_LONG_REASON_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_CANCELLATION_REASON_TOO_LONG'then raise;end if;end;
  begin perform public.cancel_programming(v_program,v_version-1,v_reason);raise exception 'QA_STALE_VERSION_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_VERSION_CONFLICT'then raise;end if;end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  execute 'set local role authenticated';
  begin perform public.cancel_programming(v_program,v_version,v_reason);raise exception 'QA_UNAUTHORIZED_CANCELLATION_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED'then raise;end if;end;
  execute 'reset role';
  if not exists(select 1 from public.programming where id=v_program and version=v_version and status='IN_EXECUTION')
     or not exists(select 1 from public.dispatches where id=v_dispatch and version=v_dispatch_version and status='IN_EXECUTION')then
    raise exception 'QA_REJECTED_CANCELLATION_CHANGED_DATA';end if;

  -- Evidence already attached is preserved, and no evidence is required.
  insert into public.documents(project_id,category,created_by)values(v_project,'DISPATCH_EVIDENCE',v_actor)returning id into v_document;
  insert into public.dispatch_documents(project_id,dispatch_id,document_id,purpose)values(v_project,v_dispatch,v_document,'DISPATCH_EVIDENCE');
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  execute 'set local role authenticated';
  perform public.cancel_programming(v_program,v_version,v_reason);
  execute 'reset role';
  if not exists(select 1 from public.programming where id=v_program and status='CANCELLED'and version=v_version+1)
     or not exists(select 1 from public.dispatches where id=v_dispatch and status='COMPLETED'and result='NOT_DISPATCHED'
       and real_volume=0 and version=v_dispatch_version+1 and completed_by=v_actor and completed_at is not null
       and arrival_at=v_when and departure_at is null and received_by_name='QA cancellation')
     or not exists(select 1 from public.dispatch_documents where dispatch_id=v_dispatch and document_id=v_document)
     or not exists(select 1 from public.documents where id=v_document)then raise exception 'QA_CANCEL_PRESERVATION_FAILED';end if;
  if exists(select 1 from public.dispatch_reconciliations where dispatch_id=v_dispatch)then raise exception 'QA_CANCEL_CREATED_RECONCILIATION';end if;
  if not exists(select 1 from public.programming_revisions where programming_id=v_program and action='PROGRAMMING_CANCELLED'and change_reason=v_reason and created_by=v_actor)
     or not exists(select 1 from public.audit_events where entity_id=v_dispatch and action='DISPATCH_CANCELLED_WITH_PROGRAMMING'and comment=v_reason and actor_user_id=v_actor)then
    raise exception 'QA_CANCEL_REASON_HISTORY_MISSING';end if;
  execute 'set local role authenticated';
  begin
    perform public.create_dispatch_guide_with_lines(v_dispatch,v_dispatch_version+1,'QA-too-late',v_date,
      jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',1,'unit_code','M3')),time '07:00',time '08:00');
    raise exception 'QA_GUIDE_AFTER_CANCELLATION_ALLOWED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_COMPLETED_NOT_EDITABLE'then raise;end if;end;
  execute 'reset role';
  v_batch:=app_private.ensure_batch_month_segment(v_project,v_date);
  execute 'set local role authenticated';
  begin perform public.add_dispatch_to_batch(v_batch,v_dispatch);raise exception 'QA_CANCELLED_DISPATCH_BATCHED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_PROGRAMMING_CANCELLED'then raise;end if;end;

  -- A service guide with zero concrete volume must prevent cancellation too.
  v_program:=pg_temp.qa_cancel_schedule(v_project,v_supplier,v_when,v_reference);
  v_dispatch:=public.start_dispatch(v_program,v_when,'QA service preservation');
  v_result:=public.create_dispatch_guide_with_lines(v_dispatch,1,'QA-service-guide',v_date,
    jsonb_build_array(jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_service,'quantity',1,'unit_code',v_unit)),time '07:00',time '08:00');
  execute 'reset role';
  select version into v_version from public.programming where id=v_program;
  select jsonb_agg(to_jsonb(g))into v_guides from public.dispatch_guides g where dispatch_id=v_dispatch;
  execute 'set local role authenticated';
  begin perform public.cancel_programming(v_program,v_version,v_reason);raise exception 'QA_SERVICE_GUIDE_CANCELLED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_HAS_RECORDED_ACTIVITY'then raise;end if;end;
  execute 'reset role';
  if v_guides is distinct from (select jsonb_agg(to_jsonb(g))from public.dispatch_guides g where dispatch_id=v_dispatch)then raise exception 'QA_GUIDE_CHANGED';end if;

  -- An existing batch relationship also blocks cancellation without removing it.
  execute 'set local role authenticated';
  v_program:=pg_temp.qa_cancel_schedule(v_project,v_supplier,v_when,v_reference);
  v_dispatch:=public.start_dispatch(v_program,v_when,'QA billing preservation');
  perform public.add_dispatch_to_batch(v_batch,v_dispatch);
  execute 'reset role';
  select version into v_version from public.programming where id=v_program;
  execute 'set local role authenticated';
  begin perform public.cancel_programming(v_program,v_version,v_reason);raise exception 'QA_BATCHED_OPERATION_CANCELLED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_HAS_RECORDED_ACTIVITY'then raise;end if;end;
  execute 'reset role';
  if not exists(select 1 from public.batch_dispatches where dispatch_id=v_dispatch and batch_id=v_batch)then raise exception 'QA_BATCH_RELATION_CHANGED';end if;

  -- Ordinary dispatch completion still creates its reconciliation as before.
  execute 'set local role authenticated';
  v_program:=pg_temp.qa_cancel_schedule(v_project,v_supplier,v_when,v_reference);
  v_dispatch:=public.start_dispatch(v_program,v_when,'QA normal completion');
  execute 'reset role';
  update public.dispatches set status='COMPLETED',result='NOT_DISPATCHED',real_volume=0,completed_by=v_actor,completed_at=now()where id=v_dispatch;
  if not exists(select 1 from public.dispatch_reconciliations where dispatch_id=v_dispatch)then raise exception 'QA_NORMAL_RECONCILIATION_BROKEN';end if;
  select version into v_version from public.programming where id=v_program;
  execute 'set local role authenticated';
  begin perform public.cancel_programming(v_program,v_version,v_reason);raise exception 'QA_COMPLETED_DISPATCH_CANCELLED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_HAS_RECORDED_ACTIVITY'then raise;end if;end;
  v_program:=pg_temp.qa_cancel_schedule(v_project,v_supplier,v_when,v_reference);
  execute 'reset role';
  select version into v_version from public.programming where id=v_program;
  execute 'set local role authenticated';perform public.cancel_programming(v_program,v_version,v_reason);execute 'reset role';
  if not exists(select 1 from public.programming where id=v_program and status='CANCELLED')then raise exception 'QA_LEGACY_CANCELLATION_BROKEN';end if;
  if has_function_privilege('anon','public.cancel_programming(uuid,integer,text)','EXECUTE')then raise exception 'QA_ANONYMOUS_ALLOWED';end if;
  raise notice 'PASS: empty started dispatch cancellation, evidence/history preservation, blank/long motive, versions/auth, service guide and billing protection, terminal dispatch, no reconciliation/batch and ordinary completion; rollback';
end;
$$;
rollback;
