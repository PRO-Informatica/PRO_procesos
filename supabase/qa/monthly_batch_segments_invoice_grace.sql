-- DEV only. Fixture memberships/invoices and audit events ALL roll back.
-- Calendar/grace tests use explicit dates, never override the server clock.
begin;
do $$
declare
  v_dispatch public.dispatches%rowtype;
  v_actor uuid;
  v_project uuid;
  v_prefix text := 'QA-114-' || gen_random_uuid()::text;
  v_result jsonb;
  v_first uuid;
  v_second uuid;
  v_destination uuid;
  v_source uuid;
  v_period record;
  v_invoice uuid;
  v_document uuid;
  v_upload record;
  v_job uuid;
  v_extraction uuid;
  v_snapshot jsonb;
begin
  select dispatch.* into strict v_dispatch from public.dispatches dispatch
  join public.projects project on project.id = dispatch.project_id and project.status = 'ACTIVE'
  join public.platform_admins admin on admin.user_id = dispatch.created_by and admin.active
  where dispatch.status = 'IN_EXECUTION'
    and not exists (select 1 from public.batch_dispatches r where r.dispatch_id=dispatch.id and r.removed_at is null)
  order by dispatch.created_at desc limit 1;
  v_actor := v_dispatch.created_by;
  v_project := v_dispatch.project_id;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);

  select * into v_period from app_private.resolve_weekly_batch_period(v_project,'2028-10-31');
  if v_period.period_start <> date '2028-10-30' or v_period.period_end <> date '2028-10-31'
    or v_period.accounting_period <> date '2028-10-01' then raise exception 'QA_OCTOBER_SEGMENT_FAILED'; end if;
  select * into v_period from app_private.resolve_weekly_batch_period(v_project,'2028-11-02');
  if v_period.period_start <> date '2028-11-01' or v_period.period_end <> date '2028-11-05'
    or v_period.accounting_period <> date '2028-11-01' then raise exception 'QA_NOVEMBER_SEGMENT_FAILED'; end if;
  if app_private.fifth_business_day('2028-11-01') <> date '2028-11-07'
    or app_private.fifth_business_day('2026-11-01') <> date '2026-11-06'
    or not app_private.invoice_period_valid('2028-10-30','2028-11-01','2028-11-02')
    or not app_private.invoice_period_valid('2028-10-30','2028-11-01','2028-11-07')
    or app_private.invoice_period_valid('2028-10-30','2028-11-01','2028-11-08')
    or app_private.invoice_period_valid('2028-09-30','2028-11-01','2028-11-02')
    or app_private.invoice_period_valid('2028-12-01','2028-11-01','2028-11-02') then
    raise exception 'QA_FIVE_BUSINESS_DAYS_FAILED';
  end if;
  raise notice 'PASS: month-end segmentation and five business days, inclusive, excluding weekends';

  execute 'set local role authenticated';
  v_result := public.create_weekly_batches(v_project, v_prefix, '2028-11-02');
  execute 'reset role';
  v_first := (v_result->'batch_ids'->>0)::uuid;
  v_second := (v_result->'batch_ids'->>1)::uuid;
  if jsonb_array_length(v_result->'batch_ids') <> 2 or (v_result->>'batch_id')::uuid <> v_second
    or (select period_end from public.batches where id=v_first) <> date '2028-10-31'
    or (select period_start from public.batches where id=v_second) <> date '2028-11-01' then
    raise exception 'QA_ATOMIC_PAIR_FAILED';
  end if;
  execute 'set local role authenticated';
  begin
    perform public.create_weekly_batches(v_project,v_prefix||'-repeat','2028-10-30');
    raise exception 'QA_DUPLICATE_WEEK_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'BATCH_WEEK_OR_CODE_ALREADY_EXISTS' then raise; end if; end;
  begin
    perform public.create_batch(v_project,v_prefix||'-mixed','2028-10-30','2028-11-05');
    raise exception 'QA_MIXED_MONTH_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'BATCH_MONTH_SEGMENT_INVALID' then raise; end if; end;
  perform public.add_dispatch_to_batch(v_first,v_dispatch.id);
  v_destination := public.rollover_weekly_batch(v_first);
  execute 'reset role';
  if v_destination <> v_second or (select status from public.batches where id=v_first) <> 'CLOSED'
    or not exists(select 1 from public.batch_dispatches where batch_id=v_second and dispatch_id=v_dispatch.id and removed_at is null)
    or not exists(select 1 from public.batch_dispatches where batch_id=v_first and dispatch_id=v_dispatch.id and removed_at is not null and rolled_to_batch_id=v_second)
    or (select status from public.dispatches where id=v_dispatch.id) <> v_dispatch.status then
    raise exception 'QA_MONTH_ROLLOVER_CHANGED_DISPATCH';
  end if;
  raise notice 'PASS: authenticated paired creation, duplicate/mixed-month rejection, pending dispatch moves without finalizing';

  -- Deliberately collide on the SECOND code: the first insert must roll back.
  execute 'set local role authenticated';
  perform public.create_batch(v_project,v_prefix||'-collision-2029-02','2029-02-05','2029-02-11');
  begin
    perform public.create_weekly_batches(v_project,v_prefix||'-collision','2029-01-31');
    raise exception 'QA_SECOND_CODE_COLLISION_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'BATCH_WEEK_OR_CODE_ALREADY_EXISTS' then raise; end if; end;
  execute 'reset role';
  if exists(select 1 from public.batches where project_id=v_project and period_start='2029-01-29') then
    raise exception 'QA_PARTIAL_PAIR_PERSISTED';
  end if;
  raise notice 'PASS: failed second batch rolls back the first batch and its audit';

  v_source := app_private.ensure_batch_month_segment(v_project,'2030-06-10');
  select * into v_period from app_private.resolve_weekly_batch_period(v_project,'2030-06-10');
  v_destination := app_private.ensure_batch_month_segment(v_project,v_period.period_end+1);
  update public.batches set status='CLOSED' where id=v_destination;
  execute 'set local role authenticated';
  begin
    perform public.rollover_weekly_batch(v_source);
    raise exception 'QA_CLOSED_DESTINATION_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'BATCH_DESTINATION_CLOSED' then raise; end if; end;
  execute 'reset role';
  if (select status from public.batches where id=v_source) <> 'OPEN' then raise exception 'QA_PARTIAL_ROLLOVER'; end if;
  raise notice 'PASS: cannot move pending work into a closed destination';

  -- Invoice guards and persisted, unforgeable successful-receipt snapshot.
  execute 'set local role authenticated';
  perform public.remove_dispatch_from_batch(v_second,v_dispatch.id,'QA rollback-only fixture');
  execute 'reset role';
  select * into v_period from app_private.resolve_weekly_batch_period(v_project,null);
  v_source := app_private.ensure_batch_month_segment(v_project,v_period.reference_date);
  execute 'set local role authenticated';
  perform public.add_dispatch_to_batch(v_source,v_dispatch.id);
  execute 'reset role';
  insert into public.invoices(project_id,dispatch_id,supplier_id,invoice_type,invoice_number,
    invoice_date,order_number,subtotal,total,currency,status,created_by)
  values(v_project,v_dispatch.id,v_dispatch.supplier_id,'PRODUCT',v_prefix,
    v_period.reference_date,v_dispatch.order_number,100,100,'GTQ','REGISTERED',v_actor) returning id into v_invoice;
  insert into public.documents(project_id,category,created_by) values(v_project,'INVOICE',v_actor) returning id into v_document;
  select * into v_upload from app_private.prepare_document_upload_version(v_document,v_project,v_actor,'qa-114.pdf','application/pdf',100);
  insert into public.document_processing_jobs(document_version_id,status,provider_key,attempt_count)
    values(v_upload.version_id,'PENDING','QA_114',1) returning id into v_job;
  insert into public.invoice_extractions(processing_job_id,invoice_id,raw_payload,normalized_payload,processed_by)
  values(v_job,v_invoice,'{}',jsonb_build_object('invoice_date',v_period.reference_date,
    'validations',jsonb_build_object('period_valid',false),'period_validation',jsonb_build_object('received_at','1900-01-01')),v_actor)
  returning id,normalized_payload->'period_validation' into v_extraction,v_snapshot;
  if not (select (normalized_payload->'validations'->>'period_valid')::boolean from public.invoice_extractions where id=v_extraction)
    or (v_snapshot->>'received_date')::date <> v_period.reference_date
    or v_snapshot->>'policy' <> 'FIVE_BUSINESS_DAYS_V1' then raise exception 'QA_RECEIPT_SNAPSHOT_FAILED'; end if;
  update public.invoice_extractions set normalized_payload=jsonb_build_object(
    'invoice_date',v_period.reference_date,'validations',jsonb_build_object('period_valid',false),
    'period_validation',jsonb_build_object('received_at','1900-01-01')) where id=v_extraction;
  if (select normalized_payload->'period_validation' from public.invoice_extractions where id=v_extraction) <> v_snapshot
    or not (select (normalized_payload->'validations'->>'period_valid')::boolean from public.invoice_extractions where id=v_extraction) then
    raise exception 'QA_SNAPSHOT_FORGED';
  end if;
  begin
    insert into public.invoices(project_id,dispatch_id,supplier_id,invoice_type,invoice_number,
      invoice_date,order_number,subtotal,total,currency,status,created_by)
    values(v_project,v_dispatch.id,v_dispatch.supplier_id,'SERVICE',v_prefix||'-expired',
      v_period.accounting_period-interval '2 months',v_dispatch.order_number,100,100,'GTQ','REGISTERED',v_actor);
    raise exception 'QA_EXPIRED_INVOICE_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'INVOICE_ACCOUNTING_PERIOD_MISMATCH' then raise; end if; end;
  raise notice 'PASS: DB rejects old months; snapshot overwrites forged flags/timestamps and survives later corrections';

  -- Create a genuinely overdue OPEN week to exercise the new-creation guard.
  v_destination := app_private.ensure_batch_month_segment(v_project,v_period.reference_date-35);
  execute 'set local role authenticated';
  begin
    perform public.create_weekly_batches(v_project,v_prefix||'-blocked','2031-04-15');
    raise exception 'QA_OVERDUE_OPEN_WEEK_IGNORED';
  exception when raise_exception then if sqlerrm <> 'BATCH_OVERDUE_OPEN_EXISTS' then raise; end if; end;
  execute 'reset role';
  if exists(select 1 from public.batches where code like v_prefix||'-blocked%') then raise exception 'QA_BLOCKED_PAIR_PERSISTED'; end if;
  raise notice 'PASS: overdue OPEN week blocks new manual batches atomically';

  loop
    select id into v_source from public.batches where project_id=v_project and status='OPEN'
      and date_trunc('week',period_start)::date+6 < v_period.reference_date
    order by period_start limit 1;
    exit when not found;
    execute 'set local role authenticated';
    perform public.rollover_weekly_batch(v_source);
    execute 'reset role';
  end loop;
  execute 'set local role authenticated';
  perform public.create_weekly_batches(v_project,v_prefix||'-unblocked','2031-04-15');
  execute 'reset role';
  raise notice 'PASS: manual closing of overdue periods unblocks creation without auto-closing current work';

  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  execute 'set local role authenticated';
  begin
    perform public.create_weekly_batches(v_project,v_prefix||'-forbidden','2031-05-01');
    raise exception 'QA_UNAUTHORIZED_CREATE_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'PERMISSION_DENIED' then raise; end if; end;
  execute 'reset role';
  raise notice 'PASS: a direct RPC with a user lacking project permission is rejected';

  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role authenticated';
  begin
    perform public.create_weekly_batches(v_project,v_prefix||'-unauthorized','2031-05-01');
    raise exception 'QA_UNAUTHENTICATED_CREATE_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'AUTH_REQUIRED' then raise; end if; end;
  execute 'reset role';
  raise notice 'PASS: direct authenticated-role RPC without a user is rejected';
end;
$$;
rollback;
