-- DEV regression fixtures only; all created records and evidence roll back.
begin;
do $$
declare candidate record; project uuid; supplier uuid; actor uuid; program uuid; dispatch uuid;
 product uuid; ref text; created jsonb; lines jsonb; payload jsonb; capture uuid; guide uuid;
 version integer:=1; response jsonb; item text; expected text;
begin
 for candidate in select p.id,r.supplier_id,a.id actor from public.projects p
 join public.project_suppliers r on r.project_id=p.id and r.active
 join public.suppliers s on s.id=r.supplier_id and s.active
 cross join public.profiles a where p.status='ACTIVE' and a.active
 and exists(select 1 from public.project_product_prices v where v.project_id=p.id) order by p.id,a.id loop
 perform set_config('request.jwt.claim.sub',candidate.actor::text,true);
 if app_private.has_project_permission(candidate.id,'programming.create') and app_private.has_project_permission(candidate.id,'dispatch.create') and app_private.has_project_permission(candidate.id,'dispatch.modify') then
 project:=candidate.id;supplier:=candidate.supplier_id;actor:=candidate.actor;exit;end if;
 end loop;
 if actor is null then raise exception 'QA_ACTOR_REQUIRED';end if;
 select p.id,p.reference into product,ref from public.project_product_prices p where p.project_id=project order by p.id limit 1;
 if app_private.normalize_casting_element('Pilotes y columnas')<>'PILES_AND_COLUMNS'
 or app_private.normalize_casting_element('Pilotes')<>'PILES' or app_private.normalize_casting_element('Columnas')<>'COLUMNS'
 or app_private.normalize_casting_element('Losas') is not null then raise exception 'QA_ELEMENT_NORMALIZATION';end if;
 execute 'set local role authenticated';
 foreach item in array array['PILES','COLUMNS','PILES_AND_COLUMNS'] loop
 created:=public.create_programming_batch(project,jsonb_build_array(jsonb_build_object('supplier_id',supplier,'scheduled_at','2026-11-03T13:00:00Z',
 'order_number','QA-CONTROL-'||gen_random_uuid(),'casting_element',item,'notes','Notas editadas sin elemento',
 'lines',jsonb_build_array(jsonb_build_object('quantity',14,'unit_code','M3','concrete_type',ref)),'delivery_modes',jsonb_build_array('PUMP'))));
 program:=(created->'programming_ids'->>0)::uuid;
 if (select casting_element from public.programming where id=program) is distinct from item
 or exists(select 1 from public.programming_revisions where programming_id=program and casting_element is distinct from item) then raise exception 'QA_STRUCTURED_ELEMENT_LOST';end if;
 end loop;
 dispatch:=public.start_dispatch(program,'2026-11-03T13:05:00Z','QA Control');
 execute 'reset role';
 foreach item in array array['MIXTO_OPERATION','PANEXUS_OPERATION'] loop
 payload:=jsonb_build_object('casting_element','PILES_AND_COLUMNS','laboratory_applied',false,'guide_number','QA-'||item,'guide_date','2026-11-03','arrival','23:00','departure','03:00',
 'identity_checks','[]'::jsonb,'parser_version','guides-controls-v3','details',jsonb_build_object('documentType',item,'guideDate','2026-11-03','orderNumber','88','observations','Notas revisadas'),
 'lines',jsonb_build_array(jsonb_build_object('catalog_type','SERVICE','catalog_item_id',null,'product_code','QA-CONTROL-CODE','product_description','Servicio seleccionado','quantity',14,'unit_code',null)));
 insert into public.guide_ocr_captures(project_id,dispatch_id,created_by,status,original_path,original_name,original_mime,original_size,original_sha256,extraction,review_payload,review_hash)
 values(project,dispatch,actor,'EXTRACTED','qa/'||gen_random_uuid(),'qa.jpg','image/jpeg',100,repeat('a',64),'{}',payload,'approved') returning id into capture;
 execute 'set local role authenticated';
 response:=public.commit_vision_ocr_guide(capture,version,'approved');
 guide:=(response->>'guide_id')::uuid;version:=(response->>'dispatch_version')::integer;
 if public.commit_vision_ocr_guide(capture,1,'lost-response')<>response then raise exception 'QA_DUPLICATE_CONTROL_ON_RETRY';end if;
 execute 'reset role';
 if not exists(select 1 from public.dispatch_guides where id=guide and casting_element='PILES_AND_COLUMNS' and details->>'documentType'=item and quantity=0)
 or not exists(select 1 from public.dispatch_guide_lines where guide_id=guide and catalog_type='SERVICE' and quantity=14 and unit_price is null)
 or (select count(*) from public.guide_documents where guide_id=guide)<>1 then raise exception 'QA_CONTROL_SAVE_REOPEN_FAILED';end if;
 if (select (truck_departure_at at time zone 'America/Guatemala')::date from public.dispatch_guides where id=guide)<>date '2026-11-04' then raise exception 'QA_OVERNIGHT_CONTROL';end if;
 end loop;
 lines:=jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',product,'quantity',14,'unit_code','M3'));
 execute 'set local role authenticated';
 created:=public.create_dispatch_guide_with_details(dispatch,version,'QA-MANUAL-CONTROL',date '2026-11-03',lines,time '07:00',time '08:00','PILES_AND_COLUMNS',false,jsonb_build_object('documentType','MIXTO_OPERATION','orderNumber','88'));
 guide:=(created->>'guide_id')::uuid;version:=(created->>'dispatch_version')::integer;
 version:=public.update_dispatch_guide_with_details(guide,version,'QA-MANUAL-CONTROL',date '2026-11-03',lines,time '07:00',time '08:00','COLUMNS',true,jsonb_build_object('documentType','PANEXUS_OPERATION','orderNumber','88','observations','Corregido'));
 execute 'reset role';
 if not exists(select 1 from public.dispatch_guides where id=guide and details->>'documentType'='PANEXUS_OPERATION' and details->>'observations'='Corregido' and casting_element='COLUMNS') then raise exception 'QA_MANUAL_CONTROL_EDIT';end if;
 execute 'set local role authenticated';
 begin
 perform public.create_dispatch_guide_with_details(dispatch,version,'INVALID',date '2026-11-03',lines,time '07:00',time '08:00','PILES_AND_COLUMNS',false,jsonb_build_object('documentType','INVALID'));
 raise exception 'QA_INVALID_TYPE_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'GUIDE_DETAILS_INVALID' then raise;end if;end;
 execute 'reset role';
 if exists(select 1 from public.dispatch_guides where dispatch_id=dispatch and guide_number='INVALID') then raise exception 'QA_INVALID_CONTROL_NOT_ATOMIC';end if;
 raise notice 'CONTROL_GUIDES_CASTING_QA_PASS';
end;
$$;
rollback;
