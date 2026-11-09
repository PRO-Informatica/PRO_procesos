-- Feature OCR / DEV: the same informational fields can also be entered manually.
begin;
alter table public.dispatch_guides add column details jsonb not null default '{}'::jsonb
  check(jsonb_typeof(details)='object');
comment on column public.dispatch_guides.details is 'Editable guide information, typed or reviewed from OCR; does not change dispatch identity.';

-- Recover the already reviewed OCR values without altering the capture/original.
update public.dispatch_guides g set details=c.review_payload->'details'
from public.guide_ocr_captures c where c.guide_id=g.id and c.status='SAVED'
  and jsonb_typeof(c.review_payload->'details')='object';

do $$
declare definition text:=pg_get_functiondef('public.commit_vision_ocr_guide(uuid,integer,text)'::regprocedure);
  needle text:='truck_departure_at,casting_element,laboratory_applied)';
begin
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
    or position('(payload->>''laboratory_applied'')::boolean);' in definition)=0 then
   raise exception 'GUIDE_DETAILS_MIGRATION_PREREQUISITE_CHANGED';
 end if;
 definition:=replace(definition,needle,'truck_departure_at,casting_element,laboratory_applied,details)');
 definition:=replace(definition,'(payload->>''laboratory_applied'')::boolean);',
   '(payload->>''laboratory_applied'')::boolean,coalesce(payload->''details'',''{}''::jsonb));');
 execute definition;
end;
$$;

create function app_private.save_guide_details(p_guide uuid,p_details jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare g public.dispatch_guides%rowtype; item record; reviewed jsonb;
begin
 if p_details is null or jsonb_typeof(p_details)<>'object' then raise exception 'GUIDE_DETAILS_INVALID'; end if;
 for item in select * from jsonb_each(p_details) loop
   if item.key not in ('customerName','projectName','workAddress','guideDate','orderNumber','plant','truck','loadingTime','pilot','operator','observations')
     or jsonb_typeof(item.value)<>'string'
     or length(item.value#>>'{}')>(case when item.key='observations' then 4000 else 500 end) then
     raise exception 'GUIDE_DETAILS_INVALID';
   end if;
 end loop;
 if coalesce(p_details->>'loadingTime','')<>'' and p_details->>'loadingTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
   raise exception 'GUIDE_DETAILS_INVALID';
 end if;
 select * into g from public.dispatch_guides where id=p_guide for update;
 if not found or not app_private.has_project_permission(g.project_id,'dispatch.modify') then raise exception 'PERMISSION_DENIED'; end if;
 reviewed:=p_details||jsonb_build_object('guideDate',g.guide_date::text);
 update public.dispatch_guides set details=reviewed where id=p_guide;
 insert into public.audit_events(actor_user_id,project_id,entity_type,entity_id,action,old_values,new_values)
 values(auth.uid(),g.project_id,'dispatch_guide',g.id,'DISPATCH_GUIDE_DETAILS_UPDATED',
   jsonb_build_object('details',g.details),jsonb_build_object('details',reviewed));
end;
$$;
alter function app_private.save_guide_details(uuid,jsonb) owner to postgres;
revoke all on function app_private.save_guide_details(uuid,jsonb) from public,anon,authenticated,service_role;

-- Existing version, permission, catalog and resident checks remain atomic.
create function public.create_dispatch_guide_with_details(
 p_dispatch_id uuid,p_expected_version integer,p_guide_number text,p_guide_date date,p_lines jsonb,
 p_truck_arrival_time time,p_truck_departure_time time,p_casting_element text,p_laboratory_applied boolean,p_details jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare result jsonb;
begin
 result:=public.create_dispatch_guide_with_review(p_dispatch_id,p_expected_version,p_guide_number,p_guide_date,p_lines,p_truck_arrival_time,p_truck_departure_time,p_casting_element,p_laboratory_applied);
 perform app_private.save_guide_details((result->>'guide_id')::uuid,p_details);
 return result;
end;
$$;
create function public.update_dispatch_guide_with_details(
 p_guide_id uuid,p_expected_version integer,p_guide_number text,p_guide_date date,p_lines jsonb,
 p_truck_arrival_time time,p_truck_departure_time time,p_casting_element text,p_laboratory_applied boolean,p_details jsonb
) returns integer language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare result integer;
begin
 result:=public.update_dispatch_guide_with_review(p_guide_id,p_expected_version,p_guide_number,p_guide_date,p_lines,p_truck_arrival_time,p_truck_departure_time,p_casting_element,p_laboratory_applied);
 perform app_private.save_guide_details(p_guide_id,p_details);
 return result;
end;
$$;
alter function public.create_dispatch_guide_with_details(uuid,integer,text,date,jsonb,time,time,text,boolean,jsonb) owner to postgres;
alter function public.update_dispatch_guide_with_details(uuid,integer,text,date,jsonb,time,time,text,boolean,jsonb) owner to postgres;
revoke all on function public.create_dispatch_guide_with_details(uuid,integer,text,date,jsonb,time,time,text,boolean,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.update_dispatch_guide_with_details(uuid,integer,text,date,jsonb,time,time,text,boolean,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_dispatch_guide_with_details(uuid,integer,text,date,jsonb,time,time,text,boolean,jsonb) to authenticated;
grant execute on function public.update_dispatch_guide_with_details(uuid,integer,text,date,jsonb,time,time,text,boolean,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
