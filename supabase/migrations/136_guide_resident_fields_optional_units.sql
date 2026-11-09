-- DEV-only OCR branch: optional line UM and resident-confirmed guide data.
-- Existing guides keep their fields/lines; no source identity is inferred.
begin;
alter table public.dispatch_guides
  add column casting_element text check(casting_element in ('COLUMNS','PILES')),
  add column laboratory_applied boolean not null default false;
alter table public.dispatch_guide_lines alter column unit_code drop not null;
comment on column public.dispatch_guides.casting_element is 'Resident-selected: COLUMNS or PILES; NULL on legacy guides.';
comment on column public.dispatch_guides.laboratory_applied is 'Resident confirmation; never inferred by OCR.';

-- Fail loudly if a prerequisite function has changed; preserve its permissions.
create function pg_temp.patch_guide_function(signature text, needle text, replacement text, occurrences integer) returns void
language plpgsql as $$
declare definition text:=pg_get_functiondef(signature::regprocedure);
begin
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>occurrences then
   raise exception 'GUIDE_MIGRATION_PREREQUISITE_CHANGED: %',signature;
 end if;
 execute replace(definition,needle,replacement);
end;
$$;
select pg_temp.patch_guide_function('app_private.resolve_dispatch_guide_lines(uuid,text,jsonb,uuid)','    if v_unit is null or v_unit not in (''KM'', ''M'', ''M2'', ''M3'', ''UN'', ''SERVICIO'', ''COMBO'', ''RECARGO'', ''DOSIS/M3'')
       or not exists (
         select 1 from public.units_of_measure unit
         where unit.code = v_unit and unit.active
       ) then
      raise exception ''INVALID_OR_INACTIVE_UNIT_OF_MEASURE'';
    end if;

','    -- Empty is allowed; a supplied unit must still be valid and active.
    v_unit := nullif(v_unit,'''');
    if nullif(btrim(coalesce(v_item->>''unit_code'','''')),'''') is not null and (
       v_unit is null or v_unit not in (''KM'',''M'',''M2'',''M3'',''UN'',''SERVICIO'',''COMBO'',''RECARGO'',''DOSIS/M3'')
       or not exists(select 1 from public.units_of_measure u where u.code=v_unit and u.active)) then
      raise exception ''INVALID_OR_INACTIVE_UNIT_OF_MEASURE'';
    end if;

',1);
select pg_temp.patch_guide_function('app_private.resolve_dispatch_guide_lines(uuid,text,jsonb,uuid)','if v_unit is distinct from p_programming_unit then','if v_unit is not null and v_unit is distinct from p_programming_unit then',2);
select pg_temp.patch_guide_function('app_private.resolve_dispatch_guide_lines(uuid,text,jsonb,uuid)','if v_service.unit_code is not null and v_unit is distinct from v_service.unit_code then','if v_unit is not null and v_service.unit_code is not null and v_unit is distinct from v_service.unit_code then',1);
select pg_temp.patch_guide_function('app_private.resolve_ocr_guide_lines(uuid,text,jsonb)','if qty<=0 or unit is null or not exists(select 1 from public.units_of_measure u where u.active and u.code=unit) then','if qty<=0 or (nullif(btrim(coalesce(item->>''unit_code'','''')),'''') is not null and (unit is null or not exists(select 1 from public.units_of_measure u where u.active and u.code=unit))) then',1);
select pg_temp.patch_guide_function('app_private.resolve_ocr_guide_lines(uuid,text,jsonb)','if kind=''PRODUCT'' and unit is distinct from p_unit then','if kind=''PRODUCT'' and unit is not null and unit is distinct from p_unit then',1);
select pg_temp.patch_guide_function('app_private.sync_dispatch_guide_line_rollup()','and line.unit_code is distinct from v_programming_unit','and line.unit_code is not null and line.unit_code is distinct from v_programming_unit',1);
select pg_temp.patch_guide_function('public.complete_dispatch(uuid,integer)','              and nullif(btrim(line.unit_code), '''') is not null','              -- A missing commercial line UM does not invalidate a guide.',1);
select pg_temp.patch_guide_function('public.commit_vision_ocr_guide(uuid,integer,text)','  payload:=capture.review_payload;','  payload:=capture.review_payload;
  if coalesce(payload->>''casting_element'','''') not in (''COLUMNS'',''PILES'')
     or jsonb_typeof(payload->''laboratory_applied'') is distinct from ''boolean'' then
    raise exception ''GUIDE_RESIDENT_SELECTION_REQUIRED'';
  end if;',1);
select pg_temp.patch_guide_function('public.commit_vision_ocr_guide(uuid,integer,text)','created_by,truck_arrival_at,truck_departure_at)','created_by,truck_arrival_at,truck_departure_at,casting_element,laboratory_applied)',1);
select pg_temp.patch_guide_function('public.commit_vision_ocr_guide(uuid,integer,text)','total,unit,auth.uid(),arrival,departure);','total,unit,auth.uid(),arrival,departure,payload->>''casting_element'',(payload->>''laboratory_applied'')::boolean);',1);
select pg_temp.patch_guide_function('public.commit_vision_ocr_guide(uuid,integer,text)','''reviewed_fields'',payload->''details'',','''casting_element'',payload->>''casting_element'',''laboratory_applied'',payload->''laboratory_applied'',''reviewed_fields'',payload->''details'',',1);

-- Preserve old RPC signatures for legacy clients. The reviewed form always
-- uses these atomic wrappers, so a resident choice cannot be lost on retry.
create function app_private.save_guide_resident(p_guide uuid,p_element text,p_laboratory boolean) returns void
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare g public.dispatch_guides%rowtype;
begin
 if p_element is null or p_element not in ('COLUMNS','PILES') or p_laboratory is null then
   raise exception 'GUIDE_RESIDENT_SELECTION_REQUIRED';
 end if;
 select * into g from public.dispatch_guides where id=p_guide for update;
 if not found or not app_private.has_project_permission(g.project_id,'dispatch.modify') then raise exception 'PERMISSION_DENIED'; end if;
 update public.dispatch_guides set casting_element=p_element,laboratory_applied=p_laboratory where id=p_guide;
 insert into public.audit_events(actor_user_id,project_id,entity_type,entity_id,action,old_values,new_values)
 values(auth.uid(),g.project_id,'dispatch_guide',g.id,'DISPATCH_GUIDE_RESIDENT_REVIEWED',
   jsonb_build_object('casting_element',g.casting_element,'laboratory_applied',g.laboratory_applied),
   jsonb_build_object('casting_element',p_element,'laboratory_applied',p_laboratory));
end;
$$;
alter function app_private.save_guide_resident(uuid,text,boolean) owner to postgres;
revoke all on function app_private.save_guide_resident(uuid,text,boolean) from public,anon,authenticated,service_role;

create function public.create_dispatch_guide_with_review(
 p_dispatch_id uuid,p_expected_version integer,p_guide_number text,p_guide_date date,p_lines jsonb,
 p_truck_arrival_time time,p_truck_departure_time time,p_casting_element text,p_laboratory_applied boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare result jsonb;
begin
 result:=public.create_dispatch_guide_with_lines(p_dispatch_id,p_expected_version,p_guide_number,p_guide_date,p_lines,p_truck_arrival_time,p_truck_departure_time);
 perform app_private.save_guide_resident((result->>'guide_id')::uuid,p_casting_element,p_laboratory_applied);
 return result;
end;
$$;
create function public.update_dispatch_guide_with_review(
 p_guide_id uuid,p_expected_version integer,p_guide_number text,p_guide_date date,p_lines jsonb,
 p_truck_arrival_time time,p_truck_departure_time time,p_casting_element text,p_laboratory_applied boolean
) returns integer language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare result integer;
begin
 result:=public.update_dispatch_guide_with_lines(p_guide_id,p_expected_version,p_guide_number,p_guide_date,p_lines,p_truck_arrival_time,p_truck_departure_time);
 perform app_private.save_guide_resident(p_guide_id,p_casting_element,p_laboratory_applied);
 return result;
end;
$$;
alter function public.create_dispatch_guide_with_review(uuid,integer,text,date,jsonb,time,time,text,boolean) owner to postgres;
alter function public.update_dispatch_guide_with_review(uuid,integer,text,date,jsonb,time,time,text,boolean) owner to postgres;
revoke all on function public.create_dispatch_guide_with_review(uuid,integer,text,date,jsonb,time,time,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.update_dispatch_guide_with_review(uuid,integer,text,date,jsonb,time,time,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.create_dispatch_guide_with_review(uuid,integer,text,date,jsonb,time,time,text,boolean) to authenticated;
grant execute on function public.update_dispatch_guide_with_review(uuid,integer,text,date,jsonb,time,time,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
