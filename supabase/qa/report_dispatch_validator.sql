-- DEV only: finish a synthetic dispatch and resolve its actual finalizer. Full rollback.
begin;
do $$
declare
  v_project uuid; v_supplier uuid; v_actor uuid; v_other uuid; v_timezone text;
  v_today date; v_past timestamptz; v_lines jsonb; v_item jsonb;
  v_result jsonb; v_dispatch uuid; v_program uuid; v_product uuid; v_reference text;
  v_version integer; v_document uuid; v_label text; candidate record;
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
  -- Seed a synthetic dispatch owned by another existing user. The real
  -- completion RPC below must keep that creator and record its own actor.
  select id into strict v_other from public.profiles where active and id<>v_actor order by id limit 1;
  insert into public.dispatches(project_id,supplier_id,programming_id,status,version,created_by,arrival_at,received_by,received_by_name,order_number)
    values(v_project,v_supplier,v_program,'IN_EXECUTION',1,v_other,v_past,v_other,'QA receiver',v_item->>'order_number') returning id into v_dispatch;
  update public.programming set status='IN_EXECUTION',version=version+1 where id=v_program;
  execute 'set local role authenticated';
  v_lines:=jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',7,'unit_code','M3'));
  v_result:=public.create_dispatch_guide_with_lines(v_dispatch,1,'QA-validator',(v_today-7),v_lines,time '07:00',time '07:45');
  v_version:=(v_result->>'dispatch_version')::integer;
  v_version:=public.update_dispatch(v_dispatch,v_version,v_past,null,'QA receiver','DISPATCHED',v_item->>'order_number',7,'M3');
  execute 'reset role';
  insert into public.documents(project_id,category,created_by)
    values(v_project,'DISPATCH_EVIDENCE',v_actor) returning id into v_document;
  insert into public.dispatch_documents(project_id,dispatch_id,document_id,purpose)
    values(v_project,v_dispatch,v_document,'DISPATCH_EVIDENCE');
  insert into public.document_versions(document_id,version,storage_bucket,storage_path,file_name,mime_type,upload_status,uploaded_at,is_current,uploaded_by)
    values(v_document,1,'private-documents','qa-only/'||v_document::text,'qa.pdf','application/pdf','UPLOADED',now(),true,v_actor);
  execute 'set local role authenticated';
  v_version:=public.complete_dispatch(v_dispatch,v_version);
  execute 'reset role';
  if not exists(select 1 from public.dispatches where id=v_dispatch and status='COMPLETED' and completed_by=v_actor and created_by=v_other and completed_at is not null) then raise exception 'QA_COMPLETED_BY_NOT_ACTUAL_FINALIZER'; end if;
  execute 'set local role authenticated';
  select display_label into strict v_label from public.get_report_actor_labels(array[v_project]) where profile_id=v_actor;
  if nullif(btrim(v_label),'') is null then raise exception 'QA_FINALIZER_LABEL_MISSING'; end if;
  if exists(select 1 from public.get_report_actor_labels(array[]::uuid[])) or exists(select 1 from public.get_report_actor_labels(null)) then raise exception 'QA_EMPTY_SCOPE_LEAK'; end if;
  execute 'reset role';
  -- A caller outside the operational scope cannot resolve those names.
  v_other:=null;
  for candidate in select id from public.profiles where active and id<>v_actor loop
    perform set_config('request.jwt.claim.sub',candidate.id::text,true);
    if not app_private.has_project_permission(v_project,'dispatch.view') then v_other:=candidate.id;exit;end if;
  end loop;
  if v_other is null then raise exception 'QA_UNAUTHORIZED_ACTOR_REQUIRED'; end if;
  execute 'set local role authenticated';
  if exists(select 1 from public.get_report_actor_labels(array[v_project])) then raise exception 'QA_REPORT_SCOPE_LEAK'; end if;
  execute 'reset role';
  raise notice 'PASS: actual dispatch completion, separate creator/finalizer, actor labels, empty scopes and unauthorized scopes';
end;
$$;
rollback;
