-- Record accepted catalog alerts atomically with new OCR guides. No backfill.
begin;

create function app_private.record_guide_catalog_incident(p_guide uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public,app_private as $$
declare
 g public.dispatch_guides%rowtype; d public.dispatches%rowtype;
 company uuid; incident_type uuid; incident uuid; alert_lines jsonb; description text;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into g from public.dispatch_guides where id=p_guide;
 if not found then raise exception 'GUIDE_NOT_FOUND'; end if;
 select * into d from public.dispatches where id=g.dispatch_id for update;
 if g.project_id is distinct from d.project_id or g.created_by is distinct from auth.uid()
    or not app_private.has_project_permission(g.project_id,'dispatch.modify') then raise exception 'PERMISSION_DENIED'; end if;
 if d.status<>'IN_EXECUTION' then raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE'; end if;
 select jsonb_agg(jsonb_build_object('position',position,'type',catalog_type,'code',product_code,
    'description',product_description,'quantity',quantity,'unit',unit_code) order by position),
   string_agg(format('Línea %s · %s %s · %s · Cantidad: %s%s',position,
     case catalog_type when 'PRODUCT' then 'Producto' else 'Servicio' end,product_code,
     coalesce(product_description,''),quantity,case when unit_code is null then '' else ' '||unit_code end),E'\n' order by position)
 into alert_lines,description from public.dispatch_guide_lines
 where guide_id=g.id and project_id=g.project_id and catalog_type in ('PRODUCT','SERVICE')
   and product_price_id is null and service_price_id is null and unit_price is null;
 if alert_lines is null then return; end if;
 -- The commit already locks its capture and returns early for a saved guide.
 -- Also make the private helper safe to repeat inside the transaction.
 if exists(select 1 from public.audit_events where entity_type='dispatch_incident' and action='DISPATCH_INCIDENT_REPORTED'
   and project_id=g.project_id and new_values->>'source'='GUIDE_CATALOG_WARNING' and new_values->>'guide_id'=g.id::text) then return; end if;
 select company_id into company from public.projects where id=g.project_id;
 insert into public.incident_types(company_id,code,name,active)
 values(company,'GUIDE_CATALOG_NOT_FOUND','Producto o servicio fuera de la cotización',true)
 on conflict(company_id,code) do nothing;
 select id into incident_type from public.incident_types where company_id=company and code='GUIDE_CATALOG_NOT_FOUND' and active;
 if incident_type is null then raise exception 'GUIDE_CATALOG_INCIDENT_TYPE_INACTIVE'; end if;
 insert into public.dispatch_incidents(project_id,dispatch_id,incident_type_id,responsibility,charge_applicability,notes,reported_by)
 values(g.project_id,g.dispatch_id,incident_type,'UNDETERMINED','UNDETERMINED',
   format('Guía %s guardada con productos o servicios fuera de la cotización del proyecto. Precio pendiente.%s%s',g.guide_number,E'\n',description),auth.uid())
 returning id into incident;
 insert into public.audit_events(actor_user_id,company_id,project_id,entity_type,entity_id,action,new_values)
 values(auth.uid(),company,g.project_id,'dispatch_incident',incident,'DISPATCH_INCIDENT_REPORTED',jsonb_build_object(
   'dispatch_id',g.dispatch_id,'guide_id',g.id,'guide_number',g.guide_number,'incident_type_id',incident_type,
   'source','GUIDE_CATALOG_WARNING','responsibility','UNDETERMINED','charge_applicability','UNDETERMINED','lines',alert_lines));
end;
$$;
alter function app_private.record_guide_catalog_incident(uuid) owner to postgres;
revoke all on function app_private.record_guide_catalog_incident(uuid) from public,anon,authenticated,service_role;

do $$
declare
 definition text:=pg_get_functiondef('public.commit_vision_ocr_guide(uuid,integer,text)'::regprocedure);
 needle text:='  select * into upload from public.prepare_guide_document_upload(';
begin
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
   raise exception 'GUIDE_CATALOG_INCIDENT_PREREQUISITE_CHANGED';
 end if;
 execute replace(definition,needle,'  perform app_private.record_guide_catalog_incident(guide);'||E'\n'||needle);
end;
$$;
notify pgrst,'reload schema';
commit;
