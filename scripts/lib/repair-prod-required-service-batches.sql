-- Audited PROD repair: six incomplete programmings, five memberships stranded
-- in closed batches, one already in the open batch. Preserve every invoice,
-- guide and original batch closure. Run only through the guarded release script.
create temp table repair_programs on commit drop as select id,to_jsonb(p) row_data from public.programming p;
create temp table repair_memberships on commit drop as select id,to_jsonb(bd) row_data from public.batch_dispatches bd;
create temp table repair_revisions on commit drop as select id,to_jsonb(r) row_data from public.programming_revisions r;
create temp table repair_revision_lines on commit drop as select id,to_jsonb(l) row_data from public.programming_revision_lines l;
create temp table repair_audits on commit drop as select id,to_jsonb(a) row_data from public.audit_events a;
do $$
declare
  v_project uuid:='f7a75157-9a9a-453a-a1ac-4d84c574f510';
  v_closed uuid[]:=array['170a3723-90a5-40b2-adb4-21b5fc752b53','f5eca458-a464-443e-9bdb-b2337b9ee57c']::uuid[];
  v_destination uuid:='f154750a-c306-4c1b-b101-fda78ab18b0c';
  v_ids uuid[]:=array['66e80bb8-ff05-45c2-936e-8560241ee99a','2c935b90-be37-4d75-93e9-b9dade2da408','2f57bb14-1f6c-4224-9a59-83d7c8c792d1','8e93147c-6c54-4f2f-b5ba-da70be93a326','a179cabc-e321-48c1-83c8-301d304f0a04','f24824b9-c9a3-4a33-84f4-aaf21cf449cd']::uuid[];
  v_programs uuid[];v_actor uuid;v_company uuid;v_row record;v_moved integer:=0;
begin
  if current_setting('app.required_service_repair_prod_guard',true) is distinct from 'jeyjblxfqqlypxiaznad'
    then raise exception 'PROD_REPAIR_GUARD_REQUIRED';end if;
  select p.id into strict v_actor from public.profiles p join auth.users u on u.id=p.id
    where p.active and lower(u.email)='demidio@pro.com.gt';
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  if not app_private.has_project_permission(v_project,'batch.modify')
    or not app_private.has_project_permission(v_project,'batch.view') then raise exception 'PROD_REPAIR_OPERATOR_PERMISSION_REQUIRED';end if;
  select company_id into strict v_company from public.projects where id=v_project;
  if exists(select 1 from public.audit_events where entity_id=v_destination and action='PROD_REQUIRED_SERVICE_COMPLETION_REPAIRED') then
    if (select count(*)from public.batch_dispatches where batch_id=v_destination and dispatch_id=any(v_ids)and removed_at is null)<>6
      or exists(select 1 from public.dispatches d join public.programming p on p.id=d.programming_id where d.id=any(v_ids)and(p.status<>'DISPATCH_COMPLETED'or app_private.dispatch_billing_complete(d.id)))
      then raise exception 'PROD_REPAIR_POST_STATE_CHANGED';end if;
    raise notice 'PROD_REPAIR_ALREADY_APPLIED_VERIFIED';return;
  end if;
  if (select count(*)from public.batches where id=any(v_closed)and project_id=v_project and status='CLOSED')<>2
    or not exists(select 1 from public.batches where id=v_destination and project_id=v_project and status='OPEN'and period_start=date '2026-11-02'and period_end=date '2026-11-08')
    or (select count(*)from public.batch_dispatches where batch_id=v_destination and removed_at is null)<>1
    then raise exception 'PROD_REPAIR_BATCH_STATE_CHANGED';end if;
  if (select count(*)from public.dispatches d join public.programming p on p.id=d.programming_id join public.dispatch_reconciliations r on r.dispatch_id=d.id
    where d.id=any(v_ids)and d.project_id=v_project and p.project_id=v_project and d.status='COMPLETED'and p.status='COMPLETED'
      and p.delivery_modes is distinct from array['DIRECT']::text[]and r.status='RECONCILED'
      and r.service_status in('WITH_DIFFERENCES','PENDING_REINVOICING')and not app_private.dispatch_billing_complete(d.id))<>6
    or (select count(*)from public.batch_dispatches where dispatch_id=any(v_ids)and batch_id=any(v_closed)and removed_at is null)<>5
    or not exists(select 1 from public.batch_dispatches where dispatch_id='f24824b9-c9a3-4a33-84f4-aaf21cf449cd'and batch_id=v_destination and removed_at is null)
    then raise exception 'PROD_REPAIR_TARGETS_CHANGED';end if;
  select array_agg(distinct programming_id) into v_programs from public.dispatches where id=any(v_ids);
  if cardinality(v_programs)<>6 then raise exception 'PROD_REPAIR_PROGRAMMING_SET_CHANGED';end if;
  for v_row in select id from public.dispatches where id=any(v_ids)order by id loop
    if not app_private.sync_programming_completion_from_dispatch(v_row.id)then raise exception 'PROD_REPAIR_PROGRAMMING_NOT_REOPENED';end if;
  end loop;
  for v_row in select *from public.batch_dispatches where batch_id=any(v_closed)and dispatch_id=any(v_ids)and removed_at is null order by id for update loop
    update public.batch_dispatches set removed_at=now(),removed_by=v_actor,
      removal_reason='Corrección de cierre: Servicio pendiente; continúa en el siguiente lote abierto',rolled_to_batch_id=v_destination,
      removal_metadata=removal_metadata||jsonb_build_object('source','SYSTEM_PROD_ROLLOVER_REPAIR','completion_policy','BOTH_RECONCILIATIONS_V1',
        'skipped_closed_batch_ids',case when v_row.batch_id=v_closed[1]then to_jsonb(array[v_closed[2]])else '[]'::jsonb end)
      where id=v_row.id;
    insert into public.batch_dispatches(project_id,batch_id,dispatch_id,added_by,assignment_source,removal_metadata)
      values(v_project,v_destination,v_row.dispatch_id,null,'SYSTEM',jsonb_build_object('source','SYSTEM_PROD_ROLLOVER_REPAIR','from_batch_id',v_row.batch_id,'from_relation_id',v_row.id));
    v_moved:=v_moved+1;
  end loop;
  insert into public.audit_events(actor_user_id,company_id,project_id,entity_type,entity_id,action,old_values,new_values,comment)
    values(v_actor,v_company,v_project,'batch',v_destination,'PROD_REQUIRED_SERVICE_COMPLETION_REPAIRED',
      jsonb_build_object('dispatch_ids',v_ids,'source_batch_ids',v_closed,'destination_active_count',1),
      jsonb_build_object('dispatch_ids',v_ids,'destination_batch_id',v_destination,'moved',v_moved,'programming_reopened',6,'completion_policy','BOTH_RECONCILIATIONS_V1'),
      'Pase autorizado a producción: se corrige la clasificación financiera y el traslado pendiente; se conservan cierres originales, guías, importes y facturas.');
  if v_moved<>5 or exists(select 1 from public.programming where id=any(v_programs)and status<>'DISPATCH_COMPLETED')
    or exists(select 1 from public.batch_dispatches where batch_id=any(v_closed)and dispatch_id=any(v_ids)and removed_at is null)
    or(select count(*)from public.batch_dispatches where batch_id=v_destination and dispatch_id=any(v_ids)and removed_at is null)<>6
    or(select count(*)from public.batch_dispatches where batch_id=v_destination and removed_at is null)<>6
    then raise exception 'PROD_REPAIR_RESULT_INVALID';end if;
  -- Verify the public RPC and actual next-close preview using the authorized actor.
  if (select count(*)from public.preview_weekly_batch_rollover(v_destination)where rollover_action='MOVE')<>6
    or exists(select 1 from public.preview_weekly_batch_rollover(v_destination)where rollover_action<>'MOVE')
    or exists(select 1 from unnest(v_ids)id where public.get_dispatch_billing_completion(array[v_project])->>id::text is distinct from 'false')
    then raise exception 'PROD_REPAIR_PUBLIC_COMPLETION_MISMATCH';end if;
  if(select count(*)from public.programming)<>(select count(*)from repair_programs)
    or exists(select 1 from repair_programs old left join public.programming p using(id)where p.id is null or
      case when old.id=any(v_programs)then to_jsonb(p)-array['status','version','updated_at']is distinct from old.row_data-array['status','version','updated_at']
        or p.version<>(old.row_data->>'version')::integer+1 else to_jsonb(p)is distinct from old.row_data end)
    then raise exception 'PROD_REPAIR_PROGRAM_FIELDS_CHANGED';end if;
  if exists(select 1 from repair_memberships old left join public.batch_dispatches bd using(id)where bd.id is null or
    case when(old.row_data->>'batch_id')::uuid=any(v_closed)and(old.row_data->>'dispatch_id')::uuid=any(v_ids)and old.row_data->>'removed_at' is null
      then to_jsonb(bd)-array['removed_at','removed_by','removal_reason','rolled_to_batch_id','removal_metadata']is distinct from old.row_data-array['removed_at','removed_by','removal_reason','rolled_to_batch_id','removal_metadata']
      else to_jsonb(bd)is distinct from old.row_data end)
    or(select count(*)from public.batch_dispatches bd where not exists(select 1 from repair_memberships old where old.id=bd.id))<>5
    then raise exception 'PROD_REPAIR_MEMBERSHIP_HISTORY_CHANGED';end if;
  if exists(select 1 from repair_revisions old left join public.programming_revisions r using(id)where r.id is null or to_jsonb(r)is distinct from old.row_data)
    or exists(select 1 from repair_revision_lines old left join public.programming_revision_lines l using(id)where l.id is null or to_jsonb(l)is distinct from old.row_data)
    or exists(select 1 from repair_audits old left join public.audit_events a using(id)where a.id is null or to_jsonb(a)is distinct from old.row_data)
    then raise exception 'PROD_REPAIR_AUDIT_HISTORY_CHANGED';end if;
  raise notice 'PROD_REPAIR_VERIFIED: 6 programmings pending, 5 dispatches moved, 6 in open batch; all previous history preserved';
end;
$$;
