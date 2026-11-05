-- DEV only. Fixtures, documents, audit entries and version changes all roll back.
begin;
do $$
declare
 candidate record; project uuid; supplier uuid; actor uuid; program uuid; dispatch uuid;
 product uuid; ref text; day date:=date '2026-11-04'; created jsonb; lines jsonb; payload jsonb; pending_line uuid;
 capture uuid; capture2 uuid; guide uuid; version integer; response jsonb; count_before bigint; manual_details jsonb; original_order text;
begin
 for candidate in select p.id,r.supplier_id,a.id actor from public.projects p
   join public.project_suppliers r on r.project_id=p.id and r.active
   join public.suppliers s on s.id=r.supplier_id and s.active
   cross join public.profiles a where p.status='ACTIVE' and a.active
   and exists(select 1 from public.project_product_prices v where v.project_id=p.id) order by p.id,a.id loop
   perform set_config('request.jwt.claim.sub',candidate.actor::text,true);
   if app_private.has_project_permission(candidate.id,'programming.create') and app_private.has_project_permission(candidate.id,'programming.confirm')
     and app_private.has_project_permission(candidate.id,'dispatch.create') and app_private.has_project_permission(candidate.id,'dispatch.modify') then
     project:=candidate.id;supplier:=candidate.supplier_id;actor:=candidate.actor;exit;
   end if;
 end loop;
 if actor is null then raise exception 'QA_ACTOR_REQUIRED'; end if;
 select p.id,p.reference into product,ref from public.project_product_prices p where p.project_id=project order by p.id limit 1;
 execute 'set local role authenticated';
 created:=public.create_programming_batch(project,jsonb_build_array(jsonb_build_object('supplier_id',supplier,'scheduled_at','2026-11-04T13:00:00Z',
   'order_number','QA-OCR-'||gen_random_uuid(),'lines',jsonb_build_array(jsonb_build_object('quantity',7,'unit_code','M3','concrete_type',ref)), 'delivery_modes',jsonb_build_array('DIRECT'))));
 program:=(created->'programming_ids'->>0)::uuid;
 dispatch:=public.start_dispatch(program,'2026-11-04T13:05:00Z','QA OCR');
 execute 'reset role';
 version:=1;
 payload:=jsonb_build_object('casting_element','COLUMNS','laboratory_applied',true,'guide_number','QA-OCR-known','guide_date',day,'arrival','23:10','departure','03:20',
   'identity_checks','[]'::jsonb,'parser_version','mixto-v2','details',jsonb_build_object('projectName','Reviewed project','workAddress','Reviewed address','orderNumber','DIFFERENT-ORDER-ALLOWED'),
   'lines',jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',product,'quantity',7,'unit_code',null,'unit_price',999999)));
 insert into public.guide_ocr_captures(project_id,dispatch_id,created_by,status,original_path,original_name,original_mime,original_size,original_sha256,
   extraction,review_payload,review_hash) values(project,dispatch,actor,'EXTRACTED','qa/'||gen_random_uuid(),'qa.jpg','image/jpeg',100,repeat('a',64),'{}',payload,'approved') returning id into capture;
 execute 'set local role authenticated';
 response:=public.commit_vision_ocr_guide(capture,version,'approved');
 guide:=(response->>'guide_id')::uuid;version:=(response->>'dispatch_version')::integer;
 -- Replay succeeds even with an old dispatch version: same guide/document.
 if public.commit_vision_ocr_guide(capture,1,'lost-response')<>response then raise exception 'QA_IDEMPOTENCY_FAILED';end if;
 begin
   update public.guide_ocr_captures set review_payload='{}' where id=capture;
   raise exception 'QA_BROWSER_APPROVAL_ALLOWED';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 if not exists(select 1 from public.dispatch_guide_lines l join public.project_product_prices p on p.id=l.product_price_id
   where l.guide_id=guide and l.unit_price=p.price and l.unit_price<>999999) then raise exception 'QA_SERVER_PRICE_FAILED';end if;
 if (select count(*) from public.guide_documents where guide_id=guide)<>1 then raise exception 'QA_ORIGINAL_DOCUMENT_LINK_FAILED';end if;
 if (select (truck_departure_at at time zone 'America/Guatemala')::date from public.dispatch_guides where id=guide)<>day+1 then raise exception 'QA_OVERNIGHT_FAILED';end if;
 if (select order_number from public.dispatches where id=dispatch)='DIFFERENT-ORDER-ALLOWED' then raise exception 'QA_ORDER_WAS_MUTATED';end if;
 if not exists(select 1 from public.audit_events where entity_id=guide and action='DISPATCH_GUIDE_OCR_REVIEWED'
   and new_values->'identity_checks'='[]'::jsonb and new_values->>'parser_version'='mixto-v2') then raise exception 'QA_IDENTITY_AUDIT_POLICY';end if;

 if not exists(select 1 from public.dispatch_guides where id=guide and casting_element='COLUMNS' and laboratory_applied) then raise exception 'QA_RESIDENT_OCR_LOST'; end if;
 if not exists(select 1 from public.dispatch_guide_lines where guide_id=guide and unit_code is null) then raise exception 'QA_EMPTY_UM_COERCED'; end if;
 if (select details from public.dispatch_guides where id=guide) is distinct from payload->'details' then raise exception 'QA_OCR_DETAILS_LOST'; end if;
 manual_details:=jsonb_build_object('customerName','Cliente manual','projectName','Proyecto escrito en guía','workAddress','Otra dirección informativa','guideDate','2026-11-03',
   'orderNumber','PEDIDO-EN-PAPEL','plant','6015','truck','0183','loadingTime','18:27','pilot','Piloto manual','operator','Operador manual','observations','Observaciones manuales');
 select order_number into original_order from public.dispatches where id=dispatch;
 -- A missing resident selection rolls back the complete manual guide save.
 lines:=jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',product,'quantity',2,'unit_code',null));
 execute 'set local role authenticated';
 begin
   perform public.create_dispatch_guide_with_review(dispatch,version,'QA-NO-CHOICE',day,lines,time '23:00',time '03:00',null,false);
   raise exception 'QA_RESIDENT_SELECTION_BYPASS';
 exception when raise_exception then if sqlerrm<>'GUIDE_RESIDENT_SELECTION_REQUIRED' then raise;end if;end;
 created:=public.create_dispatch_guide_with_details(dispatch,version,'QA-MANUAL-RESIDENT',day,lines,time '23:00',time '03:00','PILES',false,manual_details);
 version:=(created->>'dispatch_version')::integer;
 guide:=(created->>'guide_id')::uuid;
 select id into pending_line from public.dispatch_guide_lines where guide_id=guide;
 version:=public.update_dispatch_guide_with_details(guide,version,'QA-MANUAL-RESIDENT',day,
   jsonb_build_array(jsonb_build_object('line_id',pending_line,'catalog_type','PRODUCT','catalog_item_id',product,'quantity',3,'unit_code',null)),
   time '23:00',time '03:00','COLUMNS',true,manual_details||jsonb_build_object('pilot','Piloto corregido'));
 execute 'reset role';
 if exists(select 1 from public.dispatch_guides where dispatch_id=dispatch and guide_number='QA-NO-CHOICE') then raise exception 'QA_INVALID_SAVE_NOT_ATOMIC'; end if;
 if not exists(select 1 from public.dispatch_guides where id=guide and casting_element='COLUMNS' and laboratory_applied and quantity=3 and unit_code='M3') then raise exception 'QA_MANUAL_EDIT_METADATA_OR_ROLLUP'; end if;
 if not exists(select 1 from public.dispatch_guide_lines where guide_id=guide and unit_code is null and unit_price is not null) then raise exception 'QA_MANUAL_EMPTY_UNIT_OR_PRICE'; end if;

 if (select details from public.dispatch_guides where id=guide) is distinct from
    manual_details||jsonb_build_object('guideDate',day::text,'pilot','Piloto corregido') then raise exception 'QA_MANUAL_DETAILS_EDIT_OR_READBACK'; end if;
 if (select order_number from public.dispatches where id=dispatch) is distinct from original_order then raise exception 'QA_INFORMATIONAL_ORDER_MUTATED_DISPATCH'; end if;
 execute 'set local role authenticated';
 begin
   perform public.create_dispatch_guide_with_details(dispatch,version,'QA-INVALID-DETAILS',day,lines,time '23:00',time '03:00','COLUMNS',false,manual_details||jsonb_build_object('loadingTime','25:00'));
   raise exception 'QA_INVALID_DETAILS_ALLOWED';
 exception when raise_exception then if sqlerrm<>'GUIDE_DETAILS_INVALID' then raise;end if;end;
 begin
   perform public.update_dispatch_guide_with_details(guide,version,'SHOULD-ROLL-BACK',day,lines,time '23:00',time '03:00','COLUMNS',false,manual_details||jsonb_build_object('observations',repeat('x',4001)));
   raise exception 'QA_LONG_DETAILS_ALLOWED';
 exception when raise_exception then if sqlerrm<>'GUIDE_DETAILS_INVALID' then raise;end if;end;
 execute 'reset role';
 if exists(select 1 from public.dispatch_guides where dispatch_id=dispatch and guide_number in ('QA-INVALID-DETAILS','SHOULD-ROLL-BACK')) then raise exception 'QA_INVALID_DETAILS_NOT_ATOMIC'; end if;
 if (select d.version from public.dispatches d where id=dispatch)<>version then raise exception 'QA_INVALID_DETAILS_CHANGED_VERSION'; end if;
 if has_function_privilege('anon','public.create_dispatch_guide_with_details(uuid,integer,text,date,jsonb,time,time,text,boolean,jsonb)','execute')
   or has_function_privilege('authenticated','app_private.save_guide_details(uuid,jsonb)','execute') then raise exception 'QA_DETAILS_ACCESS'; end if;
 -- Invalid provided units and cross-project catalog choices are still rejected.
 begin perform app_private.resolve_dispatch_guide_lines(project,'M3',jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',product,'quantity',1,'unit_code','INVALID')),null);
   raise exception 'QA_INVALID_UNIT_ALLOWED';
 exception when raise_exception then if sqlerrm<>'INVALID_OR_INACTIVE_UNIT_OF_MEASURE' then raise;end if;end;

 -- Unknown service code is saved with a NULL price, zero product volume.
 lines:=jsonb_build_array(jsonb_build_object('catalog_type','SERVICE','catalog_item_id',null,'quantity',1,'unit_code',null,'product_code','QA-UNKNOWN-'||gen_random_uuid(),'product_description','Manual transcription'));
 payload:=jsonb_set(payload,'{lines}',lines)||jsonb_build_object('guide_number','QA-OCR-service-only');
 insert into public.guide_ocr_captures(project_id,dispatch_id,created_by,status,original_path,original_name,original_mime,original_size,original_sha256,
   extraction,review_payload,review_hash) values(project,dispatch,actor,'EXTRACTED','qa/'||gen_random_uuid(),'qa2.jpg','image/jpeg',100,repeat('b',64),'{}',payload,'approved2') returning id into capture2;
 execute 'set local role authenticated';
 begin
   perform public.commit_vision_ocr_guide(capture2,1,'approved2');raise exception 'QA_VERSION_BYPASS';
 exception when raise_exception then if sqlerrm<>'DISPATCH_VERSION_CONFLICT' then raise;end if;end;
 response:=public.commit_vision_ocr_guide(capture2,version,'approved2');
 execute 'reset role';
 guide:=(response->>'guide_id')::uuid;version:=(response->>'dispatch_version')::integer;
 if not exists(select 1 from public.dispatch_guide_lines where guide_id=guide and catalog_type='SERVICE' and unit_price is null and estimated_subtotal is null)
   or (select quantity from public.dispatch_guides where id=guide)<>0 then raise exception 'QA_UNPRICED_SERVICE_FAILED';end if;
 -- A saved unpriced product must keep its transcribed description on later edits.
 payload:=jsonb_set(payload,'{lines}',jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','quantity',2,'unit_code',null,'product_code','QA-PENDING-'||gen_random_uuid(),'product_description','Concreto pendiente de precio')))
   ||jsonb_build_object('guide_number','QA-OCR-pending-product');
 insert into public.guide_ocr_captures(project_id,dispatch_id,created_by,status,original_path,original_name,original_mime,original_size,original_sha256,
   extraction,review_payload,review_hash) values(project,dispatch,actor,'EXTRACTED','qa/'||gen_random_uuid(),'qa3.jpg','image/jpeg',100,repeat('c',64),'{}',payload,'approved3') returning id into capture2;
 execute 'set local role authenticated';
 response:=public.commit_vision_ocr_guide(capture2,version,'approved3');
 guide:=(response->>'guide_id')::uuid;version:=(response->>'dispatch_version')::integer;
 select id into pending_line from public.dispatch_guide_lines where guide_id=guide;
 version:=public.update_dispatch_guide_with_lines(guide,version,'QA-OCR-pending-product',day,
   jsonb_build_array(jsonb_build_object('line_id',pending_line,'catalog_type','PRODUCT','quantity',3,'unit_code',null,'catalog_item_id',null)),time '23:00',time '03:00');
 execute 'reset role';
 if not exists(select 1 from public.dispatch_guide_lines where guide_id=guide and unit_price is null and product_description='Concreto pendiente de precio' and quantity=3) then
   raise exception 'QA_UNPRICED_PRODUCT_EDIT_LOST_DESCRIPTION';end if;
 -- Known code cannot masquerade as unpriced; normal manual entry stays strict.
 lines:=jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','quantity',1,'unit_code','M3','product_code',(select code from public.project_product_prices where id=product)));
 begin perform app_private.resolve_ocr_guide_lines(project,'M3',lines);raise exception 'QA_VARIANT_BYPASS';
 exception when raise_exception then if sqlerrm<>'OCR_CATALOG_VARIANT_REQUIRED' then raise;end if;end;
 begin perform app_private.resolve_dispatch_guide_lines(project,'M3',jsonb_build_array(jsonb_build_object('catalog_type','SERVICE','quantity',1,'unit_code','UN','product_code','QA-NOT-IN-CATALOG')),null);
   raise exception 'QA_MANUAL_SELECTION_WEAKENED';
 exception when raise_exception then if sqlerrm<>'DISPATCH_CATALOG_SELECTION_REQUIRED' then raise;end if;end;
 if has_function_privilege('anon','public.commit_vision_ocr_guide(uuid,integer,text)','execute') then raise exception 'QA_ANONYMOUS_ACCESS';end if;
 if has_table_privilege('authenticated','public.guide_ocr_captures','update') then raise exception 'QA_CAPTURE_UPDATE_GRANT';end if;
 -- Complete validates guides without requiring a line UM. The only expected
 -- blocker here is the intentionally unuploaded fixture evidence (no files).
 update public.dispatches set result='DISPATCHED',order_number='QA-OPTIONAL-UM',
   real_volume=(select sum(quantity) from public.dispatch_guides where dispatch_id=dispatch),real_unit_code='M3'
 where id=dispatch;
 execute 'set local role authenticated';
 begin
   perform public.complete_dispatch(dispatch,version);raise exception 'QA_PENDING_EVIDENCE_ALLOWED';
 exception when raise_exception then if sqlerrm<>'DISPATCH_EVIDENCE_REQUIRED' then raise;end if;end;
 execute 'reset role';
 raise notice 'OCR_QA_PASS: trusted prices, null-price service-only, original link, overnight, idempotency, permission and version guards';
end;
$$;
select 'GUIDE_MANUAL_DETAILS_QA_PASS';
rollback;
