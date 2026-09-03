-- Transactional QA for quantity-only Order reconciliation. Always rolls back.

begin;
set local session_replication_role = replica;

do $$
declare
  v_project_id uuid;
  v_batch_id uuid;
  v_supplier_id uuid;
  v_actor_id uuid;
  v_order_id uuid := gen_random_uuid();
  v_invoice_id uuid;
  v_old_invoice_id uuid;
  v_total numeric;
  v_status public.order_reconciliation_status;
  v_invoiced numeric;
  v_difference numeric;
  v_step integer := 0;
begin
  select project.id into strict v_project_id
  from public.projects project where project.code = 'QA-B';

  select batch.id into strict v_batch_id
  from public.batches batch
  where batch.project_id = v_project_id
    and batch.accounting_period = date '2026-09-01'
  order by batch.created_at desc limit 1;

  select guide.supplier_id, guide.received_by
  into strict v_supplier_id, v_actor_id
  from public.batch_guides relation
  join public.dispatch_guides guide on guide.id = relation.guide_id
  where relation.batch_id = v_batch_id and relation.removed_at is null
  limit 1;

  update public.dispatch_guides guide
  set order_number = 'QA_RECON_TX'
  where guide.id in (
    select relation.guide_id
    from public.batch_guides relation
    join public.dispatch_guides candidate on candidate.id = relation.guide_id
    where relation.batch_id = v_batch_id
      and relation.removed_at is null
      and candidate.supplier_id = v_supplier_id
    order by candidate.created_at
    limit 3
  );

  select sum(line.quantity) into v_total
  from public.batch_guides relation
  join public.dispatch_guides guide on guide.id = relation.guide_id
  join public.dispatch_guide_lines line on line.guide_id = guide.id
  where relation.batch_id = v_batch_id
    and relation.removed_at is null
    and guide.order_number = 'QA_RECON_TX';
  if coalesce(v_total, 0) <= 0 then raise exception 'QA_NO_GUIDE_TOTAL'; end if;

  insert into public.reconciliation_orders(
    id, project_id, batch_id, normalized_order_number, supplier_id
  ) values (v_order_id, v_project_id, v_batch_id, 'QA_RECON_TX', v_supplier_id);

  -- B: several Guides, one consolidated PRODUCT.
  v_invoice_id := gen_random_uuid();
  insert into public.invoices(
    id, project_id, supplier_id, invoice_type, invoice_number, invoice_date,
    subtotal, total, currency, status, order_number, pca_original, created_by
  ) values (
    v_invoice_id, v_project_id, v_supplier_id, 'PRODUCT', 'QA_RECON_B',
    date '2026-09-01', 1, 1, 'GTQ', 'UNDER_REVIEW', 'QA_RECON_TX',
    'PCA-01092026-QA_RECON_TX', v_actor_id
  );
  insert into public.invoice_lines(invoice_id,line_number,code,description,quantity,unit_code)
  values (v_invoice_id,1,'DIFFERENT-CODE','Descripción deliberadamente distinta',v_total,'M3');
  insert into public.reconciliation_order_invoices(
    project_id,reconciliation_order_id,invoice_id,assigned_by,assignment_source
  ) values (v_project_id,v_order_id,v_invoice_id,v_actor_id,'USER');
  perform app_private.recalculate_reconciliation_order(v_order_id);
  select reconciliation_status into v_status from public.reconciliation_orders where id=v_order_id;
  if v_status <> 'MATCHED' then raise exception 'QA_B_FAILED: %', v_status; end if;

  -- C/D: progressive accumulation across three PRODUCT invoices.
  delete from public.reconciliation_order_invoices where reconciliation_order_id=v_order_id;
  delete from public.invoice_lines where invoice_id=v_invoice_id;
  delete from public.invoices where id=v_invoice_id;
  for v_invoiced in select unnest(array[v_total*.25,v_total*.35,v_total*.40]) loop
    v_step := v_step + 1;
    v_invoice_id := gen_random_uuid();
    insert into public.invoices(
      id,project_id,supplier_id,invoice_type,invoice_number,invoice_date,
      subtotal,total,currency,status,order_number,pca_original,created_by
    ) values (
      v_invoice_id,v_project_id,v_supplier_id,'PRODUCT',
      'QA_RECON_PARTIAL_' || left(v_invoice_id::text, 8),
      date '2026-09-01',1,1,'GTQ','UNDER_REVIEW','QA_RECON_TX',
      'PCA-01092026-QA_RECON_TX',v_actor_id
    );
    insert into public.invoice_lines(invoice_id,line_number,code,description,quantity,unit_code)
    values (v_invoice_id,1,'INFO','Metadato informativo',v_invoiced,'M3');
    insert into public.reconciliation_order_invoices(
      project_id,reconciliation_order_id,invoice_id,assigned_by,assignment_source
    ) values (v_project_id,v_order_id,v_invoice_id,v_actor_id,'USER');
    perform app_private.recalculate_reconciliation_order(v_order_id);
    select reconciliation_status into v_status
    from public.reconciliation_orders where id=v_order_id;
    select sum(invoiced_total), sum(difference)
    into v_invoiced, v_difference
    from public.reconciliation_order_lines where reconciliation_order_id=v_order_id;
    if v_step < 3 and v_status = 'MATCHED' then
      raise exception 'QA_C_D_CLOSED_EARLY: step %', v_step;
    end if;
    if v_step = 1 and (v_invoiced <> v_total*.25 or v_difference <> -(v_total*.75)) then
      raise exception 'QA_C_FIRST_PARTIAL_FAILED: %, %', v_invoiced, v_difference;
    end if;
    if v_step = 2 and (v_invoiced <> v_total*.60 or v_difference <> -(v_total*.40)) then
      raise exception 'QA_D_ACCUMULATION_FAILED: %, %', v_invoiced, v_difference;
    end if;
  end loop;
  select reconciliation_status into v_status from public.reconciliation_orders where id=v_order_id;
  if v_status <> 'MATCHED' then raise exception 'QA_C_D_FAILED: %', v_status; end if;

  -- E: mismatch produces a negative invoice-minus-dispatch difference.
  update public.invoice_lines
  set quantity = quantity - 2
  where invoice_id=v_invoice_id;
  perform app_private.recalculate_reconciliation_order(v_order_id);
  select reconciliation_status into v_status from public.reconciliation_orders where id=v_order_id;
  select sum(difference) into v_difference from public.reconciliation_order_lines where reconciliation_order_id=v_order_id;
  if v_status = 'MATCHED' or v_difference <> -2 then
    raise exception 'QA_E_FAILED: %, %', v_status, v_difference;
  end if;

  -- F/G/I: request replacement; old invoice is excluded when superseded.
  v_old_invoice_id := v_invoice_id;
  update public.invoices set status='REINVOICING' where id=v_old_invoice_id;
  perform app_private.recalculate_reconciliation_order(v_order_id);
  select reconciliation_status into v_status
  from public.reconciliation_orders where id=v_order_id;
  if v_status = 'MATCHED' then raise exception 'QA_F_FAILED'; end if;
  v_invoice_id := gen_random_uuid();
  insert into public.invoices(
    id,project_id,supplier_id,invoice_type,invoice_number,invoice_date,
    subtotal,total,currency,status,order_number,pca_original,created_by,replaces_invoice_id
  ) values (
    v_invoice_id,v_project_id,v_supplier_id,'PRODUCT','QA_RECON_REPLACEMENT',
    date '2026-09-01',1,1,'GTQ','UNDER_REVIEW','QA_RECON_TX',
    'PCA-01092026-QA_RECON_TX',v_actor_id,v_old_invoice_id
  );
  insert into public.invoice_lines(invoice_id,line_number,code,description,quantity,unit_code)
  select v_invoice_id,1,'REPLACEMENT','Factura corregida',quantity+2,'M3'
  from public.invoice_lines where invoice_id=v_old_invoice_id;
  insert into public.reconciliation_order_invoices(
    project_id,reconciliation_order_id,invoice_id,assigned_by,assignment_source
  ) values (v_project_id,v_order_id,v_invoice_id,v_actor_id,'USER');
  update public.invoices set status='SUPERSEDED' where id=v_old_invoice_id;
  perform app_private.recalculate_reconciliation_order(v_order_id);
  select reconciliation_status into v_status from public.reconciliation_orders where id=v_order_id;
  if v_status <> 'MATCHED' then raise exception 'QA_F_G_I_FAILED: %', v_status; end if;

  -- H/J: SERVICE is documentary and cannot change a completed match.
  v_invoice_id := gen_random_uuid();
  insert into public.invoices(
    id,project_id,supplier_id,invoice_type,invoice_number,invoice_date,
    subtotal,total,currency,status,order_number,created_by
  ) values (
    v_invoice_id,v_project_id,v_supplier_id,'SERVICE','QA_RECON_SERVICE',
    date '2026-09-01',1,999,'GTQ','MATCHED','QA_RECON_TX',v_actor_id
  );
  insert into public.reconciliation_order_invoices(
    project_id,reconciliation_order_id,invoice_id,assigned_by,assignment_source
  ) values (v_project_id,v_order_id,v_invoice_id,v_actor_id,'USER');
  perform app_private.recalculate_reconciliation_order(v_order_id);
  select reconciliation_status into v_status from public.reconciliation_orders where id=v_order_id;
  if v_status <> 'MATCHED' then raise exception 'QA_H_J_FAILED: %', v_status; end if;
end;
$$;

rollback;
