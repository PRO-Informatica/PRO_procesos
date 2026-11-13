-- Synthetic DEV operations and temporary role assignments. Always roll back.
begin;
do $$
declare
  actor uuid; project uuid; member uuid; supplier uuid;
  supervisor uuid; resident uuid; product uuid; reference text;
  program uuid; dispatch uuid; guide uuid; line uuid; document uuid; capture uuid;
  response jsonb; lines jsonb; payload jsonb; before_dispatch jsonb;
  version integer; permission text;
begin
  select id into strict supervisor from public.roles where code = 'SUPERVISOR' and active;
  select id into strict resident from public.roles where code = 'RESIDENT' and active;
  if exists(select 1 from public.roles where code = 'RECEPTION') then raise exception 'QA_RECEPTION_STILL_EXISTS'; end if;
  if exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
    where rp.role_id=supervisor and not (
      p.code in ('programming.view','dispatch.view','document.view','dispatch.create','dispatch.manage_guides')
    )) then raise exception 'QA_SUPERVISOR_WRITE_OR_GMAIL_LEAK'; end if;
  if not exists(select 1 from public.roles r join public.role_permissions rp on rp.role_id=r.id
                join public.permissions p on p.id=rp.permission_id where r.code='COMPANY_ADMIN' and p.code='dispatch.complete') then
    raise exception 'QA_ADMIN_COMPLETION_LOST';
  end if;

  -- Use an active project member with no other company-level grants.
  select pm.user_id, pm.project_id, pm.id, ps.supplier_id
  into actor, project, member, supplier
  from public.project_members pm
  join public.profiles a on a.id=pm.user_id and a.active
  join public.projects p on p.id=pm.project_id and p.status='ACTIVE'
  join public.company_members cm on cm.company_id=p.company_id and cm.user_id=a.id and cm.active
  join public.project_suppliers ps on ps.project_id=p.id and ps.active
  join public.suppliers s on s.id=ps.supplier_id and s.active
  where pm.active and exists(select 1 from public.project_product_prices where project_id=p.id)
    and not exists(select 1 from public.company_member_roles cr
      join public.roles r on r.id=cr.role_id and r.active
      join public.role_permissions rp on rp.role_id=r.id
      join public.permissions permission on permission.id=rp.permission_id
      where cr.company_member_id=cm.id and cr.revoked_at is null)
  order by pm.id limit 1;
  if actor is null then raise exception 'QA_NON_ADMIN_PROJECT_MEMBER_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  -- These assignments are restored by the outer rollback, never committed.
  delete from public.project_member_roles where project_member_id=member;
  insert into public.project_member_roles(project_member_id,role_id,assigned_by) values(member,resident,actor);
  select price.id,price.reference into strict product,reference from public.project_product_prices price where price.project_id=project order by price.id limit 1;
  execute 'set local role authenticated';
  response:=public.create_programming_batch(project,jsonb_build_array(jsonb_build_object('supplier_id',supplier,
    'scheduled_at','2026-11-05T13:00:00Z','order_number','QA-SUPERVISOR-'||gen_random_uuid(),'delivery_modes',jsonb_build_array('DIRECT'),
    'lines',jsonb_build_array(jsonb_build_object('quantity',7,'unit_code','M3','concrete_type',reference)))));
  program:=(response->'programming_ids'->>0)::uuid;
  execute 'reset role';
  delete from public.project_member_roles where project_member_id=member;
  insert into public.project_member_roles(project_member_id,role_id,assigned_by) values(member,supervisor,actor);
  foreach permission in array array['programming.view','dispatch.view','dispatch.create','dispatch.manage_guides','document.view'] loop
    if not app_private.has_project_permission(project,permission) then raise exception 'QA_PERMISSION_MISSING: %',permission; end if;
  end loop;
  foreach permission in array array['programming.create','programming.confirm','programming.modify','programming.cancel','programming.close',
    'dispatch.modify','dispatch.complete','dispatch.register_incident','document.upload','batch.view','invoice.view','report.view','gmail.mailbox.view','gmail.mail.send'] loop
    if app_private.has_project_permission(project,permission) then raise exception 'QA_PERMISSION_LEAK: %',permission; end if;
  end loop;
  execute 'set local role authenticated';
  begin perform public.create_programming_batch(project,'[]'); raise exception 'QA_PROGRAMMING_CREATE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  dispatch:=public.start_dispatch(program,'2026-11-05T13:00:00Z','QA Supervisor');
  lines:=jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',product,'quantity',7,'unit_code',null));
  response:=public.create_dispatch_guide_with_details(dispatch,1,'QA-SUPERVISOR',date '2026-11-05',lines,time '23:00',time '03:00','COLUMNS',false,'{}');
  guide:=(response->>'guide_id')::uuid; version:=(response->>'dispatch_version')::integer;
  select id into strict line from public.dispatch_guide_lines where guide_id=guide;
  lines:=jsonb_build_array(jsonb_build_object('line_id',line,'catalog_type','PRODUCT','catalog_item_id',product,'quantity',8,'unit_code',null));
  version:=public.update_dispatch_guide_with_details(guide,version,'QA-SUPERVISOR-EDIT',date '2026-11-05',lines,time '23:00',time '03:30','PILES',true,'{}');
  execute 'reset role';
  if not exists(select 1 from public.dispatch_guides where id=guide and quantity=8 and casting_element='PILES' and laboratory_applied) then
    raise exception 'QA_SUPERVISOR_GUIDE_EDIT_FAILED';
  end if;

  -- OCR commits use the same guide permissions, with no external OCR call/file.
  payload:=jsonb_build_object('casting_element','COLUMNS','laboratory_applied',false,'guide_number','QA-SUPERVISOR-OCR',
    'guide_date','2026-11-05','arrival','23:10','departure','03:40','identity_checks','[]'::jsonb,'parser_version','qa',
    'details','{}'::jsonb,'lines',jsonb_build_array(jsonb_build_object('catalog_type','SERVICE','quantity',1,'unit_code',null,
      'product_code','QA-UNKNOWN-'||gen_random_uuid(),'product_description','Servicio QA')));
  insert into public.guide_ocr_captures(project_id,dispatch_id,created_by,status,original_path,original_name,original_mime,original_size,original_sha256,
    extraction,review_payload,review_hash) values(project,dispatch,actor,'EXTRACTED','qa/'||gen_random_uuid(),'qa.jpg','image/jpeg',100,repeat('a',64),'{}',payload,'qa-approved') returning id into capture;
  execute 'set local role authenticated';
  response:=public.commit_vision_ocr_guide(capture,version,'qa-approved');
  version:=(response->>'dispatch_version')::integer;
  begin perform public.update_dispatch(dispatch,version,'2026-11-05T13:00:00Z',null,'QA Supervisor','DISPATCHED','QA-SUPERVISOR',8,'M3');
    raise exception 'QA_GENERAL_DISPATCH_UPDATE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  execute 'reset role';
  insert into public.documents(project_id,category,created_by)values(project,'DISPATCH_EVIDENCE',actor)returning id into document;
  insert into public.dispatch_documents(project_id,dispatch_id,document_id,purpose)values(project,dispatch,document,'DISPATCH_EVIDENCE');
  insert into public.document_versions(document_id,version,storage_bucket,storage_path,file_name,mime_type,upload_status,uploaded_at,is_current,uploaded_by)
    values(document,1,'private-documents','qa/'||document,'qa.pdf','application/pdf','UPLOADED',now(),true,actor);
  select to_jsonb(d) into before_dispatch from public.dispatches d where id=dispatch;
  execute 'set local role authenticated';
  begin perform public.complete_dispatch(dispatch,version); raise exception 'QA_DIRECT_COMPLETION_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  begin perform public.finalize_dispatch(dispatch,version,'2026-11-05T14:00:00Z','2026-11-05T15:00:00Z','Forged','DISPATCHED','FORGED',99,'M3');
    raise exception 'QA_FINALIZATION_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  -- Direct table mutation cannot bypass the RPC checks either.
  begin update public.dispatches set status='COMPLETED' where id=dispatch; raise exception 'QA_DIRECT_UPDATE_ALLOWED';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  if (select to_jsonb(d) from public.dispatches d where id=dispatch) is distinct from before_dispatch then
    raise exception 'QA_DENIED_FINALIZATION_CHANGED_DATA';
  end if;

  -- Role permissions remain additive. A separate Resident assignment can finish.
  insert into public.project_member_roles(project_member_id,role_id,assigned_by)values(member,resident,actor);
  if not app_private.has_project_permission(project,'dispatch.complete') then raise exception 'QA_RESIDENT_COMPLETION_MISSING'; end if;
  delete from public.project_member_roles where project_member_id=member and role_id=supervisor;
  execute 'set local role authenticated';
  version:=public.finalize_dispatch(dispatch,version,'2026-11-05T13:00:00Z',null,'QA Supervisor','DISPATCHED','QA-SUPERVISOR',8,'M3');
  execute 'reset role';
  -- finalize saves and then completes: both increments remain atomic.
  if not exists(select 1 from public.dispatches d where d.id=dispatch and d.status='COMPLETED'
                and d.completed_by=actor and d.version=(before_dispatch->>'version')::integer+2) then
    raise exception 'QA_RESIDENT_FINALIZATION_FAILED';
  end if;
  if has_function_privilege('anon','public.complete_dispatch(uuid,integer)','execute')
     or has_function_privilege('anon','public.finalize_dispatch(uuid,integer,timestamptz,timestamptz,text,public.dispatch_result,text,numeric,text)','execute') then
    raise exception 'QA_ANONYMOUS_COMPLETION_ALLOWED';
  end if;
end;
$$;
select 'SUPERVISOR_QA_PASS: start and manual/OCR guides allowed; planning, Gmail, general updates and completion denied; Resident preserved';
rollback;
