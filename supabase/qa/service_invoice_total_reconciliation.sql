-- DEV only: real invoice preparation, processing, reconciliation and replacement.
-- Current completion policy (143): required Service differences must roll over.
-- PDF upload metadata is synthetic; no files are written. Everything rolls back.
begin;
create function pg_temp.qa_invoice(p_batch uuid,p_dispatch uuid,p_type public.invoice_type,p_total numeric,p_previous uuid default null,p_currency text default 'GTQ')returns uuid
language plpgsql security definer set search_path=pg_catalog,public,app_private,pg_temp as $$
declare v_payload jsonb;v_row record;v_tax text;v_number text:=gen_random_uuid()::text;v_order text;v_date date;
begin
 select regexp_replace(coalesce(s.tax_id,'1234567'),'[^A-Za-z0-9]','','g'),d.order_number into v_tax,v_order from public.dispatches d join public.suppliers s on s.id=d.supplier_id where d.id=p_dispatch;
 select accounting_period into v_date from public.batches where id=p_batch;
 v_payload:=jsonb_build_object('invoice_number',v_number,'invoice_date',v_date,'currency',p_currency,'subtotal',p_total,'total',p_total,
 'detected_type',p_type::text,'supplier_tax_id',v_tax,'authorization_number',v_number,'fiscal_document_key',upper(v_tax)||':AUTH:'||upper(replace(v_number,'-','')),
 'file_sha256',md5(v_number)||md5(v_number),'pca_original','PCA-01012060-0147','detected_order_number',v_order,'invoiced_quantity',7,'normalized_unit','M3',
 'validations',jsonb_build_object('document_valid',true,'type_valid',true,'project_valid',true,'supplier_valid',true,'order_valid',true,'period_valid',true),
 'lines',jsonb_build_array(jsonb_build_object('quantity',7,'unit_code','M3','code',case when p_type='PRODUCT'then '86131064'else 'SERV0250'end,'description','QA line')));
 select *into v_row from public.prepare_dispatch_invoice_upload_v2(p_batch,p_dispatch,p_type,v_payload,'qa.pdf',100,p_previous);
 update public.document_versions set upload_status='UPLOADED',uploaded_at=now()where id=v_row.version_id;
 perform public.complete_dispatch_invoice_processing(v_row.invoice_id,v_row.version_id,v_payload);
 return v_row.invoice_id;
end;
$$;
do $$
declare
  v_project uuid; v_supplier uuid; v_actor uuid; v_other uuid; v_timezone text;
  v_today date; v_past timestamptz; v_lines jsonb; v_item jsonb;
  v_result jsonb; v_dispatch uuid; v_program uuid; v_product uuid; v_reference text;
  v_version integer; v_document uuid; v_service uuid; v_unit text; v_guide uuid; v_batch uuid; v_invoice uuid; v_new uuid; v_product_invoice uuid; v_total numeric; v_status text; v_program_status text; v_program_version integer; candidate record;
begin
  -- Use actual operational roles; being a platform admin alone grants no
  -- programming/dispatch permissions. Never grant roles for this test.
  for candidate in
    select p.id, r.supplier_id, coalesce(nullif(p.timezone,''),'America/Guatemala') timezone, actor.id actor_id
    from public.projects p join public.companies c on c.id=p.company_id and c.status='ACTIVE'
    join public.project_suppliers r on r.project_id=p.id and r.active
    join public.suppliers s on s.id=r.supplier_id and s.company_id=r.company_id and s.active
    cross join public.profiles actor
    where p.status='ACTIVE' and actor.active and exists(select 1 from public.project_product_prices price where price.project_id=p.id) order by p.id,actor.id
  loop
    perform set_config('request.jwt.claim.sub',candidate.actor_id::text,true);
    if app_private.has_project_permission(candidate.id,'programming.create')
       and app_private.has_project_permission(candidate.id,'programming.confirm')
       and app_private.has_project_permission(candidate.id,'dispatch.create')
       and app_private.has_project_permission(candidate.id,'dispatch.modify')
       and app_private.has_project_permission(candidate.id,'invoice.create')
       and app_private.has_project_permission(candidate.id,'invoice.match')
       and app_private.has_project_permission(candidate.id,'invoice.review')
       and app_private.has_project_permission(candidate.id,'batch.view')
       and exists(select 1 from public.project_service_prices where project_id=candidate.id) then
      v_project:=candidate.id; v_supplier:=candidate.supplier_id;
      v_timezone:=candidate.timezone; v_actor:=candidate.actor_id;
      exit;
    end if;
  end loop;
  if v_actor is null then raise exception 'QA_OPERATIONAL_ACTOR_REQUIRED'; end if;
  v_today := (clock_timestamp() at time zone v_timezone)::date;
  v_today:=v_today+12000;
  v_past := (v_today+time '07:00') at time zone v_timezone;
  select id,reference into strict v_product,v_reference from public.project_product_prices where project_id=v_project order by id limit 1;
  v_lines := jsonb_build_array(jsonb_build_object('quantity',7,'unit_code','M3','concrete_type',v_reference));
  v_item := jsonb_build_object('supplier_id',v_supplier,'scheduled_at',v_past,
    'order_number','QA-validator-'||gen_random_uuid()::text,'lines',v_lines,'delivery_modes',jsonb_build_array('PUMP'));
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  execute 'set local role authenticated';
  v_result:=public.create_programming_batch(v_project,jsonb_build_array(v_item));
  v_program:=(v_result->'programming_ids'->>0)::uuid;
  execute 'reset role';
  v_batch:=app_private.ensure_batch_month_segment(v_project,v_today);
  select id,coalesce(unit_code,'UN')into v_service,v_unit from public.project_service_prices where project_id=v_project order by id limit 1;
  update public.project_service_prices set price=25.125 where id=v_service;
  execute 'set local role authenticated';
  v_dispatch:=public.start_dispatch(v_program,v_past,'QA monetary service');
  v_lines:=jsonb_build_array(jsonb_build_object('catalog_type','PRODUCT','catalog_item_id',v_product,'quantity',7,'unit_code','M3'),jsonb_build_object('catalog_type','SERVICE','catalog_item_id',v_service,'quantity',2,'unit_code',v_unit));
  v_result:=public.create_dispatch_guide_with_lines(v_dispatch,1,'QA-service-money',v_today,v_lines,time '07:00',time '08:00');
  v_guide:=(v_result->>'guide_id')::uuid;v_version:=(v_result->>'dispatch_version')::integer;
  v_version:=public.update_dispatch(v_dispatch,v_version,v_past,null,'QA monetary service','DISPATCHED',v_item->>'order_number',7,'M3');
  execute 'reset role';
  insert into public.documents(project_id,category,created_by)values(v_project,'DISPATCH_EVIDENCE',v_actor)returning id into v_document;
  insert into public.dispatch_documents(project_id,dispatch_id,document_id,purpose)values(v_project,v_dispatch,v_document,'DISPATCH_EVIDENCE');
  insert into public.document_versions(document_id,version,storage_bucket,storage_path,file_name,mime_type,upload_status,uploaded_at,is_current,uploaded_by)
    values(v_document,1,'private-documents','qa-only/'||v_document::text,'qa.pdf','application/pdf','UPLOADED',now(),true,v_actor);
  execute 'set local role authenticated';
  v_version:=public.complete_dispatch(v_dispatch,v_version);
  execute 'reset role';
  insert into public.batch_dispatches(batch_id,project_id,dispatch_id,added_by,assignment_source)values(v_batch,v_project,v_dispatch,v_actor,'USER');
  execute 'set local role authenticated';
  v_product_invoice:=pg_temp.qa_invoice(v_batch,v_dispatch,'PRODUCT',100);
  perform public.reconcile_dispatch(v_dispatch);
  v_invoice:=pg_temp.qa_invoice(v_batch,v_dispatch,'SERVICE',50.26);
  execute 'reset role';
  select status::text,version into v_program_status,v_program_version from public.programming where id=v_program;
  -- Changing the live catalogue does not change the guide's historical estimate.
  update public.project_service_prices set price=999 where id=v_service;
  execute 'set local role authenticated';
  v_status:=public.reconcile_dispatch_service(v_dispatch)::text;
  execute 'reset role';
  if v_status<>'WITH_DIFFERENCES'or not exists(select 1 from public.dispatch_reconciliations where dispatch_id=v_dispatch and status='RECONCILED'and service_status='WITH_DIFFERENCES'and(service_comparison->>'estimated_total')::numeric=50.25 and(service_comparison->>'invoice_total')::numeric=50.26 and(service_comparison->>'difference')::numeric=0.01)then raise exception 'QA_CENT_DIFFERENCE_OR_SNAPSHOT_FAILED';end if;
  if not exists(select 1 from public.programming where id=v_program and status::text=v_program_status and version=v_program_version)then raise exception 'QA_SERVICE_CHANGED_PROGRAMMING';end if;
  if not exists(select 1 from public.preview_weekly_batch_rollover(v_batch)where dispatch_id=v_dispatch and rollover_action='MOVE')then raise exception 'QA_REQUIRED_SERVICE_NOT_MOVED';end if;
  execute 'set local role authenticated';
  begin
    perform pg_temp.qa_invoice(v_batch,v_dispatch,'SERVICE',50.25,v_invoice);
    raise exception 'QA_REPLACED_WITHOUT_REQUEST';
  exception when raise_exception then if sqlerrm<>'SERVICE_REINVOICING_CONTEXT_INVALID'then raise;end if;end;
  perform public.request_dispatch_service_reinvoicing(v_dispatch,'QA total difference');
  execute 'reset role';
  if not exists(select 1 from public.dispatch_reconciliations where dispatch_id=v_dispatch and status='RECONCILED'and service_status='PENDING_REINVOICING')then raise exception 'QA_PRODUCT_STATE_CHANGED';end if;
  execute 'set local role authenticated';
  v_new:=pg_temp.qa_invoice(v_batch,v_dispatch,'SERVICE',50.25,v_invoice);
  v_status:=public.reconcile_dispatch_service(v_dispatch)::text;
  execute 'reset role';
  if v_status<>'RECONCILED'or not exists(select 1 from public.invoices where id=v_invoice and status='SUPERSEDED')or not exists(select 1 from public.invoices where id=v_new and replaces_invoice_id=v_invoice)then raise exception 'QA_SERVICE_REPLACEMENT_FAILED';end if;
  if not exists(select 1 from public.dispatch_reconciliations where dispatch_id=v_dispatch and current_service_invoice_id=v_new and current_product_invoice_id=v_product_invoice and status='RECONCILED'and(service_comparison->>'difference')::numeric=0)then raise exception 'QA_REPLACEMENT_POINTER_OR_TOTAL_FAILED';end if;
  -- A cross-type replacement cannot consume the Product slot or its invoice.
  execute 'set local role authenticated';
  begin
    perform pg_temp.qa_invoice(v_batch,v_dispatch,'SERVICE',50.25,v_product_invoice);
    raise exception 'QA_CROSS_TYPE_REPLACEMENT_ALLOWED';
  exception when raise_exception then if sqlerrm<>'REPLACED_INVOICE_CONTEXT_INVALID'then raise;end if;end;
  execute 'reset role';
  -- Currency mismatch is never treated as a zero difference.
  update public.invoices set currency='USD'where id=v_new;
  execute 'set local role authenticated';
  v_status:=public.reconcile_dispatch_service(v_dispatch)::text;
  execute 'reset role';
  if v_status<>'WITH_DIFFERENCES'or not exists(select 1 from public.dispatch_reconciliations where dispatch_id=v_dispatch and service_comparison->'difference'='null'::jsonb)then raise exception 'QA_CURRENCY_MISMATCH_MATCHED';end if;
  update public.invoices set currency='GTQ'where id=v_new;
  -- Positive and negative monetary differences are kept with their sign.
  update public.invoices set total=49.25,subtotal=49.25 where id=v_new;
  execute 'set local role authenticated';perform public.reconcile_dispatch_service(v_dispatch);execute 'reset role';
  if not exists(select 1 from public.dispatch_reconciliations where dispatch_id=v_dispatch and(service_comparison->>'difference')::numeric=-1)then raise exception 'QA_NEGATIVE_DIFFERENCE_FAILED';end if;
  update public.batches set status='CLOSED'where id=v_batch;
  execute 'set local role authenticated';
  begin
    perform public.reconcile_dispatch_service(v_dispatch);raise exception 'QA_CLOSED_BATCH_ALLOWED';
  exception when raise_exception then if sqlerrm<>'DISPATCH_ACTIVE_BATCH_REQUIRED'then raise;end if;end;
  execute 'reset role';
  for candidate in select id from public.profiles where active and id<>v_actor loop
    perform set_config('request.jwt.claim.sub',candidate.id::text,true);
    if not app_private.has_project_permission(v_project,'invoice.match')then v_other:=candidate.id;exit;end if;
  end loop;
  if v_other is null then raise exception 'QA_UNAUTHORIZED_ACTOR_REQUIRED';end if;
  execute 'set local role authenticated';
  begin
    perform public.reconcile_dispatch_service(v_dispatch);raise exception 'QA_PERMISSION_BYPASSED';
  exception when raise_exception then if sqlerrm<>'PERMISSION_DENIED'then raise;end if;end;
  execute 'reset role';
  raise notice 'PASS: existing service snapshot total, cents, price history, product independence, required closing/rollover, request/replacement/history, currency, signed difference, closed batch and authorization; rollback';
end;
$$;
rollback;
