-- Supervisor: read-only planning, no Gmail, and only dispatch start/guide intake.
-- Role IDs, memberships, documents, dispatches and historical data are retained.
begin;

insert into public.permissions(code, description, active)
values ('dispatch.manage_guides', 'Cargar y corregir guías de despacho', true)
on conflict (code) do update set description = excluded.description, active = true;

-- Preserve guide intake for every role that could already modify a dispatch.
insert into public.role_permissions(role_id, permission_id)
select distinct assignment.role_id, guide_permission.id
from public.role_permissions assignment
join public.permissions permission on permission.id = assignment.permission_id
cross join public.permissions guide_permission
where permission.code = 'dispatch.modify' and guide_permission.code = 'dispatch.manage_guides'
on conflict do nothing;

delete from public.role_permissions assignment
using public.roles role, public.permissions permission
where assignment.role_id = role.id and assignment.permission_id = permission.id
  and role.code in ('SUPERVISOR', 'RECEPTION')
  and not (
    permission.code in ('programming.view', 'dispatch.view', 'document.view', 'dispatch.create', 'dispatch.manage_guides')
  );

-- Change only the guide permission checks in the current implementations.
-- Keep validation, audit, version checks, OCR, catalog alerts and uploads intact.
do $$
declare
  signature text;
  definition text;
  needle constant text := '''dispatch.modify''';
begin
  foreach signature in array array[
    'public.create_dispatch_guide_with_lines(uuid,integer,text,date,jsonb,time without time zone,time without time zone)',
    'public.update_dispatch_guide_with_lines(uuid,integer,text,date,jsonb,time without time zone,time without time zone)',
    'app_private.save_guide_resident(uuid,text,boolean)',
    'app_private.save_guide_details(uuid,jsonb)',
    'app_private.record_guide_catalog_incident(uuid)',
    'public.commit_vision_ocr_guide(uuid,integer,text)',
    'public.prepare_guide_document_upload(uuid,text,text,bigint,text,uuid)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 1 then
      raise exception 'SUPERVISOR_GUIDE_PERMISSION_PATCH_MISMATCH: %', signature;
    end if;
    execute replace(definition, needle, '''dispatch.manage_guides''');
  end loop;
end;
$$;

-- The upload finalizer resolves document ownership and permission by context.
-- A guide file uses guide intake; general dispatch evidence still needs modify.
do $$
declare
  definition text := pg_get_functiondef('app_private.resolve_dispatch_document_mutation(uuid)'::regprocedure);
  needle constant text := 'if v_context_type in (''DISPATCH'', ''GUIDE'') and not app_private.has_project_permission(
    v_project_id, ''dispatch.modify''
  ) then raise exception ''DISPATCH_DOCUMENT_PERMISSION_DENIED'';';
  replacement constant text := 'if v_context_type = ''GUIDE'' and not app_private.has_project_permission(
    v_project_id, ''dispatch.manage_guides''
  ) then raise exception ''GUIDE_DOCUMENT_PERMISSION_DENIED'';
  elsif v_context_type = ''DISPATCH'' and not app_private.has_project_permission(
    v_project_id, ''dispatch.modify''
  ) then raise exception ''DISPATCH_DOCUMENT_PERMISSION_DENIED'';';
begin
  if (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 1 then
    raise exception 'SUPERVISOR_DOCUMENT_PERMISSION_PATCH_MISMATCH';
  end if;
  execute replace(definition, needle, replacement);
end;
$$;

notify pgrst, 'reload schema';
commit;
