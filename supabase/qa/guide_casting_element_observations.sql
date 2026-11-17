-- DEV fixtures only. All guide, document, audit and programming changes roll back.
begin;
do $$
declare
 candidate record; project uuid; supplier uuid; actor uuid; program uuid; dispatch uuid;
 product uuid; ref text; created jsonb; lines jsonb; details jsonb; guide uuid; line uuid;
 version integer; capture uuid; payload jsonb; response jsonb; invalid jsonb;
begin
 for candidate in select p.id,r.supplier_id,a.id actor from public.projects p
   join public.project_suppliers r on r.project_id=p.id and r.active
   join public.suppliers s on s.id=r.supplier_id and s.active
   cross join public.profiles a where p.status='ACTIVE' and a.active
   and exists(select 1 from public.project_product_prices v where v.project_id=p.id) order by p.id,a.id loop
   perform set_config('request.jwt.claim.sub',candidate.actor::text,true);
   if app_private.has_project_permission(candidate.id,'programming.create')
     and app_private.has_project_permission(candidate.id,'dispatch.create')
     and app_private.has_project_permission(candidate.id,'dispatch.manage_guides') then
     project:=candidate.id;supplier:=candidate.supplier_id;actor:=candidate.actor;exit;
   end if;
 end loop;
 if actor is null then raise exception 'QA_ACTOR_REQUIRED'; end if;
 select p.id,p.reference into product,ref from public.project_product_prices p where p.project_id=project order by p.id limit 1;
 execute 'set local role authenticated';
 created:=public.create_programming_batch(project,jsonb_build_array(jsonb_build_object('supplier_id',supplier,
   'scheduled_at','2026-11-17T13:00:00Z','order_number','QA-ELEMENT-'||gen_random_uuid(),
   'lines',jsonb_build_array(jsonb_build_object('quantity',7,'unit_code','M3','concrete_type',ref)),
   'delivery_modes',jsonb_build_array('DIRECT'))));
 program:=(created->'programming_ids'->>0)::uuid;
 dispatch:=public.start_dispatch(program,'2026-11-17T13:05:00Z','QA observaciones elemento');
 version:=1;
 lines:=jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',product,'quantity',2,'unit_code','M3'));
 details:=jsonb_build_object('documentType','DISPATCH_GUIDE','observations','Nota general',
   'castingElementObservations',E'Columnas del eje A\nFundir hasta nivel 2.');
 created:=public.create_dispatch_guide_with_details(dispatch,version,'QA-ELEMENT-MANUAL',date '2026-11-17',lines,
   time '07:00',time '08:00','COLUMNS',false,details);
 guide:=(created->>'guide_id')::uuid;version:=(created->>'dispatch_version')::integer;
 if not exists(select 1 from public.dispatch_guides g where g.id=guide and g.details->>'observations'='Nota general'
   and g.details->>'castingElementObservations'=E'Columnas del eje A\nFundir hasta nivel 2.') then raise exception 'QA_ELEMENT_CREATE_READBACK'; end if;
 select id into line from public.dispatch_guide_lines where guide_id=guide;
 lines:=jsonb_build_array(jsonb_build_object('line_id',line,'catalog_type','PRODUCT','catalog_item_id',product,'quantity',2,'unit_code','M3'));
 details:=details||jsonb_build_object('castingElementObservations',repeat('x',4000));
 version:=public.update_dispatch_guide_with_details(guide,version,'QA-ELEMENT-MANUAL',date '2026-11-17',lines,
   time '07:00',time '08:00','COLUMNS',false,details);
 if not exists(select 1 from public.dispatch_guides g where g.id=guide and length(g.details->>'castingElementObservations')=4000
   and g.details->>'observations'='Nota general') then raise exception 'QA_ELEMENT_EDIT_READBACK'; end if;
 foreach invalid in array array['null'::jsonb,'42'::jsonb,to_jsonb(repeat('x',4001))] loop
   begin
     perform public.update_dispatch_guide_with_details(guide,version,'QA-ELEMENT-MANUAL',date '2026-11-17',lines,
       time '07:00',time '08:00','COLUMNS',false,details||jsonb_build_object('castingElementObservations',invalid));
     raise exception 'QA_ELEMENT_INVALID_ALLOWED';
   exception when raise_exception then if sqlerrm<>'GUIDE_DETAILS_INVALID' then raise; end if; end;
 end loop;
 -- Clearing the optional note is supported; clients that predate it still save.
 version:=public.update_dispatch_guide_with_details(guide,version,'QA-ELEMENT-MANUAL',date '2026-11-17',lines,
   time '07:00',time '08:00','COLUMNS',false,details||jsonb_build_object('castingElementObservations',''));
 if (select g.details->>'castingElementObservations' from public.dispatch_guides g where g.id=guide)<>'' then raise exception 'QA_ELEMENT_CLEAR'; end if;
 version:=public.update_dispatch_guide_with_details(guide,version,'QA-ELEMENT-MANUAL',date '2026-11-17',lines,
   time '07:00',time '08:00','COLUMNS',false,details-'castingElementObservations');
 execute 'reset role';
 -- The OCR commit stores the independently reviewed note along with the guide.
 payload:=jsonb_build_object('casting_element','PILES','laboratory_applied',false,'guide_number','QA-ELEMENT-OCR',
   'guide_date','2026-11-17','arrival','07:10','departure','08:10','identity_checks','[]'::jsonb,'parser_version','guides-controls-v3',
   'details',details||jsonb_build_object('castingElementObservations','Pilotes del eje B'),
   'lines',jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',product,'quantity',2,'unit_code','M3')));
 insert into public.guide_ocr_captures(project_id,dispatch_id,created_by,status,original_path,original_name,original_mime,original_size,original_sha256,
   extraction,review_payload,review_hash) values(project,dispatch,actor,'EXTRACTED','qa/'||gen_random_uuid(),'qa.jpg','image/jpeg',100,repeat('a',64),'{}',payload,'approved') returning id into capture;
 execute 'set local role authenticated';
 response:=public.commit_vision_ocr_guide(capture,version,'approved');
 if not exists(select 1 from public.dispatch_guides g where g.id=(response->>'guide_id')::uuid
   and g.details->>'castingElementObservations'='Pilotes del eje B' and g.details->>'observations'='Nota general') then raise exception 'QA_ELEMENT_OCR_READBACK'; end if;
 execute 'reset role';
 if has_function_privilege('authenticated','app_private.save_guide_details(uuid,jsonb)','execute') then raise exception 'QA_ELEMENT_PRIVATE_ACCESS'; end if;
 raise notice 'GUIDE_CASTING_OBSERVATIONS_QA_PASS: create, edit, readback, clear, legacy, length and OCR';
end;
$$;
rollback;
