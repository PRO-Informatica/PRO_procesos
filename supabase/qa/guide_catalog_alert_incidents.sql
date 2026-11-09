-- DEV fixtures, incidents, documents and audit entries all roll back.
begin;
create function pg_temp.reject_qa_catalog_incident() returns trigger language plpgsql as $$
begin
 if current_setting('qa.fail_catalog_incident',true)='on' then raise exception 'QA_INCIDENT_WRITE_FAILED'; end if;
 return new;
end;
$$;
create trigger qa_catalog_incident_failure before insert on public.dispatch_incidents
 for each row execute function pg_temp.reject_qa_catalog_incident();
do $$
declare
 candidate record; project uuid; supplier uuid; actor uuid; company uuid; program uuid; dispatch uuid; product uuid; ref text;
 created jsonb; payload jsonb; lines jsonb; capture uuid; guide uuid; response jsonb; first_response jsonb;
 version integer:=1; incident public.dispatch_incidents%rowtype; before_count bigint; before_version integer;
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
 select company_id into company from public.projects where id=project;
 select p.id,p.reference into product,ref from public.project_product_prices p where p.project_id=project order by p.id limit 1;
 execute 'set local role authenticated';
 created:=public.create_programming_batch(project,jsonb_build_array(jsonb_build_object('supplier_id',supplier,'scheduled_at','2026-11-04T13:00:00Z',
   'order_number','QA-CATALOG-'||gen_random_uuid(),'casting_element','PILES','lines',jsonb_build_array(jsonb_build_object('quantity',7,'unit_code','M3','concrete_type',ref)), 'delivery_modes',jsonb_build_array('DIRECT'))));
 program:=(created->'programming_ids'->>0)::uuid;
 dispatch:=public.start_dispatch(program,'2026-11-04T13:05:00Z','QA catalog alert');
 execute 'reset role';
 lines:=jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',product,'quantity',7,'unit_code','M3'));
 payload:=jsonb_build_object('casting_element','PILES','laboratory_applied',false,'guide_number','QA-CATALOG-known','guide_date','2026-11-04',
   'arrival','23:10','departure','03:20','details',jsonb_build_object('documentType','DISPATCH_GUIDE'),'lines',lines);
 insert into public.guide_ocr_captures(project_id,dispatch_id,created_by,status,original_path,original_name,original_mime,original_size,original_sha256,
   extraction,review_payload,review_hash) values(project,dispatch,actor,'EXTRACTED','qa/'||gen_random_uuid(),'qa.jpg','image/jpeg',100,repeat('a',64),'{}',payload,'approved') returning id into capture;
 execute 'set local role authenticated';
 response:=public.commit_vision_ocr_guide(capture,version,'approved');
 version:=(response->>'dispatch_version')::integer;
 if exists(select 1 from public.dispatch_incidents where dispatch_id=dispatch) then raise exception 'QA_KNOWN_CODE_CREATED_INCIDENT'; end if;
 execute 'reset role';

 lines:=lines||jsonb_build_array(
   jsonb_build_object('catalog_type','SERVICE','catalog_item_id',null,'quantity',1,'unit_code',null,'product_code','QA-SERVICE-'||gen_random_uuid(),'product_description','Servicio no catalogado'),
   jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',null,'quantity',2,'unit_code','M3','product_code','QA-PRODUCT-'||gen_random_uuid(),'product_description','Producto no catalogado'));
 payload:=payload||jsonb_build_object('guide_number','QA-CATALOG-alerts','lines',lines);
 insert into public.guide_ocr_captures(project_id,dispatch_id,created_by,status,original_path,original_name,original_mime,original_size,original_sha256,
   extraction,review_payload,review_hash) values(project,dispatch,actor,'EXTRACTED','qa/'||gen_random_uuid(),'qa2.jpg','image/jpeg',100,repeat('b',64),'{}',payload,'approved2') returning id into capture;
 execute 'set local role authenticated';
 response:=public.commit_vision_ocr_guide(capture,version,'approved2'); first_response:=response;
 guide:=(response->>'guide_id')::uuid;version:=(response->>'dispatch_version')::integer;
 if public.commit_vision_ocr_guide(capture,1,'lost-response')<>first_response then raise exception 'QA_RETRY_CHANGED_RESPONSE'; end if;
 if (select count(*) from public.dispatch_incidents where dispatch_id=dispatch)<>1 then raise exception 'QA_INCIDENT_DUPLICATED_OR_MISSING'; end if;
 select * into incident from public.dispatch_incidents where dispatch_id=dispatch;
 if incident.project_id<>project or incident.reported_by<>actor or incident.responsibility<>'UNDETERMINED'
    or incident.charge_applicability<>'UNDETERMINED' then raise exception 'QA_INCIDENT_CONTEXT_OR_RESPONSIBILITY'; end if;
 if position('QA-CATALOG-alerts' in incident.notes)=0 or position('Servicio no catalogado' in incident.notes)=0
    or position('Producto no catalogado' in incident.notes)=0 or position('Línea 1' in incident.notes)>0 then raise exception 'QA_INCIDENT_DETAIL_MISSING'; end if;
 execute 'reset role';
 if not exists(select 1 from public.incident_types where id=incident.incident_type_id and company_id=company and code='GUIDE_CATALOG_NOT_FOUND') then raise exception 'QA_INCIDENT_COMPANY_MISMATCH'; end if;
 if not exists(select 1 from public.audit_events where entity_id=incident.id and action='DISPATCH_INCIDENT_REPORTED'
    and new_values->>'guide_id'=guide::text and new_values->>'source'='GUIDE_CATALOG_WARNING'
    and jsonb_array_length(new_values->'lines')=2) then raise exception 'QA_INCIDENT_AUDIT_MISSING'; end if;
 -- A repeated internal invocation must also leave exactly one incident.
 perform app_private.record_guide_catalog_incident(guide);
 if (select count(*) from public.dispatch_incidents where dispatch_id=dispatch)<>1 then raise exception 'QA_PRIVATE_HELPER_NOT_IDEMPOTENT'; end if;

 before_version:=version;
 select count(*) into before_count from public.dispatch_guides where dispatch_id=dispatch;
 payload:=payload||jsonb_build_object('guide_number','QA-CATALOG-rollback');
 insert into public.guide_ocr_captures(project_id,dispatch_id,created_by,status,original_path,original_name,original_mime,original_size,original_sha256,
   extraction,review_payload,review_hash) values(project,dispatch,actor,'EXTRACTED','qa/'||gen_random_uuid(),'qa3.jpg','image/jpeg',100,repeat('c',64),'{}',payload,'approved3') returning id into capture;
 perform set_config('qa.fail_catalog_incident','on',true);
 execute 'set local role authenticated';
 begin
   perform public.commit_vision_ocr_guide(capture,version,'approved3');raise exception 'QA_INCIDENT_FAILURE_WAS_IGNORED';
 exception when raise_exception then if sqlerrm<>'QA_INCIDENT_WRITE_FAILED' then raise;end if;end;
 execute 'reset role';
 perform set_config('qa.fail_catalog_incident','off',true);
 if (select count(*) from public.dispatch_guides where dispatch_id=dispatch)<>before_count
    or (select d.version from public.dispatches d where d.id=dispatch)<>before_version
    or (select guide_id from public.guide_ocr_captures where id=capture) is not null
    or (select count(*) from public.dispatch_incidents where dispatch_id=dispatch)<>1 then raise exception 'QA_GUIDE_INCIDENT_NOT_ATOMIC'; end if;
 execute 'set local role authenticated';
 begin
   perform app_private.record_guide_catalog_incident(guide);raise exception 'QA_PRIVATE_HELPER_EXPOSED';
 exception when insufficient_privilege then null;end;
 execute 'reset role';
 raise notice 'QA_GUIDE_CATALOG_INCIDENTS_PASS';
end;
$$;
rollback;
