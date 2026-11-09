-- OCR source identity is informational; retain project/dispatch access checks.
-- No business records or prior audit entries are changed.
begin;

create or replace function public.commit_vision_ocr_guide(p_capture_id uuid,p_expected_version integer,p_review_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare
  capture public.guide_ocr_captures%rowtype; dispatch public.dispatches%rowtype;
  unit text; payload jsonb; resolved jsonb; guide uuid:=gen_random_uuid(); total numeric(12,3);
  arrival timestamptz; departure timestamptz; upload record; new_version integer; response jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into capture from public.guide_ocr_captures where id=p_capture_id for update;
  if not found or capture.created_by<>auth.uid() then raise exception 'OCR_CAPTURE_NOT_FOUND'; end if;
  if not app_private.has_project_permission(capture.project_id,'dispatch.modify') then raise exception 'PERMISSION_DENIED'; end if;
  select * into dispatch from public.dispatches where id=capture.dispatch_id for update;
  if dispatch.project_id is distinct from capture.project_id then raise exception 'OCR_CAPTURE_CONTEXT_INVALID'; end if;
  -- Retrying after a network or photo-copy failure never inserts a second guide.
  if capture.guide_id is not null then
    return jsonb_build_object('guide_id',capture.guide_id,'dispatch_version',dispatch.version,'upload',capture.prepared_upload);
  end if;
  if dispatch.status<>'IN_EXECUTION' then raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE'; end if;
  if dispatch.version is distinct from p_expected_version then raise exception 'DISPATCH_VERSION_CONFLICT'; end if;
  if capture.status<>'EXTRACTED' or capture.expires_at<now() or capture.review_payload is null
    or capture.review_hash is distinct from p_review_hash or capture.original_sha256 is null then raise exception 'OCR_REVIEW_REQUIRED'; end if;
  -- Review is approved by the DEV server. Read project/address/order are
  -- informational; the authenticated capture/dispatch context stays enforced.
  -- Browser callers cannot approve their own capture via RLS.
  payload:=capture.review_payload;
  select unit_code into unit from public.programming where id=dispatch.programming_id;
  resolved:=app_private.resolve_ocr_guide_lines(capture.project_id,unit,payload->'lines');
  select arrival_at,departure_at into arrival,departure from app_private.dispatch_guide_truck_timestamps(
    dispatch.id,(payload->>'guide_date')::date,(payload->>'arrival')::time,(payload->>'departure')::time);
  select coalesce(sum((value->>'quantity')::numeric) filter(where value->>'catalog_type'='PRODUCT'),0)
    into total from jsonb_array_elements(resolved);
  begin
    insert into public.dispatch_guides(id,project_id,dispatch_id,guide_number,guide_date,quantity,unit_code,created_by,truck_arrival_at,truck_departure_at)
    values(guide,capture.project_id,dispatch.id,btrim(payload->>'guide_number'),(payload->>'guide_date')::date,total,unit,auth.uid(),arrival,departure);
  exception when unique_violation then raise exception 'DISPATCH_GUIDE_NUMBER_ALREADY_EXISTS'; end;
  insert into public.dispatch_guide_lines(project_id,guide_id,quantity,unit_code,product_code,product_description,position,catalog_type,
    product_price_id,service_price_id,catalog_reference,unit_price,currency)
  select capture.project_id,guide,(value->>'quantity')::numeric,value->>'unit_code',value->>'product_code',value->>'product_description',position::integer,
    value->>'catalog_type',(value->>'product_price_id')::uuid,(value->>'service_price_id')::uuid,value->>'catalog_reference',(value->>'unit_price')::numeric,value->>'currency'
    from jsonb_array_elements(resolved) with ordinality as item(value,position);
  select * into upload from public.prepare_guide_document_upload(guide,capture.original_name,capture.original_mime,capture.original_size,'DISPATCH_GUIDE',null);
  update public.dispatches d set version=d.version+1,updated_at=now() where d.id=dispatch.id returning d.version into new_version;
  response:=jsonb_build_object('documentId',upload.document_id,'versionId',upload.version_id,'bucket',upload.storage_bucket,'path',upload.storage_path);
  update public.guide_ocr_captures set status='SAVED',guide_id=guide,prepared_upload=response where id=capture.id;
  insert into public.audit_events(actor_user_id,project_id,entity_type,entity_id,action,new_values)
    values(auth.uid(),capture.project_id,'dispatch_guide',guide,'DISPATCH_GUIDE_OCR_REVIEWED',jsonb_build_object(
      'capture_id',capture.id,'dispatch_id',dispatch.id,'original_sha256',capture.original_sha256,
      'reviewed_fields',payload->'details','line_count',jsonb_array_length(resolved),'parser_version',coalesce(payload->>'parser_version','mixto-v2'),
      'identity_checks',coalesce(payload->'identity_checks','[]'::jsonb)));
  return jsonb_build_object('guide_id',guide,'dispatch_version',new_version,'upload',response);
end;
$$;
alter function public.commit_vision_ocr_guide(uuid,integer,text) owner to postgres;
revoke all on function public.commit_vision_ocr_guide(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.commit_vision_ocr_guide(uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
