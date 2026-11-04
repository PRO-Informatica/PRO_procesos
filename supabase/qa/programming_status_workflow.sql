-- DEV only. Synthetic Programming/Dispatch/Invoice/Document metadata fixtures;
-- no Storage upload, email, trigger disabling or persistent business changes.
-- Run after 134; the entire test, including its helpers and audits, rolls back.
begin;

create function pg_temp.qa134_invoice(p_dispatch uuid, p_type public.invoice_type,
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
  values(v_dispatch.project_id,p_dispatch,v_dispatch.supplier_id,p_type,'QA134-'||gen_random_uuid(),
    v_date,v_dispatch.order_number,100,100,'GTQ','REGISTERED',p_actor) returning id into v_invoice;
  insert into public.documents(project_id,category,created_by)
    values(v_dispatch.project_id,'INVOICE',p_actor) returning id into v_document;
  select * into v_upload from app_private.prepare_document_upload_version(
    v_document,v_dispatch.project_id,p_actor,'qa-134.pdf','application/pdf',100);
  insert into public.document_processing_jobs(document_version_id,status,provider_key,attempt_count)
    values(v_upload.version_id,'PENDING','QA_134',1) returning id into v_job;
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
  v_schedule timestamptz; v_batch uuid; v_program uuid; v_manual uuid; v_dispatch uuid;
  v_product uuid; v_reference text; v_lines jsonb; v_result jsonb; v_version integer;
  v_invoice uuid; v_reconciliation public.dispatch_reconciliation_status; v_i integer;
  candidate record;
begin
  -- Find an existing authorized operator, without assigning or changing roles.
  for candidate in
    select p.id,r.supplier_id,coalesce(nullif(p.timezone,''),'America/Guatemala') timezone,actor.id actor_id
    from public.projects p join public.companies c on c.id=p.company_id and c.status='ACTIVE'
    join public.project_suppliers r on r.project_id=p.id and r.active
    join public.suppliers s on s.id=r.supplier_id and s.active
    cross join public.profiles actor
    where p.status='ACTIVE' and actor.active
      and exists(select 1 from public.project_product_prices price where price.project_id=p.id)
    order by p.id,actor.id
  loop
    perform set_config('request.jwt.claim.sub',candidate.actor_id::text,true);
    if app_private.has_project_permission(candidate.id,'programming.create')
      and app_private.has_project_permission(candidate.id,'programming.modify')
      and app_private.has_project_permission(candidate.id,'programming.close')
      and app_private.has_project_permission(candidate.id,'dispatch.create')
      and app_private.has_project_permission(candidate.id,'dispatch.modify')
      and app_private.has_project_permission(candidate.id,'invoice.match')
      and app_private.has_project_permission(candidate.id,'batch.modify') then
      v_project:=candidate.id;v_supplier:=candidate.supplier_id;
      v_actor:=candidate.actor_id;v_timezone:=candidate.timezone;exit;
    end if;
  end loop;
  if v_actor is null then raise exception 'QA134_OPERATIONAL_ACTOR_REQUIRED';end if;
  v_today:=(clock_timestamp() at time zone v_timezone)::date;
  v_schedule:=(v_today+time '10:00')at time zone v_timezone;
  select id,reference into strict v_product,v_reference from public.project_product_prices where project_id=v_project order by id limit 1;
  v_lines:=jsonb_build_array(jsonb_build_object('quantity',7,'unit_code','M3','concrete_type',v_reference));
  execute 'set local role authenticated';
  -- Even if today's clock time passed, creation is atomically confirmed.
  v_manual:=public.create_programming_with_details(v_project,v_supplier,
    (v_today+time '00:00')at time zone v_timezone,v_lines,'QA134-MANUAL-'||gen_random_uuid(),null,array['DIRECT']);
  execute 'reset role';
  if not exists(select 1 from public.programming where id=v_manual and status='CONFIRMED'
    and confirmed_quantity=7 and confirmed_by=v_actor and confirmed_at is not null and version=1)
    or not exists(select 1 from public.programming_revisions where programming_id=v_manual and status='CONFIRMED' and programming_version=1)
    then raise exception 'QA134_CREATION_NOT_CONFIRMED';end if;
  execute 'set local role authenticated';
  begin
    perform public.update_programming_with_details(v_manual,1,v_supplier,v_schedule,v_lines,'QA134','');
    raise exception 'QA134_EMPTY_REASON_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_EDIT_REASON_REQUIRED' then raise;end if;end;
  v_version:=public.update_programming_with_details(v_manual,1,v_supplier,v_schedule,v_lines,'QA134-EDIT','QA correction',null,array['PUMP']);
  begin
    perform public.update_programming_with_details(v_manual,1,v_supplier,v_schedule,v_lines,'QA134','QA stale');
    raise exception 'QA134_STALE_VERSION_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'PROGRAMMING_VERSION_CONFLICT' then raise;end if;end;
  execute 'reset role';
  if v_version<>2 or not exists(select 1 from public.programming where id=v_manual and status='CONFIRMED' and confirmed_quantity=7 and version=2)
    or not exists(select 1 from public.programming_revisions where programming_id=v_manual and programming_version=2 and status='CONFIRMED' and change_reason='QA correction')
    then raise exception 'QA134_EDIT_NOT_CONFIRMED';end if;
  raise notice 'PASS: manual create/edit automatically confirmed; reason, version, metadata and snapshots preserved';

  v_batch:=app_private.ensure_batch_month_segment(v_project,v_today);
  for v_i in 0..2 loop
    execute 'set local role authenticated';
    v_result:=public.create_programming_batch(v_project,jsonb_build_array(jsonb_build_object(
      'supplier_id',v_supplier,'scheduled_at',v_schedule,'order_number','QA134-'||gen_random_uuid(),
      'delivery_modes',case when v_i=1 then jsonb_build_array('PUMP')else jsonb_build_array('DIRECT')end,'lines',v_lines)));
    v_program:=(v_result->'programming_ids'->>0)::uuid;
    execute 'reset role';
    if not exists(select 1 from public.programming where id=v_program and status='CONFIRMED' and version=1)
      or (select count(*)from public.programming_revisions where programming_id=v_program)<>1 then
      raise exception 'QA134_BULK_DOUBLE_CONFIRMATION';end if;
    execute 'set local role authenticated';
    v_dispatch:=public.start_dispatch(v_program,v_schedule,'QA134 receiver');
    execute 'reset role';
    if (select status from public.programming where id=v_program)<>'IN_EXECUTION' then raise exception 'QA134_START_STATE';end if;
    execute 'set local role authenticated';
    v_result:=public.create_dispatch_guide_with_lines(v_dispatch,1,'QA134-'||gen_random_uuid(),v_today,
      jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',7,'unit_code','M3')),time '07:00',time '08:00');
    execute 'reset role';
    -- Valid completed fixture, real triggers enabled; no operational evidence files.
    update public.dispatches set status='COMPLETED',result='DISPATCHED',real_volume=7,
      real_unit_code='M3',completed_at=now(),completed_by=v_actor where id=v_dispatch;
    if (select status from public.programming where id=v_program)<>'DISPATCH_COMPLETED'
      or(select status from public.dispatches where id=v_dispatch)<>'COMPLETED'
      or not exists(select 1 from public.programming_revisions where programming_id=v_program and action='PROGRAMMING_DISPATCH_COMPLETED')
      then raise exception 'QA134_OPERATIONAL_COMPLETION_STATE';end if;
    select version into v_version from public.programming where id=v_program;
    execute 'set local role authenticated';
    begin
      perform public.close_programming(v_program,v_version,'QA cannot bypass billing');
      raise exception 'QA134_PREMATURE_FINANCIAL_CLOSE';
    exception when raise_exception then if sqlerrm<>'PROGRAMMING_BILLING_INCOMPLETE' then raise;end if;end;
    begin
      perform public.update_programming_with_details(v_program,v_version,v_supplier,v_schedule,v_lines,'QA','QA forbidden');
      raise exception 'QA134_STARTED_PROGRAM_EDITABLE';
    exception when raise_exception then if sqlerrm not in('PROGRAMMING_NOT_EDITABLE','PROGRAMMING_EDIT_HAS_DISPATCHES')then raise;end if;end;
    perform public.add_dispatch_to_batch(v_batch,v_dispatch);
    execute 'reset role';
    v_invoice:=pg_temp.qa134_invoice(v_dispatch,'PRODUCT',v_actor,case when v_i=2 then 8 else 7 end);
    execute 'set local role authenticated';
    v_reconciliation:=public.reconcile_dispatch(v_dispatch);
    execute 'reset role';
    if v_reconciliation::text<>(case when v_i=2 then 'WITH_DIFFERENCES'else 'RECONCILED'end)then raise exception 'QA134_PRODUCT_POLICY';end if;
    if v_i=1 then
      if (select status from public.programming where id=v_program)<>'DISPATCH_COMPLETED' then raise exception 'QA134_REQUIRED_SERVICE_MISSING';end if;
      v_invoice:=pg_temp.qa134_invoice(v_dispatch,'SERVICE',v_actor,1);
    end if;
    if (select status::text from public.programming where id=v_program)<>
      (case when v_i=2 then 'DISPATCH_COMPLETED'else 'COMPLETED'end)then raise exception 'QA134_FINANCIAL_STATE:%',v_i;end if;
    select version into v_version from public.programming where id=v_program;
    perform app_private.refresh_dispatch_reconciliation(v_dispatch);
    if (select version from public.programming where id=v_program)<>v_version then raise exception 'QA134_DUPLICATE_HISTORY';end if;
  end loop;
  raise notice 'PASS: bulk confirmation is atomic; execution -> dispatch completed -> financially completed; Product differences/required Service preserve pending closure';
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  execute 'set local role authenticated';
  begin
    perform public.create_programming_with_details(v_project,v_supplier,v_schedule,v_lines,'QA134 DENIED');
    raise exception 'QA134_UNAUTHORIZED_CREATE';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED'then raise;end if;end;
  execute 'reset role';
  raise notice 'PASS: project permission checks preserved; all synthetic fixtures rolled back';
end;
$$;
rollback;
