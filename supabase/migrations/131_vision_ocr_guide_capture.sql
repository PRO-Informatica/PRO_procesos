-- First OCR iteration. Release ONLY to DEV while feature/vision-ocr is reviewed.
begin;

create table public.guide_ocr_captures (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  dispatch_id uuid not null references public.dispatches(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  status text not null default 'PREPARED' check(status in ('PREPARED','PROCESSING','EXTRACTED','SAVED')),
  original_path text not null unique,
  original_name text not null check(char_length(original_name) between 1 and 200),
  original_mime text not null check(original_mime in ('image/jpeg','image/png','image/webp')),
  original_size bigint not null check(original_size between 1 and 10485760),
  original_sha256 text,
  processed_sha256 text,
  raw_text text,
  extraction jsonb,
  image_adjustments jsonb,
  review_payload jsonb,
  review_hash text,
  guide_id uuid unique references public.dispatch_guides(id) on delete cascade,
  prepared_upload jsonb,
  evidence_attached_at timestamptz,
  check(guide_id is null or (status='SAVED' and review_payload is not null and prepared_upload is not null))
);
create index guide_ocr_captures_expiry on public.guide_ocr_captures(expires_at) where guide_id is null;
create index guide_ocr_captures_dispatch on public.guide_ocr_captures(dispatch_id);
alter table public.guide_ocr_captures enable row level security;
alter table public.guide_ocr_captures force row level security;
revoke all on public.guide_ocr_captures from public,anon,authenticated;
grant select on public.guide_ocr_captures to authenticated;
grant all on public.guide_ocr_captures to service_role;
create policy guide_ocr_captures_read on public.guide_ocr_captures for select to authenticated
using(app_private.has_project_permission(project_id,'dispatch.view') and (guide_id is not null or created_by=auth.uid()));

-- Only the server can stage/read originals. No public or authenticated Storage
-- policy is added: residents receive one signed upload token for their own path.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('vision-ocr-dev','vision-ocr-dev',false,10485760,array['image/jpeg','image/png','image/webp']);

-- Unknown codes retain their kind and quantity, with a NULL commercial price.
-- The regular manual-entry resolver still requires a catalog selection.
alter table public.dispatch_guide_lines drop constraint dispatch_guide_lines_catalog_shape_ck;
alter table public.dispatch_guide_lines add constraint dispatch_guide_lines_catalog_shape_ck check (
  (catalog_type is null and product_price_id is null and service_price_id is null and catalog_reference is null and unit_price is null and currency is null)
  or (catalog_type='PRODUCT' and service_price_id is null and nullif(btrim(product_code),'') is not null
      and nullif(btrim(catalog_reference),'') is not null and unit_price is not null and unit_price>=0 and currency='GTQ')
  or (catalog_type='SERVICE' and product_price_id is null and catalog_reference is null and nullif(btrim(product_code),'') is not null
      and unit_price is not null and unit_price>=0 and currency='GTQ')
  or (catalog_type in ('PRODUCT','SERVICE') and product_price_id is null and service_price_id is null
      and nullif(btrim(product_code),'') is not null and unit_price is null and currency is null and catalog_reference is null)
);

create function app_private.resolve_ocr_guide_lines(p_project uuid,p_unit text,p_lines jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,app_private as $$
declare item jsonb; resolved jsonb:='[]'; kind text; v_code text; unit text; qty numeric(12,3);
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'DISPATCH_GUIDE_LINES_REQUIRED';
  end if;
  for item in select value from jsonb_array_elements(p_lines) loop
    if nullif(item->>'catalog_item_id','') is not null then
      -- Existing resolver fetches prices from this project's catalog; any price
      -- or subtotal included by a client is deliberately ignored.
      resolved:=resolved || app_private.resolve_dispatch_guide_lines(p_project,p_unit,jsonb_build_array(item),null);
      continue;
    end if;
    kind:=item->>'catalog_type'; v_code:=btrim(item->>'product_code');
    unit:=app_private.normalize_service_catalog_unit(item->>'unit_code');
    if kind is null or kind not in ('PRODUCT','SERVICE') or v_code is null or char_length(v_code) not between 1 and 120
       or char_length(coalesce(item->>'product_description',''))>500 or jsonb_typeof(item->'quantity') is distinct from 'number' then
      raise exception 'DISPATCH_GUIDE_LINE_INVALID';
    end if;
    qty:=(item->>'quantity')::numeric(12,3);
    if qty<=0 or unit is null or not exists(select 1 from public.units_of_measure u where u.active and u.code=unit) then
      raise exception 'DISPATCH_GUIDE_LINE_INVALID';
    end if;
    if kind='PRODUCT' and unit is distinct from p_unit then raise exception 'DISPATCH_PROGRAMMING_UNIT_MISMATCH'; end if;
    -- Missing and ambiguous are different: a known code must select its variant.
    if exists(select 1 from public.project_product_prices p where p.project_id=p_project and upper(regexp_replace(p.code,'\s','','g'))=upper(regexp_replace(v_code,'\s','','g')))
       or exists(select 1 from public.project_service_prices s where s.project_id=p_project and upper(regexp_replace(s.code,'\s','','g'))=upper(regexp_replace(v_code,'\s','','g'))) then
      raise exception 'OCR_CATALOG_VARIANT_REQUIRED';
    end if;
    resolved:=resolved || jsonb_build_array(jsonb_build_object('quantity',qty,'unit_code',unit,'catalog_type',kind,
      'product_code',v_code,'product_description',nullif(btrim(item->>'product_description'),''),
      'product_price_id',null,'service_price_id',null,'catalog_reference',null,'unit_price',null,'currency',null));
  end loop;
  return resolved;
end;
$$;
alter function app_private.resolve_ocr_guide_lines(uuid,text,jsonb) owner to postgres;
revoke all on function app_private.resolve_ocr_guide_lines(uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.commit_vision_ocr_guide(p_capture_id uuid,p_expected_version integer,p_review_hash text)
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
  -- review_payload can only be written by the DEV server after project/address
  -- validation. Browser callers cannot approve their own capture via RLS.
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
      'reviewed_fields',payload->'details','line_count',jsonb_array_length(resolved),'parser_version','mixto-v1',
      'identity_checks',jsonb_build_array('PROJECT','WORK_ADDRESS')));
  return jsonb_build_object('guide_id',guide,'dispatch_version',new_version,'upload',response);
end;
$$;
alter function public.commit_vision_ocr_guide(uuid,integer,text) owner to postgres;
revoke all on function public.commit_vision_ocr_guide(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.commit_vision_ocr_guide(uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
