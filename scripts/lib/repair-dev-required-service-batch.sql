-- Run only through dev-required-service-reconciliation.mjs. Correct the four
-- reported DEV memberships without reopening or rewriting either batch.
create temp table repair_programs on commit drop as select id,to_jsonb(p) row_data from public.programming p;
create temp table repair_memberships on commit drop as select id,to_jsonb(bd) row_data from public.batch_dispatches bd;
create temp table repair_revisions on commit drop as select id,to_jsonb(r) row_data from public.programming_revisions r;
create temp table repair_revision_lines on commit drop as select id,to_jsonb(l) row_data from public.programming_revision_lines l;
create temp table repair_audits on commit drop as select id,to_jsonb(a) row_data from public.audit_events a;
do $$
declare
  v_project uuid:='f7a75157-9a9a-453a-a1ac-4d84c574f510';
  v_source uuid:='170a3723-90a5-40b2-adb4-21b5fc752b53';
  v_destination uuid:='f5eca458-a464-443e-9bdb-b2337b9ee57c';
  v_ids uuid[]:=array['66e80bb8-ff05-45c2-936e-8560241ee99a','2c935b90-be37-4d75-93e9-b9dade2da408','2f57bb14-1f6c-4224-9a59-83d7c8c792d1','8e93147c-6c54-4f2f-b5ba-da70be93a326']::uuid[];
  v_programs uuid[];v_actor uuid;v_before_destination bigint;v_row record;
begin
  if current_setting('app.required_service_repair_dev_guard',true) is distinct from 'gholwtklihaphoevosyb' then raise exception 'DEV_REPAIR_GUARD_REQUIRED';end if;
  if not exists(select 1 from public.batches src join public.batches dest on dest.project_id=src.project_id
    where src.id=v_source and dest.id=v_destination and src.project_id=v_project and src.status='CLOSED'
      and dest.status='OPEN' and dest.period_start=src.period_end+1)then raise exception 'DEV_REPAIR_BATCH_STATE_CHANGED';end if;
  if (select count(*)from public.batch_dispatches where dispatch_id=any(v_ids) and batch_id=v_destination and removed_at is null)=4
    and (select count(*)from public.batch_dispatches where dispatch_id=any(v_ids) and batch_id=v_source and removed_at is not null and rolled_to_batch_id=v_destination)=4 then
    raise notice 'DEV_REPAIR_ALREADY_APPLIED';return;
  end if;
  if (select count(*)from public.batch_dispatches bd join public.dispatches d on d.id=bd.dispatch_id
    join public.programming p on p.id=d.programming_id join public.dispatch_reconciliations r on r.dispatch_id=d.id
    where bd.batch_id=v_source and bd.removed_at is null and d.id=any(v_ids) and d.project_id=v_project
      and d.status='COMPLETED' and p.status='COMPLETED' and p.delivery_modes<>array['DIRECT']::text[]
      and r.status='RECONCILED' and r.service_status in('WITH_DIFFERENCES','PENDING_REINVOICING')
      and not app_private.dispatch_billing_complete(d.id))<>4 then raise exception 'DEV_REPAIR_TARGETS_CHANGED';end if;
  select created_by into v_actor from public.batches where id=v_source;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  if not app_private.has_project_permission(v_project,'batch.modify')then raise exception 'DEV_REPAIR_OPERATOR_PERMISSION_REQUIRED';end if;
  select array_agg(programming_id) into v_programs from public.dispatches where id=any(v_ids);
  select count(*)into v_before_destination from public.batch_dispatches where batch_id=v_destination and removed_at is null;
  for v_row in select bd.*from public.batch_dispatches bd where bd.batch_id=v_source and bd.dispatch_id=any(v_ids)and bd.removed_at is null order by bd.id for update loop
    perform app_private.sync_programming_completion_from_dispatch(v_row.dispatch_id);
    update public.batch_dispatches set removed_at=now(),removal_reason='Corrección de cierre: Servicio pendiente de conciliación o refacturación',rolled_to_batch_id=v_destination,
      removal_metadata=removal_metadata||jsonb_build_object('source','SYSTEM_ROLLOVER_REPAIR','completion_policy','BOTH_RECONCILIATIONS_V1')where id=v_row.id;
    insert into public.batch_dispatches(project_id,batch_id,dispatch_id,added_by,assignment_source,removal_metadata)
      values(v_project,v_destination,v_row.dispatch_id,null,'SYSTEM',jsonb_build_object('source','SYSTEM_ROLLOVER_REPAIR','from_batch_id',v_source,'from_relation_id',v_row.id));
  end loop;
  insert into public.audit_events(actor_user_id,project_id,entity_type,entity_id,action,old_values,new_values,comment)
    values(v_actor,v_project,'batch',v_source,'BATCH_PENDING_SERVICE_ROLLOVER_REPAIRED',jsonb_build_object('dispatch_ids',v_ids,'destination_active_count',v_before_destination),
      jsonb_build_object('dispatch_ids',v_ids,'destination_batch_id',v_destination,'moved',4,'completion_policy','BOTH_RECONCILIATIONS_V1'),
      'DEV: cuatro despachos retenidos por la regla anterior; se conserva el cierre original y todo el historial de guías y facturas.');
  if exists(select 1 from public.programming where id=any(v_programs)and status<>'DISPATCH_COMPLETED')
     or(select count(*)from public.batch_dispatches where batch_id=v_source and dispatch_id=any(v_ids)and removed_at is not null and rolled_to_batch_id=v_destination)<>4
     or(select count(*)from public.batch_dispatches where batch_id=v_destination and dispatch_id=any(v_ids)and removed_at is null)<>4
     or(select count(*)from public.batch_dispatches where batch_id=v_destination and removed_at is null)<>v_before_destination+4 then raise exception 'DEV_REPAIR_RESULT_INVALID';end if;
  if(select count(*)from public.programming)<>(select count(*)from repair_programs)
    or exists(select 1 from repair_programs old left join public.programming p using(id)where p.id is null or
      case when old.id=any(v_programs)then to_jsonb(p)-array['status','version','updated_at'] is distinct from old.row_data-array['status','version','updated_at']
        or p.version<>(old.row_data->>'version')::integer+1 else to_jsonb(p)is distinct from old.row_data end)then raise exception 'DEV_REPAIR_PROGRAM_FIELDS_CHANGED';end if;
  if exists(select 1 from repair_memberships old left join public.batch_dispatches bd using(id)where bd.id is null or
    case when(old.row_data->>'batch_id')::uuid=v_source and(old.row_data->>'dispatch_id')::uuid=any(v_ids)and old.row_data->>'removed_at' is null
      then to_jsonb(bd)-array['removed_at','removal_reason','rolled_to_batch_id','removal_metadata']is distinct from old.row_data-array['removed_at','removal_reason','rolled_to_batch_id','removal_metadata']
      else to_jsonb(bd)is distinct from old.row_data end)
    or(select count(*)from public.batch_dispatches bd where not exists(select 1 from repair_memberships old where old.id=bd.id))<>4 then raise exception 'DEV_REPAIR_MEMBERSHIP_HISTORY_CHANGED';end if;
  if exists(select 1 from repair_revisions old left join public.programming_revisions r using(id)where r.id is null or to_jsonb(r)is distinct from old.row_data)
    or exists(select 1 from repair_revision_lines old left join public.programming_revision_lines l using(id)where l.id is null or to_jsonb(l)is distinct from old.row_data)
    or exists(select 1 from repair_audits old left join public.audit_events a using(id)where a.id is null or to_jsonb(a)is distinct from old.row_data)then raise exception 'DEV_REPAIR_AUDIT_HISTORY_CHANGED';end if;
  raise notice 'DEV_REPAIR_VERIFIED: 4 pending dispatches moved, 4 programmings pending, original batches and all invoice/guide history preserved';
end;
$$;
select jsonb_build_object('moved',4,'source_active',(select count(*)from public.batch_dispatches where batch_id='170a3723-90a5-40b2-adb4-21b5fc752b53'and removed_at is null),'destination_active',(select count(*)from public.batch_dispatches where batch_id='f5eca458-a464-443e-9bdb-b2337b9ee57c'and removed_at is null));
