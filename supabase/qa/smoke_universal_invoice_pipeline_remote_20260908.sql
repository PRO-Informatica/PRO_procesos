-- Remote transactional smoke tests for 090_universal_invoice_pipeline.sql.
-- All fixtures and mutations are rolled back before the final result is returned.

begin;

create function pg_temp.qa_invoice_payload(
  p_invoice_type public.invoice_type,
  p_invoice_number text,
  p_authorization text,
  p_series text,
  p_file_sha256 text,
  p_order_number text,
  p_quantity numeric,
  p_project_valid boolean default true
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'invoice_number', p_invoice_number,
    'invoice_date', '2026-09-05',
    'currency', 'GTQ',
    'subtotal', 100,
    'total', 112,
    'detected_type', p_invoice_type::text,
    'supplier_tax_id', '32709-3',
    'authorization_number', p_authorization,
    'series', p_series,
    'fiscal_document_key', concat(
      '327093:AUTH:',
      upper(regexp_replace(p_authorization, '[^0-9A-Za-z]', '', 'g'))
    ),
    'file_sha256', p_file_sha256,
    'detected_order_number', p_order_number,
    'invoiced_quantity', p_quantity,
    'normalized_unit', 'M3',
    'project_match_method', case when p_project_valid then 'ADDRESS_EXACT' else 'AMBIGUOUS' end,
    'shipping_address', '1RA CALLE BOULBEARD PRINCIPAL LABOR XELA ZONA 1 LA ESPERANZA QUETZALTENANGO',
    'validations', jsonb_build_object(
      'document_valid', true,
      'type_valid', true,
      'project_valid', p_project_valid,
      'supplier_valid', true,
      'order_valid', true,
      'period_valid', true
    ),
    'lines', jsonb_build_array(jsonb_build_object(
      'code', 'QA-ITEM',
      'description', 'Fixture transaccional 090',
      'quantity', case when p_invoice_type = 'PRODUCT' then p_quantity else 1 end,
      'unit_code', case when p_invoice_type = 'PRODUCT' then 'M3' else 'UN' end,
      'unit_price', 100,
      'line_total', 100
    ))
  );
$$;

create function pg_temp.qa_clone_dispatch(
  p_seed_dispatch_id uuid,
  p_batch_id uuid,
  p_actor_id uuid,
  p_status public.dispatch_status,
  p_link_open_batch boolean,
  p_order_number text
)
returns uuid
language plpgsql
as $$
declare
  v_programming_id uuid := gen_random_uuid();
  v_dispatch_id uuid := gen_random_uuid();
begin
  insert into public.programming(
    id, project_id, supplier_id, created_by, scheduled_at,
    requested_quantity, confirmed_quantity, unit_code, placement_group,
    requires_pumping, estimated_work_item_id, status, notes,
    confirmed_at, confirmed_by, version, created_at, updated_at
  )
  select
    v_programming_id, programming.project_id, programming.supplier_id,
    p_actor_id, clock_timestamp() + interval '1 day', programming.requested_quantity,
    programming.confirmed_quantity, programming.unit_code,
    programming.placement_group, programming.requires_pumping,
    programming.estimated_work_item_id, programming.status,
    concat('QA 090 transaccional: ', p_order_number),
    programming.confirmed_at, programming.confirmed_by,
    programming.version, now(), now()
  from public.programming programming
  join public.dispatches seed on seed.programming_id = programming.id
  where seed.id = p_seed_dispatch_id;

  if not found then
    raise exception 'QA_090_SEED_PROGRAMMING_NOT_FOUND';
  end if;

  insert into public.dispatches(
    id, project_id, supplier_id, programming_id, status, result,
    version, created_by, created_at, updated_at, arrival_at, departure_at,
    received_by, received_by_name, order_number, real_volume,
    real_unit_code, completed_at, completed_by
  )
  select
    v_dispatch_id, seed.project_id, seed.supplier_id, v_programming_id,
    p_status,
    case when p_status = 'COMPLETED' then seed.result else null end,
    1, p_actor_id, now(), now(), clock_timestamp() + interval '1 day',
    case when p_status = 'COMPLETED'
      then clock_timestamp() + interval '1 day 5 minutes' else null end,
    seed.received_by, seed.received_by_name,
    case when p_status = 'COMPLETED' then p_order_number else null end,
    case when p_status = 'COMPLETED' then seed.real_volume else null end,
    seed.real_unit_code,
    case when p_status = 'COMPLETED' then now() else null end,
    case when p_status = 'COMPLETED' then p_actor_id else null end
  from public.dispatches seed
  where seed.id = p_seed_dispatch_id;

  if p_link_open_batch then
    insert into public.batch_dispatches(
      project_id, batch_id, dispatch_id, added_by,
      assignment_source, removal_metadata
    )
    select dispatch.project_id, p_batch_id, v_dispatch_id, p_actor_id,
      'USER', jsonb_build_object('qa', '090_TRANSACTIONAL_SMOKE')
    from public.dispatches dispatch
    where dispatch.id = v_dispatch_id;
  end if;

  return v_dispatch_id;
end;
$$;

create function pg_temp.qa_upload_and_complete(
  p_batch_id uuid,
  p_dispatch_id uuid,
  p_invoice_type public.invoice_type,
  p_payload jsonb,
  p_replaces_invoice_id uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_prepared record;
begin
  select * into strict v_prepared
  from public.prepare_dispatch_invoice_upload_v2(
    p_batch_id,
    p_dispatch_id,
    p_invoice_type,
    p_payload,
    concat(p_payload ->> 'invoice_number', '.pdf'),
    1024,
    p_replaces_invoice_id
  );

  -- Storage byte transfer is outside PostgreSQL. For this transactional DB
  -- smoke test, mark the generated version as uploaded before completing the
  -- real processing/extraction RPC. No Storage object is persisted.
  update public.document_versions
  set upload_status = 'UPLOADED',
      uploaded_at = now(),
      uploaded_by = auth.uid(),
      is_current = true
  where id = v_prepared.version_id;

  perform public.complete_dispatch_invoice_processing(
    v_prepared.invoice_id,
    v_prepared.version_id,
    p_payload
  );

  return v_prepared.invoice_id;
end;
$$;

do $$
declare
  v_actor_id uuid := '14e0668d-146f-47dc-aa1f-737f1f135257';
  v_unauthorized_actor_id uuid := 'ffec1370-997c-4051-8d88-105150dda7da';
  v_seed_dispatch_id uuid := '6690909e-e4d0-4a20-95f0-aefbd3b9ee2c';
  v_batch_id uuid := '2c832098-931f-41f4-8e8d-106da9866793';
  v_service_dispatch_id uuid;
  v_product_dispatch_id uuid;
  v_difference_dispatch_id uuid;
  v_both_dispatch_id uuid;
  v_no_batch_dispatch_id uuid;
  v_executing_dispatch_id uuid;
  v_invoice_id uuid;
  v_old_product_invoice_id uuid;
  v_payload jsonb;
  v_status public.dispatch_reconciliation_status;
  v_expected_failure boolean;
begin
  if not exists (
    select 1
    from public.project_members member
    join public.project_member_roles member_role
      on member_role.project_member_id = member.id and member_role.revoked_at is null
    join public.roles role on role.id = member_role.role_id
    where member.user_id = v_actor_id
      and member.project_id = (select project_id from public.dispatches where id = v_seed_dispatch_id)
      and member.active
      and role.code = 'PURCHASING'
  ) then
    raise exception 'QA_090_PURCHASING_ACTOR_NOT_AUTHORIZED';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_service_dispatch_id := pg_temp.qa_clone_dispatch(
    v_seed_dispatch_id, v_batch_id, v_actor_id, 'COMPLETED', true, 'QA090-SERVICE'
  );
  v_product_dispatch_id := pg_temp.qa_clone_dispatch(
    v_seed_dispatch_id, v_batch_id, v_actor_id, 'COMPLETED', true, 'QA090-PRODUCT'
  );
  v_difference_dispatch_id := pg_temp.qa_clone_dispatch(
    v_seed_dispatch_id, v_batch_id, v_actor_id, 'COMPLETED', true, 'QA090-DIFFERENCE'
  );
  v_both_dispatch_id := pg_temp.qa_clone_dispatch(
    v_seed_dispatch_id, v_batch_id, v_actor_id, 'COMPLETED', true, 'QA090-BOTH'
  );
  v_no_batch_dispatch_id := pg_temp.qa_clone_dispatch(
    v_seed_dispatch_id, v_batch_id, v_actor_id, 'COMPLETED', false, 'QA090-NO-BATCH'
  );
  v_executing_dispatch_id := pg_temp.qa_clone_dispatch(
    v_seed_dispatch_id, v_batch_id, v_actor_id, 'IN_EXECUTION', true, 'QA090-EXECUTING'
  );

  -- 1. Only SERVICE: reconciliation stays NOT_STARTED and PRODUCT stays absent.
  v_payload := pg_temp.qa_invoice_payload(
    'SERVICE', 'QA090-SERVICE', '00000000-0000-0000-0000-000000000001',
    'QA090S01', repeat('1', 64), 'QA090-SERVICE', 1, true
  );
  v_invoice_id := pg_temp.qa_upload_and_complete(
    v_batch_id, v_service_dispatch_id, 'SERVICE', v_payload
  );
  select status into v_status
  from public.dispatch_reconciliations
  where dispatch_id = v_service_dispatch_id
    and current_product_invoice_id is null
    and current_service_invoice_id = v_invoice_id;
  if v_status is distinct from 'NOT_STARTED' then
    raise exception 'QA_090_SERVICE_ONLY_FAILED: %', v_status;
  end if;

  -- 2. Only matching PRODUCT: it becomes pending, then reconciles without SERVICE.
  v_payload := pg_temp.qa_invoice_payload(
    'PRODUCT', 'QA090-PRODUCT', '00000000-0000-0000-0000-000000000002',
    'QA090P02', repeat('2', 64), 'QA090-PRODUCT', 187, true
  );
  v_invoice_id := pg_temp.qa_upload_and_complete(
    v_batch_id, v_product_dispatch_id, 'PRODUCT', v_payload
  );
  select status into v_status from public.dispatch_reconciliations
  where dispatch_id = v_product_dispatch_id
    and current_product_invoice_id = v_invoice_id
    and current_service_invoice_id is null;
  if v_status is distinct from 'PENDING_RECONCILIATION' then
    raise exception 'QA_090_PRODUCT_PENDING_FAILED: %', v_status;
  end if;
  v_status := public.reconcile_dispatch(v_product_dispatch_id);
  if v_status is distinct from 'RECONCILED' then
    raise exception 'QA_090_PRODUCT_ONLY_RECONCILE_FAILED: %', v_status;
  end if;

  -- 3. PRODUCT quantity difference: WITH_DIFFERENCES until explicit human action.
  v_payload := pg_temp.qa_invoice_payload(
    'PRODUCT', 'QA090-DIFFERENCE', '00000000-0000-0000-0000-000000000003',
    'QA090D03', repeat('3', 64), 'QA090-DIFFERENCE', 180, true
  );
  v_old_product_invoice_id := pg_temp.qa_upload_and_complete(
    v_batch_id, v_difference_dispatch_id, 'PRODUCT', v_payload
  );
  v_status := public.reconcile_dispatch(v_difference_dispatch_id);
  if v_status is distinct from 'WITH_DIFFERENCES' then
    raise exception 'QA_090_DIFFERENCE_FAILED: %', v_status;
  end if;
  if exists (
    select 1 from public.dispatch_reconciliations
    where dispatch_id = v_difference_dispatch_id
      and status = 'PENDING_REINVOICING'
  ) then
    raise exception 'QA_090_REINVOICING_CHANGED_WITHOUT_HUMAN_ACTION';
  end if;

  v_status := public.request_dispatch_reinvoicing(
    v_difference_dispatch_id,
    'Solicitud QA transaccional explícita'
  );
  if v_status is distinct from 'PENDING_REINVOICING' then
    raise exception 'QA_090_REINVOICING_REQUEST_FAILED: %', v_status;
  end if;

  -- 4. Replacement PRODUCT supersedes the old invoice, returns to pending,
  -- and reconciles after the corrected quantity is confirmed.
  v_payload := pg_temp.qa_invoice_payload(
    'PRODUCT', 'QA090-REPLACEMENT', '00000000-0000-0000-0000-000000000004',
    'QA090R04', repeat('4', 64), 'QA090-DIFFERENCE', 187, true
  );
  v_invoice_id := pg_temp.qa_upload_and_complete(
    v_batch_id, v_difference_dispatch_id, 'PRODUCT', v_payload,
    v_old_product_invoice_id
  );
  select status into v_status
  from public.dispatch_reconciliations
  where dispatch_id = v_difference_dispatch_id
    and current_product_invoice_id = v_invoice_id;
  if v_status is distinct from 'PENDING_RECONCILIATION'
     or not exists (
       select 1 from public.invoices
       where id = v_old_product_invoice_id and status = 'SUPERSEDED'
     ) then
    raise exception 'QA_090_REPLACEMENT_REFRESH_FAILED: %', v_status;
  end if;
  v_status := public.reconcile_dispatch(v_difference_dispatch_id);
  if v_status is distinct from 'RECONCILED' then
    raise exception 'QA_090_REPLACEMENT_RECONCILE_FAILED: %', v_status;
  end if;

  -- 5. PRODUCT + SERVICE: both pointers exist and PRODUCT drives reconciliation.
  v_payload := pg_temp.qa_invoice_payload(
    'SERVICE', 'QA090-BOTH-SERVICE', '00000000-0000-0000-0000-000000000005',
    'QA090S05', repeat('5', 64), 'QA090-BOTH', 1, true
  );
  perform pg_temp.qa_upload_and_complete(
    v_batch_id, v_both_dispatch_id, 'SERVICE', v_payload
  );
  v_payload := pg_temp.qa_invoice_payload(
    'PRODUCT', 'QA090-BOTH-PRODUCT', '00000000-0000-0000-0000-000000000006',
    'QA090P06', repeat('6', 64), 'QA090-BOTH', 187, true
  );
  perform pg_temp.qa_upload_and_complete(
    v_batch_id, v_both_dispatch_id, 'PRODUCT', v_payload
  );
  v_status := public.reconcile_dispatch(v_both_dispatch_id);
  if v_status is distinct from 'RECONCILED'
     or not exists (
       select 1 from public.dispatch_reconciliations
       where dispatch_id = v_both_dispatch_id
         and current_product_invoice_id is not null
         and current_service_invoice_id is not null
     ) then
    raise exception 'QA_090_PRODUCT_SERVICE_FAILED: %', v_status;
  end if;

  -- 6. Existing fiscal identity is rejected globally.
  v_expected_failure := false;
  v_payload := pg_temp.qa_invoice_payload(
    'SERVICE', 'QA090-DUPLICATE', 'C1AAE06B-3AE8-434B-BCC0-1ED45B5BC630',
    'C1AAE06B', repeat('7', 64), 'QA090-PRODUCT', 1, true
  );
  begin
    perform public.prepare_dispatch_invoice_upload_v2(
      v_batch_id, v_product_dispatch_id, 'SERVICE', v_payload,
      'duplicate.pdf', 1024, null
    );
  exception when others then
    if position('FISCAL_DOCUMENT_ALREADY_EXISTS' in sqlerrm) = 0 then raise; end if;
    v_expected_failure := true;
  end;
  if not v_expected_failure then raise exception 'QA_090_DUPLICATE_NOT_REJECTED'; end if;

  -- 7. An ambiguous project validation cannot enter the persistence pipeline.
  v_expected_failure := false;
  v_payload := pg_temp.qa_invoice_payload(
    'SERVICE', 'QA090-AMBIGUOUS', '00000000-0000-0000-0000-000000000007',
    'QA090A07', repeat('8', 64), 'QA090-PRODUCT', 1, false
  );
  begin
    perform public.prepare_dispatch_invoice_upload_v2(
      v_batch_id, v_product_dispatch_id, 'SERVICE', v_payload,
      'ambiguous.pdf', 1024, null
    );
  exception when others then
    if position('INVOICE_CRITICAL_VALIDATION_FAILED' in sqlerrm) = 0 then raise; end if;
    v_expected_failure := true;
  end;
  if not v_expected_failure then raise exception 'QA_090_AMBIGUOUS_PROJECT_NOT_REJECTED'; end if;

  -- 8. A completed Dispatch without an active open Batch is rejected.
  v_expected_failure := false;
  v_payload := pg_temp.qa_invoice_payload(
    'SERVICE', 'QA090-NO-BATCH', '00000000-0000-0000-0000-000000000008',
    'QA090B08', repeat('9', 64), 'QA090-NO-BATCH', 1, true
  );
  begin
    perform public.prepare_dispatch_invoice_upload_v2(
      v_batch_id, v_no_batch_dispatch_id, 'SERVICE', v_payload,
      'no-batch.pdf', 1024, null
    );
  exception when others then
    if position('INVOICE_BATCH_CONTEXT_INVALID' in sqlerrm) = 0 then raise; end if;
    v_expected_failure := true;
  end;
  if not v_expected_failure then raise exception 'QA_090_NO_BATCH_NOT_REJECTED'; end if;

  -- 9. IN_EXECUTION cannot receive invoices.
  v_expected_failure := false;
  v_payload := pg_temp.qa_invoice_payload(
    'SERVICE', 'QA090-EXECUTING', '00000000-0000-0000-0000-000000000009',
    'QA090E09', repeat('a', 64), 'QA090-EXECUTING', 1, true
  );
  begin
    perform public.prepare_dispatch_invoice_upload_v2(
      v_batch_id, v_executing_dispatch_id, 'SERVICE', v_payload,
      'executing.pdf', 1024, null
    );
  exception when others then
    if position('DISPATCH_NOT_COMPLETED_FOR_INVOICE' in sqlerrm) = 0 then raise; end if;
    v_expected_failure := true;
  end;
  if not v_expected_failure then raise exception 'QA_090_EXECUTING_NOT_REJECTED'; end if;

  -- 10. A user without project authorization is rejected.
  perform set_config('request.jwt.claim.sub', v_unauthorized_actor_id::text, true);
  v_expected_failure := false;
  v_payload := pg_temp.qa_invoice_payload(
    'SERVICE', 'QA090-UNAUTHORIZED', '00000000-0000-0000-0000-000000000010',
    'QA090U10', repeat('b', 64), 'QA090-PRODUCT', 1, true
  );
  begin
    perform public.prepare_dispatch_invoice_upload_v2(
      v_batch_id, v_product_dispatch_id, 'SERVICE', v_payload,
      'unauthorized.pdf', 1024, null
    );
  exception when others then
    if position('PERMISSION_DENIED' in sqlerrm) = 0 then raise; end if;
    v_expected_failure := true;
  end;
  if not v_expected_failure then raise exception 'QA_090_UNAUTHORIZED_NOT_REJECTED'; end if;
end;
$$;

rollback;

select jsonb_build_object(
  'transaction_rolled_back', true,
  'cases', jsonb_build_array(
    'SERVICE_ONLY_NOT_STARTED',
    'PRODUCT_ONLY_RECONCILED_WITHOUT_SERVICE',
    'PRODUCT_WITH_DIFFERENCES',
    'HUMAN_REINVOICING_REQUEST',
    'REPLACEMENT_PRODUCT_RECONCILED',
    'PRODUCT_AND_SERVICE_RECONCILED',
    'DUPLICATE_FISCAL_DOCUMENT_REJECTED',
    'AMBIGUOUS_PROJECT_REJECTED',
    'NO_OPEN_BATCH_REJECTED',
    'IN_EXECUTION_REJECTED',
    'UNAUTHORIZED_PROJECT_REJECTED'
  )
) as smoke_test_result;
