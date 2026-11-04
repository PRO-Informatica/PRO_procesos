-- Integration test for 111. Creates metadata-only fixtures, never calls Storage,
-- and rolls back every write, including all removals and finalization checks.
begin;

create function pg_temp.reject_evidence_removal_audit()
returns trigger language plpgsql as $$
begin
  if current_setting('qa.reject_evidence_removal_audit', true) = 'on'
     and new.action = 'DISPATCH_DOCUMENT_REMOVED' then
    raise exception 'QA_EVIDENCE_AUDIT_FAILURE';
  end if;
  return new;
end;
$$;
create trigger qa_reject_evidence_removal_audit before insert on public.audit_events
for each row execute function pg_temp.reject_evidence_removal_audit();

do $$
declare
  v_dispatch public.dispatches%rowtype;
  v_unit text;
  v_incident uuid;
  v_type uuid;
  v_guide uuid := gen_random_uuid();
  v_doc uuid;
  v_version uuid;
  v_context text;
  v_paths jsonb;
  v_result jsonb;
begin
  select dispatch.* into strict v_dispatch
  from public.dispatches dispatch
  join public.profiles profile on profile.id = dispatch.created_by and profile.active
  where dispatch.status = 'IN_EXECUTION'
  order by dispatch.created_at desc limit 1;
  select unit_code into v_unit from public.programming where id = v_dispatch.programming_id;
  select incident_type.id into strict v_type from public.incident_types incident_type
  join public.projects project on project.company_id = incident_type.company_id
  where project.id = v_dispatch.project_id and incident_type.active
  order by incident_type.id limit 1;
  perform set_config('request.jwt.claim.sub', v_dispatch.created_by::text, true);
  execute 'set local role authenticated';
  v_incident := public.register_dispatch_incident(v_dispatch.id, v_type, 'PROJECT', 'NO', 'QA temporary');
  execute 'reset role';
  insert into public.dispatch_guides(id, project_id, dispatch_id, guide_number, guide_date, quantity, unit_code, created_by)
  values (v_guide, v_dispatch.project_id, v_dispatch.id, 'QA-' || v_guide::text, current_date, 1, v_unit, v_dispatch.created_by);

  foreach v_context in array array['DISPATCH', 'GUIDE', 'INCIDENT'] loop
    v_doc := gen_random_uuid();
    insert into public.documents(id, project_id, category, created_by)
    values (v_doc, v_dispatch.project_id, case v_context when 'INCIDENT' then 'INCIDENT_EVIDENCE' when 'GUIDE' then 'DISPATCH_GUIDE' else 'DISPATCH_EVIDENCE' end, v_dispatch.created_by);
    case v_context
      when 'DISPATCH' then
        insert into public.dispatch_documents(project_id, dispatch_id, document_id, purpose)
        values(v_dispatch.project_id, v_dispatch.id, v_doc, 'DISPATCH_EVIDENCE');
      when 'GUIDE' then
        insert into public.guide_documents(project_id, guide_id, document_id, purpose)
        values(v_dispatch.project_id, v_guide, v_doc, 'DISPATCH_GUIDE');
      when 'INCIDENT' then
        insert into public.incident_documents(project_id, incident_id, document_id, purpose)
        values(v_dispatch.project_id, v_incident, v_doc, 'INCIDENT_EVIDENCE');
    end case;
    insert into public.document_versions(document_id, version, storage_bucket, storage_path, file_name, mime_type, upload_status, uploaded_at, is_current, uploaded_by)
    select v_doc, n, 'private-documents', 'qa-only/' || v_doc::text || '/' || n,
      'qa.pdf', 'application/pdf', 'UPLOADED', now(), n = 2, v_dispatch.created_by
    from generate_series(1, 2) n;
    select jsonb_agg(jsonb_build_object('bucket',storage_bucket,'path',storage_path) order by version)
    into v_paths from public.document_versions where document_id = v_doc;

    execute 'set local role authenticated';
    v_result := public.remove_dispatch_evidence(v_doc);
    execute 'reset role';
    if v_result->'storage_objects' is distinct from v_paths
       or v_result->>'dispatch_id' <> v_dispatch.id::text
       or exists(select 1 from public.documents where id = v_doc)
       or exists(select 1 from public.document_versions where document_id = v_doc)
       or exists(select 1 from public.dispatch_documents where document_id = v_doc)
       or exists(select 1 from public.guide_documents where document_id = v_doc)
       or exists(select 1 from public.incident_documents where document_id = v_doc)
       or not exists(select 1 from public.dispatches where id = v_dispatch.id)
       or not exists(select 1 from public.dispatch_guides where id = v_guide)
       or not exists(select 1 from public.dispatch_incidents where id = v_incident)
       or not exists(select 1 from public.audit_events where entity_id = v_doc and actor_user_id = v_dispatch.created_by and action = 'DISPATCH_DOCUMENT_REMOVED' and old_values->'storage_objects' = v_paths) then
      raise exception 'QA_EVIDENCE_CONTEXT_REMOVAL_FAILED: %', v_context;
    end if;
    raise notice 'PASS: % evidence and all versions removed, parent records retained, paths and actor audited', v_context;
  end loop;

  -- A fresh disposable fixture for rejection and rollback cases.
  v_doc := gen_random_uuid(); v_version := gen_random_uuid();
  insert into public.documents(id,project_id,category,created_by)
  values(v_doc,v_dispatch.project_id,'DISPATCH_EVIDENCE',v_dispatch.created_by);
  insert into public.dispatch_documents(project_id,dispatch_id,document_id,purpose)
  values(v_dispatch.project_id,v_dispatch.id,v_doc,'DISPATCH_EVIDENCE');
  insert into public.document_versions(id,document_id,version,storage_bucket,storage_path,file_name,mime_type,upload_status,uploaded_at,is_current,uploaded_by)
  values(v_version,v_doc,1,'private-documents','qa-only/'||v_doc::text,'qa.pdf','application/pdf','UPLOADED',now(),true,v_dispatch.created_by);

  perform set_config('qa.reject_evidence_removal_audit','on',true);
  execute 'set local role authenticated';
  begin
    perform public.remove_dispatch_evidence(v_doc);
    raise exception 'QA_EXPECTED_EVIDENCE_FAILURE_MISSING';
  exception when raise_exception then
    if sqlerrm <> 'QA_EVIDENCE_AUDIT_FAILURE' then raise; end if;
  end;
  execute 'reset role';
  perform set_config('qa.reject_evidence_removal_audit','off',true);
  if not exists(select 1 from public.documents where id=v_doc)
     or not exists(select 1 from public.document_versions where id=v_version)
     or not exists(select 1 from public.dispatch_documents where document_id=v_doc) then
    raise exception 'QA_EVIDENCE_ATOMIC_ROLLBACK_FAILED';
  end if;
  raise notice 'PASS: a dependent failure rolls back document, versions and context link';

  begin
    insert into public.document_processing_jobs(document_version_id) values(v_version);
    execute 'set local role authenticated';
    begin
      perform public.remove_dispatch_evidence(v_doc);
      raise exception 'QA_PROCESSING_DOCUMENT_REMOVAL_ALLOWED';
    exception when raise_exception then
      if sqlerrm <> 'DISPATCH_EVIDENCE_IN_USE' then raise; end if;
    end;
    execute 'reset role';
    raise exception 'QA_ROLLBACK_PROCESSING_FIXTURE';
  exception when raise_exception then
    if sqlerrm <> 'QA_ROLLBACK_PROCESSING_FIXTURE' then raise; end if;
  end;
  raise notice 'PASS: documents with processing history are preserved';

  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  execute 'set local role authenticated';
  begin
    perform public.remove_dispatch_evidence(v_doc);
    raise exception 'QA_UNAUTHORIZED_EVIDENCE_REMOVAL_ALLOWED';
  exception when raise_exception then
    if position('PERMISSION_DENIED' in sqlerrm) = 0 then raise; end if;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',v_dispatch.created_by::text,true);
  raise notice 'PASS: unauthorized caller cannot remove evidence';

  -- Finalize only inside a subtransaction so all parent state changes revert.
  begin
    execute 'set local role authenticated';
    perform public.finalize_dispatch(v_dispatch.id,v_dispatch.version,v_dispatch.arrival_at,
      v_dispatch.arrival_at,v_dispatch.received_by_name,'NOT_DISPATCHED',v_dispatch.order_number,0,v_unit);
    begin
      perform public.remove_dispatch_evidence(v_doc);
      raise exception 'QA_COMPLETED_EVIDENCE_REMOVAL_ALLOWED';
    exception when raise_exception then
      if sqlerrm <> 'DISPATCH_COMPLETED_NOT_EDITABLE' then raise; end if;
    end;
    execute 'reset role';
    raise exception 'QA_ROLLBACK_COMPLETED_FIXTURE';
  exception when raise_exception then
    if sqlerrm <> 'QA_ROLLBACK_COMPLETED_FIXTURE' then raise; end if;
  end;
  raise notice 'PASS: completed Dispatch evidence remains immutable';
end;
$$;

rollback;
