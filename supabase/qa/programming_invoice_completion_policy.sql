-- DEV only. Synthetic Programming/Dispatch/Invoice/Document metadata fixtures;
-- no Storage upload, email, trigger disabling or persistent business changes.
-- Run after 115; the entire test, including its helpers and audits, rolls back.
begin;

create function pg_temp.qa115_invoice(p_dispatch uuid, p_type public.invoice_type,
  p_actor uuid, p_quantity numeric, p_pending boolean default false)
returns uuid language plpgsql as $$
declare
  v_dispatch public.dispatches%rowtype;
  v_invoice uuid; v_document uuid; v_upload record; v_job uuid; v_date date;
begin
  select * into strict v_dispatch from public.dispatches where id=p_dispatch;
  select (clock_timestamp() at time zone coalesce(timezone,'America/Guatemala'))::date
    into v_date from public.projects where id=v_dispatch.project_id;
  insert into public.invoices(project_id,dispatch_id,supplier_id,invoice_type,invoice_number,
    invoice_date,order_number,subtotal,total,currency,status,created_by)
  values(v_dispatch.project_id,p_dispatch,v_dispatch.supplier_id,p_type,'QA115-'||gen_random_uuid(),
    v_date,v_dispatch.order_number,100,100,'GTQ','REGISTERED',p_actor) returning id into v_invoice;
  insert into public.documents(project_id,category,created_by)
    values(v_dispatch.project_id,'INVOICE',p_actor) returning id into v_document;
  select * into v_upload from app_private.prepare_document_upload_version(
    v_document,v_dispatch.project_id,p_actor,'qa-115.pdf','application/pdf',100);
  insert into public.document_processing_jobs(document_version_id,status,provider_key,attempt_count)
    values(v_upload.version_id,'PENDING','QA_115',1) returning id into v_job;
  insert into public.invoice_extractions(processing_job_id,invoice_id,raw_payload,normalized_payload,processed_by)
  values(v_job,v_invoice,'{}',jsonb_build_object('invoice_date',v_date,
    'invoiced_quantity',p_quantity,'normalized_unit','M3',
    'detected_order_number',v_dispatch.order_number,
    'validations',jsonb_build_object('document_valid',true,'type_valid',true,'project_valid',true,
      'supplier_valid',true,'order_valid',true)),p_actor);
  if p_pending then
    insert into public.invoice_recipient_exceptions(project_id,dispatch_id,invoice_id,invoice_type,
      detected_billing_legal_name,detected_identity,status)
    values(v_dispatch.project_id,p_dispatch,v_invoice,p_type,'C14','C14','PENDING');
  end if;
  perform app_private.refresh_dispatch_reconciliation(p_dispatch);
  return v_invoice;
end;
$$;

do $$
declare
  v_project uuid; v_supplier uuid; v_actor uuid; v_timezone text; v_today date;
  v_schedule timestamptz; v_batch uuid; v_destination uuid; v_programming uuid;
  v_dispatch uuid; v_invoice uuid; v_exception uuid; v_version integer;
  v_i integer; v_modes text[]; v_result jsonb; v_state public.dispatch_reconciliation_status;
  v_dispatches uuid[] := '{}'; v_programmings uuid[] := '{}'; v_count integer;
begin
  select programming.project_id,programming.supplier_id,programming.created_by,project.timezone
    into strict v_project,v_supplier,v_actor,v_timezone
  from public.programming programming
  join public.projects project on project.id=programming.project_id and project.status='ACTIVE'
  join public.platform_admins admin on admin.user_id=programming.created_by and admin.active
  join public.project_suppliers relation on relation.project_id=programming.project_id
    and relation.supplier_id=programming.supplier_id and relation.active
  order by programming.created_at desc limit 1;
  v_timezone := coalesce(v_timezone,'America/Guatemala');
  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_schedule := (v_today + time '10:00') at time zone v_timezone;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  v_batch := app_private.ensure_batch_month_segment(v_project,v_today);

  -- Manual creation/edit keeps version, required reason, re-confirmation and
  -- historical delivery-mode snapshots, rather than changing started records.
  execute 'set local role authenticated';
  v_programming := public.create_programming_with_details(v_project,v_supplier,v_schedule+interval '3 days',
    '[{"quantity":1,"unit_code":"M3","concrete_type":"QA115"}]','QA115-EDIT',null,array['DIRECT']);
  select version into v_version from public.programming where id=v_programming;
  perform public.confirm_programming(v_programming,1,v_version);
  select version into v_version from public.programming where id=v_programming;
  perform public.update_programming_with_details(v_programming,v_version,v_supplier,v_schedule+interval '3 days',
    '[{"quantity":1,"unit_code":"M3","concrete_type":"QA115"}]','QA115-EDIT','QA reason',null,array['PUMP']);
  execute 'reset role';
  if (select status from public.programming where id=v_programming)<>'PENDING_CONFIRMATION'
    or (select delivery_modes from public.programming_revisions where programming_id=v_programming
      order by revision_no desc limit 1)<>array['PUMP'] then raise exception 'QA115_MANUAL_EDIT_FAILED'; end if;
  execute 'set local role authenticated';
  begin
    perform public.create_programming_with_details(v_project,v_supplier,v_schedule+interval '3 days',
      '[{"quantity":1,"unit_code":"M3","concrete_type":"QA115"}]','QA115-INVALID',null,array['UNKNOWN']);
    raise exception 'QA115_INVALID_MODE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_DELIVERY_MODES_INVALID' then raise; end if; end;
  execute 'reset role';
  if exists(select 1 from public.programming where project_id=v_project and order_number='QA115-INVALID') then
    raise exception 'QA115_INVALID_MODE_NOT_ATOMIC'; end if;
  raise notice 'PASS: manual create/edit snapshots and re-confirmation preserved, invalid modes rejected atomically';

  for v_i in 0..8 loop
    v_modes := case when v_i in (0,1,5,6,8) then array['DIRECT']
      when v_i in (2,7) then array['PUMP'] when v_i=4 then array['DIRECT','PUMP']
      else '{}'::text[] end;
    execute 'set local role authenticated';
    v_result := public.create_programming_batch(v_project,jsonb_build_array(jsonb_build_object(
      'supplier_id',v_supplier,'scheduled_at',v_schedule,'order_number','QA115-'||v_i||'-'||gen_random_uuid(),
      'delivery_modes',to_jsonb(v_modes),'lines',jsonb_build_array(jsonb_build_object(
        'quantity',1,'unit_code','M3','concrete_type','QA115')))));
    v_programming := (v_result->'programming_ids'->>0)::uuid;
    v_dispatch := public.start_dispatch(v_programming,v_schedule,'QA115');
    execute 'reset role';
    -- Financial fixture: valid completed shape, normal table triggers remain on.
    -- Operational finalization/evidence rules are not changed or tested here.
    update public.dispatches set status='COMPLETED',result='DISPATCHED',real_volume=1,
      real_unit_code='M3',order_number=(select order_number from public.programming where id=v_programming),
      completed_at=now(),completed_by=v_actor where id=v_dispatch;
    execute 'set local role authenticated';
    perform public.add_dispatch_to_batch(v_batch,v_dispatch);
    execute 'reset role';
    v_dispatches := array_append(v_dispatches,v_dispatch);
    v_programmings := array_append(v_programmings,v_programming);
    if (select delivery_modes from public.programming where id=v_programming) <> v_modes
      or (select delivery_modes from public.programming_revisions where programming_id=v_programming
        order by revision_no desc limit 1) <> v_modes then raise exception 'QA115_MODES_NOT_PERSISTED'; end if;
    if v_i<>6 then
      perform pg_temp.qa115_invoice(v_dispatch,'PRODUCT',v_actor,case when v_i=5 then 2 else 1 end);
    end if;
    if v_i in (6,7,8) then
      v_invoice := pg_temp.qa115_invoice(v_dispatch,'SERVICE',v_actor,1,v_i=8);
    end if;
    if v_i not in (0,6) then
      execute 'set local role authenticated';
      v_state := public.reconcile_dispatch(v_dispatch);
      execute 'reset role';
      if v_state::text <> (case when v_i=5 then 'WITH_DIFFERENCES' else 'RECONCILED' end) then
        raise exception 'QA115_RECONCILIATION_UNEXPECTED:%:%',v_i,v_state;
      end if;
    end if;
    if app_private.dispatch_billing_complete(v_dispatch) <> (v_i in (1,7)) then
      raise exception 'QA115_COMPLETION_POLICY_FAILED:%',v_i;
    end if;
    if (select status='COMPLETED' from public.programming where id=v_programming) <> (v_i in (1,7)) then
      raise exception 'QA115_AUTO_CLOSE_FAILED:%',v_i;
    end if;
  end loop;
  raise notice 'PASS: real reconcile RPC; exclusive DIRECT closes without Service; pump/unknown/multiple modes require Service; both invoices alone never replace Product reconciliation';

  begin
    update public.programming set status='COMPLETED' where id=v_programmings[1];
    raise exception 'QA115_MANUAL_CLOSE_BYPASSED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_BILLING_INCOMPLETE' then raise; end if; end;
  begin
    update public.programming set delivery_modes=array['PUMP'] where id=v_programmings[1];
    raise exception 'QA115_STARTED_MODE_EDIT_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_DELIVERY_MODES_LOCKED' then raise; end if; end;
  -- Optional Service may arrive after Programming closes, while its batch is OPEN.
  perform pg_temp.qa115_invoice(v_dispatches[2],'SERVICE',v_actor,1);
  if (select status from public.programming where id=v_programmings[2]) <> 'COMPLETED'
    or not app_private.dispatch_billing_complete(v_dispatches[2]) then raise exception 'QA115_OPTIONAL_SERVICE_BLOCKED'; end if;
  raise notice 'PASS: manual close cannot bypass reconciliation; started modes locked; optional Service accepted in OPEN batch';

  -- Fiscal exception still blocks completion, even when Service is optional.
  select id into strict v_exception from public.invoice_recipient_exceptions where dispatch_id=v_dispatches[9];
  update public.invoice_recipient_exceptions set status='APPROVED',decided_by=v_actor,decided_at=now() where id=v_exception;
  perform app_private.refresh_dispatch_reconciliation(v_dispatches[9]);
  if (select status from public.programming where id=v_programmings[9]) <> 'COMPLETED' then
    raise exception 'QA115_FISCAL_RESOLUTION_NOT_REEVALUATED'; end if;
  raise notice 'PASS: pending fiscal exception blocks, approved decision re-evaluates completion';

  execute 'set local role authenticated';
  select count(*) into v_count from public.preview_weekly_batch_rollover(v_batch) where rollover_action='MOVE';
  if v_count<>6 then raise exception 'QA115_PREVIEW_MISMATCH:%',v_count; end if;
  v_destination := public.rollover_weekly_batch(v_batch);
  execute 'reset role';
  for v_i in 1..9 loop
    if not exists(select 1 from public.batch_dispatches where dispatch_id=v_dispatches[v_i]
      and removed_at is null and batch_id=case when v_i in (2,8,9) then v_batch else v_destination end) then
      raise exception 'QA115_ROLLOVER_MISMATCH:%',v_i; end if;
  end loop;
  if (select status from public.programming where id=v_programmings[1])<>'IN_EXECUTION' then
    raise exception 'QA115_ROLLOVER_CLOSED_PENDING_PROGRAMMING'; end if;
  begin
    insert into public.invoices(project_id,dispatch_id,supplier_id,invoice_type,invoice_number,
      invoice_date,total,created_by) values(v_project,v_dispatches[2],v_supplier,'SERVICE',
      'QA115-CLOSED',v_today,1,v_actor);
    raise exception 'QA115_CLOSED_BATCH_UPLOAD_ALLOWED';
  exception when raise_exception then if sqlerrm<>'INVOICE_BATCH_CONTEXT_INVALID' then raise; end if; end;
  raise notice 'PASS: preview and rollover agree; pending Product or required Service moves, completed stays, closed batch rejects invoices';

  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  execute 'set local role authenticated';
  begin
    perform public.preview_weekly_batch_rollover(v_batch);
    raise exception 'QA115_UNAUTHORIZED_READ_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  begin
    perform public.create_programming_with_details(v_project,v_supplier,v_schedule,
      '[{"quantity":1,"unit_code":"M3","concrete_type":"QA115"}]','QA115-DENIED',null,array['DIRECT']);
    raise exception 'QA115_UNAUTHORIZED_CREATE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED' then raise; end if; end;
  execute 'reset role';
  raise notice 'PASS: unauthorized project read/create rejected';
end;
$$;
rollback;
