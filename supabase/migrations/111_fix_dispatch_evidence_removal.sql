-- Remove evidence children before the Document. Keep completed Dispatches,
-- invoice documents and documents with processing history protected.
begin;

do $$
begin
  if to_regprocedure('public.remove_dispatch_evidence(uuid)') is null
     or to_regprocedure('app_private.resolve_dispatch_document_mutation(uuid)') is null then
    raise exception 'DISPATCH_EVIDENCE_REMOVAL_PREREQUISITES_MISSING';
  end if;
end;
$$;

create or replace function public.remove_dispatch_evidence(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_context record;
  v_paths jsonb;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select resolved.* into v_context
  from app_private.resolve_dispatch_document_mutation(p_document_id) resolved;
  if v_context.context_type not in ('DISPATCH', 'GUIDE', 'INCIDENT') then
    raise exception 'DISPATCH_DOCUMENT_NOT_FOUND';
  end if;

  select dispatch.* into v_dispatch
  from public.dispatches dispatch
  where dispatch.id = case v_context.context_type
    when 'DISPATCH' then v_context.context_id
    when 'GUIDE' then (
      select guide.dispatch_id from public.dispatch_guides guide
      where guide.id = v_context.context_id
    )
    when 'INCIDENT' then (
      select incident.dispatch_id from public.dispatch_incidents incident
      where incident.id = v_context.context_id
    )
  end
  for update;
  if not found then raise exception 'DISPATCH_DOCUMENT_NOT_FOUND'; end if;
  if v_dispatch.status <> 'IN_EXECUTION' then
    raise exception 'DISPATCH_COMPLETED_NOT_EDITABLE';
  end if;
  if not app_private.has_project_permission(v_dispatch.project_id, 'dispatch.modify') then
    raise exception 'PERMISSION_DENIED';
  end if;

  perform document.id from public.documents document
  where document.id = p_document_id and document.project_id = v_dispatch.project_id
  for update;
  if not found then raise exception 'DISPATCH_DOCUMENT_NOT_FOUND'; end if;

  perform version.id from public.document_versions version
  where version.document_id = p_document_id for update;

  -- Do not remove extraction history or documents reused by other workflows.
  if exists (
    select 1 from public.document_processing_jobs job
    join public.document_versions version on version.id = job.document_version_id
    where version.document_id = p_document_id
  ) or exists (
    select 1 from public.programming_documents relation where relation.document_id = p_document_id
  ) or exists (
    select 1 from public.invoice_documents relation where relation.document_id = p_document_id
  ) then
    raise exception 'DISPATCH_EVIDENCE_IN_USE';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'bucket', version.storage_bucket, 'path', version.storage_path
  ) order by version.version), '[]'::jsonb) into v_paths
  from public.document_versions version where version.document_id = p_document_id;

  -- Keep the context link until after deleting versions, so the existing
  -- completed-Dispatch version guard continues to resolve the real Dispatch.
  delete from public.document_versions where document_id = p_document_id;
  case v_context.context_type
    when 'DISPATCH' then
      delete from public.dispatch_documents
      where document_id = p_document_id and dispatch_id = v_context.context_id;
    when 'GUIDE' then
      delete from public.guide_documents
      where document_id = p_document_id and guide_id = v_context.context_id;
    when 'INCIDENT' then
      delete from public.incident_documents
      where document_id = p_document_id and incident_id = v_context.context_id;
  end case;
  delete from public.documents where id = p_document_id;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type, entity_id, action, old_values
  ) values (
    v_actor, v_context.company_id, v_dispatch.project_id, 'document',
    p_document_id, 'DISPATCH_DOCUMENT_REMOVED', jsonb_build_object(
      'dispatch_id', v_dispatch.id,
      'context_type', v_context.context_type,
      'context_id', v_context.context_id,
      'storage_objects', v_paths
    )
  );
  return jsonb_build_object(
    'storage_objects', v_paths,
    'dispatch_id', v_dispatch.id,
    'project_id', v_dispatch.project_id
  );
end;
$$;

alter function public.remove_dispatch_evidence(uuid) owner to postgres;
revoke all on function public.remove_dispatch_evidence(uuid) from public, anon;
grant execute on function public.remove_dispatch_evidence(uuid) to authenticated, service_role;

commit;
