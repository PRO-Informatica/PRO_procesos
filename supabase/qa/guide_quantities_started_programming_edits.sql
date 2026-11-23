-- DEV only. Run inside a transaction that rolls back all fixtures.
do $qa$
declare
  v_project public.projects%rowtype;
  v_supplier uuid;
  v_product_reference text;
  v_service uuid;
  v_actor uuid;
  v_admin uuid;
  v_resident uuid;
  v_programming uuid;
  v_programming_version integer;
  v_dispatch uuid;
  v_dispatch_before public.dispatches%rowtype;
  v_dispatch_version integer;
  v_guide uuid;
  v_capture uuid;
  v_document uuid;
  v_day date := date '2026-11-19';
  v_arrival timestamptz;
  v_planned_at timestamptz;
  v_order text := 'QA-' || gen_random_uuid()::text;
  v_lines jsonb;
  v_service_line jsonb;
  v_result jsonb;
  v_document_type text;
  v_reason text := 'Corregir la fecha y el volumen de la programación';
begin
  select * into strict v_project from public.projects where name = 'ACOAT' and status = 'ACTIVE';
  select relation.supplier_id into strict v_supplier
  from public.project_suppliers relation join public.suppliers supplier on supplier.id = relation.supplier_id
  where relation.project_id = v_project.id and relation.active and supplier.active order by relation.supplier_id limit 1;
  select reference into strict v_product_reference from public.project_product_prices
  where project_id = v_project.id and reference is not null order by id limit 1;
  select id into strict v_service from public.project_service_prices
  where project_id = v_project.id and code = 'SERV0507' order by id limit 1;

  for v_actor in select id from public.profiles where active order by id loop
    perform set_config('request.jwt.claim.sub', v_actor::text, true);
    if not app_private.has_project_permission(v_project.id, 'programming.modify') then continue; end if;
    if app_private.is_company_admin(v_project.company_id) then
      v_admin := v_actor;
    elsif app_private.has_project_permission(v_project.id, 'programming.create')
       and app_private.has_project_permission(v_project.id, 'dispatch.create')
       and app_private.has_project_permission(v_project.id, 'dispatch.manage_guides') then
      v_resident := v_actor;
    end if;
    exit when v_admin is not null and v_resident is not null;
  end loop;
  if v_admin is null or v_resident is null then raise exception 'QA_ROLE_FIXTURES_MISSING'; end if;

  v_arrival := (v_day + time '08:00') at time zone v_project.timezone;
  v_planned_at := ((v_day + 1) + time '09:30') at time zone v_project.timezone;
  v_lines := jsonb_build_array(jsonb_build_object('quantity', 7, 'unit_code', 'M3', 'concrete_type', v_product_reference));
  perform set_config('request.jwt.claim.sub', v_resident::text, true);
  set local role authenticated;
  v_programming := public.create_programming_with_details(
    v_project.id, v_supplier, v_arrival, v_lines, v_order, null, array['PUMP']);
  v_programming_version := public.update_programming_with_details(
    v_programming, 1, v_supplier, v_arrival + interval '30 minutes', v_lines, v_order, 'Edición del residente');
  v_dispatch := public.start_dispatch(v_programming, v_arrival, 'QA');
  v_programming_version := v_programming_version + 1;
  reset role;

  select * into strict v_dispatch_before from public.dispatches where id = v_dispatch;
  set local role authenticated;
  begin
    perform public.update_programming_with_details(v_programming, v_programming_version, v_supplier, v_planned_at, v_lines, v_order, v_reason);
    raise exception 'QA_STARTED_EDIT_ALLOWED_FOR_RESIDENT';
  exception when raise_exception then
    if sqlerrm <> 'PROGRAMMING_STARTED_EDIT_REQUIRES_ADMIN' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    perform public.update_programming_with_details(v_programming, v_programming_version, v_supplier, v_planned_at, v_lines, v_order, ' ');
    raise exception 'QA_STARTED_EDIT_ALLOWED_WITHOUT_REASON';
  exception when raise_exception then
    if sqlerrm <> 'PROGRAMMING_EDIT_REASON_REQUIRED' then raise; end if;
  end;
  begin
    perform public.update_programming_with_details(v_programming, v_programming_version, v_supplier, v_planned_at, v_lines, v_order, v_reason, null, array['DIRECT']);
    raise exception 'QA_STARTED_EDIT_CHANGED_BILLING_MODE';
  exception when raise_exception then
    if sqlerrm <> 'PROGRAMMING_DELIVERY_MODES_LOCKED' then raise; end if;
  end;
  v_lines := jsonb_set(v_lines, '{0,quantity}', '6');
  v_programming_version := public.update_programming_with_details(
    v_programming, v_programming_version, v_supplier, v_planned_at, v_lines, v_order || '-REVISED', v_reason);
  reset role;
  if not exists (
    select 1 from public.programming p where p.id = v_programming and p.status = 'IN_EXECUTION'
      and p.scheduled_at = v_planned_at and p.requested_quantity = 6 and p.confirmed_quantity = 6
      and p.version = v_programming_version
  ) or (select to_jsonb(d) from public.dispatches d where d.id = v_dispatch) is distinct from to_jsonb(v_dispatch_before) then
    raise exception 'QA_STARTED_EDIT_CHANGED_DISPATCH_OR_LOST_PLANNING';
  end if;
  if not exists (
    select 1 from public.programming_revisions r where r.programming_id = v_programming
      and r.programming_version = v_programming_version and r.change_reason = v_reason and r.created_by = v_admin
  ) or not exists (
    select 1 from public.audit_events a where a.entity_id = v_programming and a.action = 'PROGRAMMING_UPDATED'
      and a.comment = v_reason and a.actor_user_id = v_admin
  ) then raise exception 'QA_STARTED_EDIT_AUDIT_MISSING'; end if;

  v_service_line := jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_service,'quantity',0,'unit_code',null);
  v_dispatch_version := v_dispatch_before.version;
  set local role authenticated;
  v_result := public.create_dispatch_guide_with_details(v_dispatch,v_dispatch_version,'QA-ZERO',v_day,
    jsonb_build_array(v_service_line),'08:00','08:15','COLUMNS',false,'{"documentType":"DISPATCH_GUIDE"}');
  v_guide := (v_result->>'guide_id')::uuid;
  v_dispatch_version := (v_result->>'dispatch_version')::integer;
  set constraints public.dispatch_guide_lines_zero_quantity_guard, public.dispatch_guides_zero_quantity_type_guard immediate;
  set constraints public.dispatch_guide_lines_zero_quantity_guard, public.dispatch_guides_zero_quantity_type_guard deferred;
  v_dispatch_version := public.update_dispatch_guide_with_details(v_guide,v_dispatch_version,'QA-ZERO-EDITED',v_day,
    jsonb_build_array(v_service_line),'08:00','08:20','COLUMNS',false,'{"documentType":"DISPATCH_GUIDE"}');
  foreach v_document_type in array array['MIXTO_OPERATION','PANEXUS_OPERATION'] loop
    begin
      perform public.create_dispatch_guide_with_details(v_dispatch,v_dispatch_version,'QA-BLOCK-'||v_document_type,v_day,
        jsonb_build_array(v_service_line),'08:00','08:15','COLUMNS',false,jsonb_build_object('documentType',v_document_type));
      set constraints public.dispatch_guide_lines_zero_quantity_guard, public.dispatch_guides_zero_quantity_type_guard immediate;
      raise exception 'QA_CONTROL_ZERO_ALLOWED';
    exception when raise_exception then
      if sqlerrm <> 'DISPATCH_GUIDE_ZERO_QUANTITY_NOT_ALLOWED' then raise; end if;
    end;
    v_result := public.create_dispatch_guide_with_details(v_dispatch,v_dispatch_version,'QA-POSITIVE-'||v_document_type,v_day,
      jsonb_build_array(v_service_line || '{"quantity":6}'),'08:00','08:15','COLUMNS',false,jsonb_build_object('documentType',v_document_type));
    v_dispatch_version := (v_result->>'dispatch_version')::integer;
  end loop;
  begin
    update public.dispatch_guides set details = '{"documentType":"MIXTO_OPERATION"}' where id = v_guide;
    raise exception 'QA_DIRECT_GUIDE_UPDATE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  reset role;
  if not exists (
    select 1 from public.dispatch_guide_lines l join public.dispatch_guides g on g.id = l.guide_id
    where g.id = v_guide and g.guide_number = 'QA-ZERO-EDITED' and g.quantity = 0
      and l.quantity = 0 and l.unit_code is null and l.estimated_subtotal = 0
  ) then raise exception 'QA_MANUAL_ZERO_NOT_PERSISTED'; end if;

  insert into public.guide_ocr_captures(project_id,dispatch_id,created_by,status,original_path,original_name,original_mime,original_size,original_sha256,extraction,review_payload,review_hash)
  values(v_project.id,v_dispatch,v_admin,'EXTRACTED','qa/'||gen_random_uuid(),'qa.jpg','image/jpeg',100,repeat('a',64),'{}',
    jsonb_build_object('casting_element','COLUMNS','laboratory_applied',false,'guide_number','QA-OCR-ZERO','guide_date',v_day,'arrival','08:10','departure','08:25',
      'details',jsonb_build_object('documentType','DISPATCH_GUIDE'),'lines',jsonb_build_array(
        jsonb_build_object('catalog_type','SERVICE','product_code','QA-UNKNOWN-ZERO','quantity',0))),
    'approved')
  returning id into v_capture;
  set local role authenticated;
  v_result := public.commit_vision_ocr_guide(v_capture,v_dispatch_version,'approved');
  v_dispatch_version := (v_result->>'dispatch_version')::integer;
  set constraints public.dispatch_guide_lines_zero_quantity_guard, public.dispatch_guides_zero_quantity_type_guard immediate;
  reset role;
  if not exists (
    select 1 from public.dispatch_guide_lines where guide_id = (v_result->>'guide_id')::uuid and quantity = 0
  ) then raise exception 'QA_OCR_ZERO_NOT_PERSISTED'; end if;

  insert into public.documents(project_id,category,created_by)
  values(v_project.id,'DISPATCH_EVIDENCE',v_admin) returning id into v_document;
  insert into public.dispatch_documents(project_id,dispatch_id,document_id,purpose)
  values(v_project.id,v_dispatch,v_document,'DISPATCH_EVIDENCE');
  insert into public.document_versions(document_id,version,storage_bucket,storage_path,file_name,mime_type,upload_status,uploaded_at,is_current,uploaded_by)
  values(v_document,1,'private-documents','qa-only/'||v_document,'qa.pdf','application/pdf','UPLOADED',now(),true,v_admin);

  set local role authenticated;
  v_dispatch_version := public.update_dispatch(v_dispatch,v_dispatch_version,v_arrival,null,'QA','DISPATCHED',v_order,6,'M3');
  perform public.complete_dispatch(v_dispatch,v_dispatch_version);
  v_programming_version := public.update_programming_with_details(
    v_programming,v_programming_version+1,v_supplier,v_planned_at,v_lines,v_order,v_reason);
  reset role;
  if not exists (select 1 from public.programming where id = v_programming and status = 'DISPATCH_COMPLETED'
    and version = v_programming_version) then raise exception 'QA_COMPLETED_DISPATCH_EDIT_CHANGED_STATUS'; end if;

  raise notice 'GUIDE_PROGRAMMING_QA_PASS: roles, reason, state, audit, manual/OCR zero, controls, zero subtotals, completion and operation date';
end;
$qa$;
