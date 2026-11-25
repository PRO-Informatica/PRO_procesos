begin;

-- A mixed invoice remains one fiscal document. It fills both reconciliation
-- slots, with the service portion kept separately from the grand total.
alter table public.invoices
  add column mixed_service_total numeric(16,2),
  add constraint invoices_mixed_service_total_ck check (
    mixed_service_total is null or (
      invoice_type = 'PRODUCT' and mixed_service_total >= 0 and mixed_service_total <= total
    )
  );

alter table public.dispatch_reconciliation_attempts
  add column product_amount_comparison jsonb;

create function pg_temp.patch_mixed_invoice_function(p_signature regprocedure, p_before text, p_after text)
returns void language plpgsql as $$
declare
  v_definition text := pg_get_functiondef(p_signature);
begin
  if (length(v_definition) - length(replace(v_definition, p_before, ''))) <> length(p_before) then
    raise exception 'MIXED_INVOICE_PREREQUISITE_CHANGED: %', p_signature;
  end if;
  execute replace(v_definition, p_before, p_after);
end;
$$;

-- The existing upload takes the dispatch lock. This check covers concurrent
-- attempts to register a standalone Service while a mixed upload is pending.
select pg_temp.patch_mixed_invoice_function(
  'public.prepare_dispatch_invoice_upload(uuid,uuid,public.invoice_type,jsonb,text,bigint,uuid)',
  $old$and current_invoice.invoice_type = p_invoice_type$old$,
  $new$and (current_invoice.invoice_type = p_invoice_type
        or (p_invoice_type = 'SERVICE' and current_invoice.mixed_service_total is not null))$new$
);

create function public.prepare_mixed_dispatch_invoice_upload(
  p_batch_id uuid,
  p_dispatch_id uuid,
  p_payload jsonb,
  p_file_name text,
  p_file_size bigint,
  p_replaces_invoice_id uuid default null
)
returns table(
  invoice_id uuid, document_id uuid, version_id uuid,
  storage_bucket text, storage_path text, upload_token_context text
)
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_project_id uuid;
  v_prepared record;
  v_product_total numeric;
  v_service_total numeric;
  v_invalid integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select project_id into v_project_id from public.dispatches where id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_project_id, 'invoice.universal')
     or not app_private.has_project_permission(v_project_id, 'invoice.create')
     or not app_private.has_project_permission(v_project_id, 'invoice.match') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if exists (
    select 1 from public.invoices invoice
    where invoice.dispatch_id = p_dispatch_id and invoice.invoice_type = 'SERVICE'
      and invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
  ) then raise exception 'ACTIVE_DISPATCH_INVOICE_ALREADY_EXISTS'; end if;

  select sum(line.amount) filter (where line.product),
         sum(line.amount) filter (where line.service),
         count(*) filter (where line.amount is null or line.amount < 0
           or line.amount <> round(line.amount, 2) or line.product is not distinct from line.service
           or line.product is null or line.service is null)
  into v_product_total, v_service_total, v_invalid
  from (
    select case when jsonb_typeof(value -> 'line_total') = 'number' then (value ->> 'line_total')::numeric end as amount,
           (value ->> 'conciliable')::boolean as product,
           (value ->> 'service')::boolean as service
    from jsonb_array_elements(p_payload -> 'lines')
  ) line;
  if v_invalid > 0 or v_product_total is null or v_service_total is null
     or v_product_total is distinct from (p_payload -> 'mixed_totals' ->> 'product')::numeric
     or v_service_total is distinct from (p_payload -> 'mixed_totals' ->> 'service')::numeric
     or v_product_total + v_service_total is distinct from (p_payload ->> 'total')::numeric then
    raise exception 'MIXED_INVOICE_TOTALS_INVALID';
  end if;

  select * into v_prepared from public.prepare_dispatch_invoice_upload_v2(
    p_batch_id, p_dispatch_id, 'PRODUCT', p_payload, p_file_name, p_file_size, p_replaces_invoice_id
  );
  update public.invoices set mixed_service_total = v_service_total where id = v_prepared.invoice_id;
  return query select v_prepared.invoice_id, v_prepared.document_id, v_prepared.version_id,
    v_prepared.storage_bucket, v_prepared.storage_path, v_prepared.upload_token_context;
end;
$$;

select pg_temp.patch_mixed_invoice_function(
  'app_private.refresh_dispatch_reconciliation(uuid)',
  $old$and invoice.invoice_type = 'SERVICE'$old$,
  $new$and (invoice.invoice_type = 'SERVICE'
      or (invoice.id = v_product_id and invoice.mixed_service_total is not null))$new$
);

select pg_temp.patch_mixed_invoice_function(
  'app_private.refresh_dispatch_reconciliation(uuid)',
  $old$when v_service_id is null then 'NOT_STARTED'::public.dispatch_reconciliation_status$old$,
  $new$when v_service_id is null then 'NOT_STARTED'::public.dispatch_reconciliation_status
        when v_service_id = v_product_id and v_product_exception = 'REINVOICE_REQUESTED' then 'PENDING_REINVOICING'
        when v_service_id = v_product_id and v_product_exception = 'PENDING' then 'PENDING_RECONCILIATION'$new$
);

select pg_temp.patch_mixed_invoice_function(
  'public.complete_dispatch_invoice_processing(uuid,uuid,jsonb)',
  $old$  select id into v_job_id from public.document_processing_jobs$old$,
  $new$  if v_invoice.mixed_service_total is not null and (
       v_invoice.total is distinct from (p_payload ->> 'total')::numeric
       or v_invoice.mixed_service_total is distinct from (p_payload -> 'mixed_totals' ->> 'service')::numeric
       or v_invoice.total - v_invoice.mixed_service_total is distinct from (p_payload -> 'mixed_totals' ->> 'product')::numeric
     ) then raise exception 'MIXED_INVOICE_TOTALS_INVALID'; end if;

  select id into v_job_id from public.document_processing_jobs$new$
);

select pg_temp.patch_mixed_invoice_function(
  'public.reconcile_dispatch_service(uuid)',
  $old$and dispatch_id=v_dispatch.id and project_id=v_dispatch.project_id and invoice_type='SERVICE'$old$,
  $new$and dispatch_id=v_dispatch.id and project_id=v_dispatch.project_id
    and (invoice_type='SERVICE' or (id=v_reconciliation.current_product_invoice_id and mixed_service_total is not null))$new$
);

select pg_temp.patch_mixed_invoice_function(
  'public.reconcile_dispatch_service(uuid)',
  $old$v_total:=round(v_invoice.total,2);$old$,
  $new$v_total:=round(coalesce(v_invoice.mixed_service_total,v_invoice.total),2);$new$
);

create function app_private.mixed_product_amount_comparison(p_dispatch_id uuid, p_invoice public.invoices)
returns jsonb language sql stable
set search_path = pg_catalog, public
as $$
  with snapshots as (
    select count(*) filter (where line.estimated_subtotal is null
      or line.unit_price is null or line.currency is distinct from 'GTQ') = 0 as complete,
      round(coalesce(sum(line.estimated_subtotal), 0), 2) as estimated
    from public.dispatch_guides guide
    join public.dispatch_guide_lines line on line.guide_id = guide.id and line.project_id = guide.project_id
    where guide.project_id = p_invoice.project_id and guide.dispatch_id = p_dispatch_id
      and line.quantity > 0 and (line.catalog_type = 'PRODUCT' or line.catalog_type is null)
  )
  select jsonb_build_object(
    'invoice_id', p_invoice.id, 'currency', 'GTQ', 'invoice_currency', p_invoice.currency,
    'estimated_total', case when complete then estimated end,
    'invoice_total', round(p_invoice.total - p_invoice.mixed_service_total, 2),
    'difference', case when complete and p_invoice.currency = 'GTQ'
      then round(p_invoice.total - p_invoice.mixed_service_total, 2) - estimated end,
    'snapshots_complete', complete, 'checked_at', now()
  ) from snapshots
$$;
revoke all on function app_private.mixed_product_amount_comparison(uuid,public.invoices) from public, anon, authenticated;

select pg_temp.patch_mixed_invoice_function(
  'public.reconcile_dispatch(uuid)',
  $old$  v_next_status public.dispatch_reconciliation_status;$old$,
  $new$  v_next_status public.dispatch_reconciliation_status;
  v_product_amount_comparison jsonb;$new$
);

select pg_temp.patch_mixed_invoice_function(
  'public.reconcile_dispatch(uuid)',
  $old$  v_match := coalesce((v_validations ->> 'document_valid')::boolean, false)$old$,
  $new$  if v_invoice.mixed_service_total is not null then
    v_product_amount_comparison := app_private.mixed_product_amount_comparison(v_dispatch.id, v_invoice);
    v_validations := v_validations || jsonb_build_object(
      'product_amount_valid', coalesce((v_product_amount_comparison ->> 'difference')::numeric = 0, false)
    );
  end if;
  v_match := coalesce((v_validations ->> 'document_valid')::boolean, false)$new$
);

select pg_temp.patch_mixed_invoice_function(
  'public.reconcile_dispatch(uuid)',
  $old$and coalesce((v_validations ->> 'quantity_valid')::boolean, false);$old$,
  $new$and coalesce((v_validations ->> 'quantity_valid')::boolean, false)
    and (v_invoice.mixed_service_total is null or (v_validations ->> 'product_amount_valid')::boolean);$new$
);

select pg_temp.patch_mixed_invoice_function(
  'public.reconcile_dispatch(uuid)',
  $old$invoice_unit_code, difference, validations, result, executed_by$old$,
  $new$invoice_unit_code, difference, validations, product_amount_comparison, result, executed_by$new$
);

select pg_temp.patch_mixed_invoice_function(
  'public.reconcile_dispatch(uuid)',
  $old$v_invoice_unit, v_difference, v_validations,$old$,
  $new$v_invoice_unit, v_difference, v_validations, v_product_amount_comparison,$new$
);

create function public.reconcile_mixed_dispatch_invoice(p_dispatch_id uuid)
returns table(product_status public.dispatch_reconciliation_status, service_status public.dispatch_reconciliation_status)
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_project_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select project_id into v_project_id from public.dispatches where id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_project_id, 'invoice.match') then raise exception 'PERMISSION_DENIED'; end if;
  if not exists (
    select 1 from public.dispatch_reconciliations reconciliation
    join public.invoices invoice on invoice.id = reconciliation.current_product_invoice_id
    where reconciliation.dispatch_id = p_dispatch_id
      and reconciliation.current_service_invoice_id = invoice.id
      and invoice.mixed_service_total is not null
  ) then raise exception 'MIXED_INVOICE_REQUIRED'; end if;
  product_status := public.reconcile_dispatch(p_dispatch_id);
  service_status := public.reconcile_dispatch_service(p_dispatch_id);
  return next;
end;
$$;

select pg_temp.patch_mixed_invoice_function(
  'public.request_dispatch_reinvoicing(uuid,text)',
  $old$set status = 'PENDING_REINVOICING', version = version + 1, updated_at = now()$old$,
  $new$set status = 'PENDING_REINVOICING',
      service_status = case when current_product_invoice_id = current_service_invoice_id
        then 'PENDING_REINVOICING'::public.dispatch_reconciliation_status else service_status end,
      version = version + 1, updated_at = now()$new$
);

select pg_temp.patch_mixed_invoice_function(
  'public.request_dispatch_service_reinvoicing(uuid,text)',
  $old$set service_status='PENDING_REINVOICING',version=version+1,updated_at=now()$old$,
  $new$set service_status='PENDING_REINVOICING',
    status=case when current_product_invoice_id=current_service_invoice_id
      then 'PENDING_REINVOICING'::public.dispatch_reconciliation_status else status end,
    version=version+1,updated_at=now()$new$
);

select pg_temp.patch_mixed_invoice_function(
  'public.decide_invoice_recipient_exception(uuid,text)',
  $old$v_reconciliation_status := public.reconcile_dispatch(v_invoice.dispatch_id);$old$,
  $new$if v_invoice.mixed_service_total is not null then
        select mixed.product_status into v_reconciliation_status
        from public.reconcile_mixed_dispatch_invoice(v_invoice.dispatch_id) mixed;
      else
        v_reconciliation_status := public.reconcile_dispatch(v_invoice.dispatch_id);
      end if;$new$
);

select pg_temp.patch_mixed_invoice_function(
  'public.decide_invoice_recipient_exception(uuid,text)',
  $old$set status = 'PENDING_REINVOICING', version = version + 1, updated_at = now()$old$,
  $new$set status = 'PENDING_REINVOICING',
        service_status = case when current_product_invoice_id = current_service_invoice_id
          then 'PENDING_REINVOICING'::public.dispatch_reconciliation_status else service_status end,
        version = version + 1, updated_at = now()$new$
);

revoke all on function public.prepare_mixed_dispatch_invoice_upload(uuid,uuid,jsonb,text,bigint,uuid) from public, anon;
revoke all on function public.reconcile_mixed_dispatch_invoice(uuid) from public, anon;
grant execute on function public.prepare_mixed_dispatch_invoice_upload(uuid,uuid,jsonb,text,bigint,uuid) to authenticated, service_role;
grant execute on function public.reconcile_mixed_dispatch_invoice(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
