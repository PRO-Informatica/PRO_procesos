-- Independent Service reconciliation: invoice grand total versus immutable
-- guide-line price snapshots, rounded once to currency cents. It does not
-- change Product reconciliation, programming closure or batch rollover policy.
begin;

alter table public.dispatch_reconciliations
  add column service_status public.dispatch_reconciliation_status not null default 'NOT_STARTED',
  add column service_comparison jsonb,
  add constraint dispatch_service_comparison_object_ck check(service_comparison is null or jsonb_typeof(service_comparison)='object');

create function public.reconcile_dispatch_service(p_dispatch_id uuid)
returns public.dispatch_reconciliation_status
language plpgsql security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid:=auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_reconciliation public.dispatch_reconciliations%rowtype;
  v_invoice public.invoices%rowtype;
  v_extraction public.invoice_extractions%rowtype;
  v_exception public.invoice_recipient_exception_status;
  v_payload jsonb; v_validations jsonb; v_comparison jsonb;
  v_count integer; v_invalid integer; v_estimate numeric(22,2);
  v_total numeric(22,2); v_difference numeric(22,2); v_match boolean;
  v_status public.dispatch_reconciliation_status;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED';end if;
  select *into v_dispatch from public.dispatches where id=p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND';end if;
  if not app_private.has_project_permission(v_dispatch.project_id,'invoice.match')then raise exception 'PERMISSION_DENIED';end if;
  if v_dispatch.status<>'COMPLETED'then raise exception 'DISPATCH_NOT_COMPLETED_FOR_RECONCILIATION';end if;
  if not exists(select 1 from public.batch_dispatches relation join public.batches batch on batch.id=relation.batch_id
    where relation.dispatch_id=v_dispatch.id and relation.project_id=v_dispatch.project_id
      and relation.removed_at is null and batch.status='OPEN')then raise exception 'DISPATCH_ACTIVE_BATCH_REQUIRED';end if;
  select *into v_reconciliation from public.dispatch_reconciliations where dispatch_id=v_dispatch.id for update;
  if not found or v_reconciliation.current_service_invoice_id is null then raise exception 'SERVICE_INVOICE_REQUIRED';end if;
  select *into v_invoice from public.invoices where id=v_reconciliation.current_service_invoice_id
    and dispatch_id=v_dispatch.id and project_id=v_dispatch.project_id and invoice_type='SERVICE'
    and status::text not in('SUPERSEDED','CANCELLED','NON_PROCEEDING');
  if not found then raise exception 'SERVICE_INVOICE_REQUIRED';end if;
  select status into v_exception from public.invoice_recipient_exceptions where invoice_id=v_invoice.id;
  if v_exception='PENDING'then
    update public.dispatch_reconciliations set service_status='PENDING_RECONCILIATION',version=version+1,updated_at=now()where id=v_reconciliation.id;
    return 'PENDING_RECONCILIATION';
  elsif v_exception='REINVOICE_REQUESTED'then
    update public.dispatch_reconciliations set service_status='PENDING_REINVOICING',version=version+1,updated_at=now()where id=v_reconciliation.id;
    return 'PENDING_REINVOICING';
  end if;
  select *into v_extraction from public.invoice_extractions where invoice_id=v_invoice.id order by created_at desc,id desc limit 1;
  if not found then raise exception 'SERVICE_INVOICE_EXTRACTION_REQUIRED';end if;
  v_payload:=coalesce(v_extraction.corrected_payload,v_extraction.normalized_payload);
  select count(*),count(*)filter(where line.estimated_subtotal is null or line.unit_price is null or line.currency is distinct from 'GTQ'),
    round(coalesce(sum(line.estimated_subtotal),0),2)
  into v_count,v_invalid,v_estimate
  from public.dispatch_guides guide join public.dispatch_guide_lines line on line.guide_id=guide.id and line.project_id=guide.project_id
  where guide.dispatch_id=v_dispatch.id and guide.project_id=v_dispatch.project_id and line.catalog_type='SERVICE';
  v_total:=round(v_invoice.total,2);
  v_difference:=case when v_invalid=0 and v_invoice.currency='GTQ'then v_total-v_estimate else null end;
  v_validations:=coalesce(v_payload->'validations','{}')||jsonb_build_object(
    'service_estimate_complete',v_invalid=0,'currency_valid',v_invoice.currency='GTQ',
    'total_valid',v_difference=0,'billing_society_allowed',v_exception is null or v_exception='APPROVED');
  v_match:=coalesce((v_validations->>'document_valid')::boolean,false)
    and coalesce((v_validations->>'type_valid')::boolean,false)
    and coalesce((v_validations->>'project_valid')::boolean,false)
    and coalesce((v_validations->>'supplier_valid')::boolean,false)
    and coalesce((v_validations->>'order_valid')::boolean,false)
    and coalesce((v_validations->>'period_valid')::boolean,false)
    and coalesce((v_validations->>'service_estimate_complete')::boolean,false)
    and coalesce((v_validations->>'currency_valid')::boolean,false)
    and coalesce((v_validations->>'total_valid')::boolean,false);
  v_status:=case when v_match then 'RECONCILED'else 'WITH_DIFFERENCES'end;
  v_comparison:=jsonb_build_object('invoice_id',v_invoice.id,'extraction_id',v_extraction.id,
    'estimated_total',case when v_invalid=0 then v_estimate else null end,'invoice_total',v_total,'difference',v_difference,
    'currency','GTQ','invoice_currency',v_invoice.currency,'service_line_count',v_count,
    'snapshots_complete',v_invalid=0,'validations',v_validations,'checked_at',now(),'checked_by',v_actor);
  update public.dispatch_reconciliations set service_status=v_status,service_comparison=v_comparison,version=version+1,updated_at=now()where id=v_reconciliation.id;
  insert into public.audit_events(actor_user_id,project_id,entity_type,entity_id,action,old_values,new_values)
    values(v_actor,v_dispatch.project_id,'dispatch_reconciliation',v_reconciliation.id,'DISPATCH_SERVICE_RECONCILED',
      jsonb_build_object('status',v_reconciliation.service_status,'comparison',v_reconciliation.service_comparison),
      jsonb_build_object('dispatch_id',v_dispatch.id,'status',v_status,'comparison',v_comparison));
  return v_status;
end;
$$;
alter function public.reconcile_dispatch_service(uuid) owner to postgres;
revoke all on function public.reconcile_dispatch_service(uuid)from public,anon;
grant execute on function public.reconcile_dispatch_service(uuid)to authenticated,service_role;

create function public.request_dispatch_service_reinvoicing(p_dispatch_id uuid,p_reason text)
returns public.dispatch_reconciliation_status
language plpgsql security definer set search_path = pg_catalog, public, app_private
as $$
declare v_actor uuid:=auth.uid();v_reconciliation public.dispatch_reconciliations%rowtype;v_reason text:=nullif(btrim(p_reason),'');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED';end if;
  select *into v_reconciliation from public.dispatch_reconciliations where dispatch_id=p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_RECONCILIATION_NOT_FOUND';end if;
  if not app_private.has_project_permission(v_reconciliation.project_id,'invoice.review')then raise exception 'PERMISSION_DENIED';end if;
  if v_reconciliation.service_status<>'WITH_DIFFERENCES'or v_reconciliation.current_service_invoice_id is null then raise exception 'REINVOICING_NOT_AVAILABLE';end if;
  if v_reason is null or char_length(v_reason)>1000 then raise exception 'REINVOICING_REASON_INVALID';end if;
  if not exists(select 1 from public.batch_dispatches r join public.batches b on b.id=r.batch_id
    where r.dispatch_id=p_dispatch_id and r.removed_at is null and b.status='OPEN')then raise exception 'DISPATCH_ACTIVE_BATCH_REQUIRED';end if;
  update public.dispatch_reconciliations set service_status='PENDING_REINVOICING',version=version+1,updated_at=now()where id=v_reconciliation.id;
  insert into public.audit_events(actor_user_id,project_id,entity_type,entity_id,action,new_values)
    values(v_actor,v_reconciliation.project_id,'dispatch_reconciliation',v_reconciliation.id,'DISPATCH_SERVICE_REINVOICING_REQUESTED',
      jsonb_build_object('dispatch_id',p_dispatch_id,'invoice_id',v_reconciliation.current_service_invoice_id,'reason',v_reason));
  return 'PENDING_REINVOICING';
end;
$$;
alter function public.request_dispatch_service_reinvoicing(uuid,text)owner to postgres;
revoke all on function public.request_dispatch_service_reinvoicing(uuid,text)from public,anon;
grant execute on function public.request_dispatch_service_reinvoicing(uuid,text)to authenticated,service_role;

create or replace function app_private.guard_product_invoice_replacement()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
declare
  v_reconciliation public.dispatch_reconciliations%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.replaces_invoice_id is not distinct from old.replaces_invoice_id
       and new.dispatch_id is not distinct from old.dispatch_id
       and new.project_id is not distinct from old.project_id
       and new.invoice_type is not distinct from old.invoice_type then
      return new;
    end if;
  end if;

  if new.replaces_invoice_id is null then
    return new;
  end if;

  select reconciliation.* into v_reconciliation
  from public.dispatch_reconciliations reconciliation
  where reconciliation.dispatch_id = new.dispatch_id
    and reconciliation.project_id = new.project_id
  for update;

  if not found then raise exception 'REPLACED_INVOICE_CONTEXT_INVALID';end if;
  if not exists(select 1 from public.invoices previous where previous.id=new.replaces_invoice_id
      and previous.project_id=new.project_id and previous.dispatch_id=new.dispatch_id and previous.invoice_type=new.invoice_type)then
    raise exception 'REPLACED_INVOICE_CONTEXT_INVALID';
  end if;
  if new.invoice_type='PRODUCT'then
    if v_reconciliation.status<>'PENDING_REINVOICING'or v_reconciliation.current_product_invoice_id is distinct from new.replaces_invoice_id then
      raise exception 'PRODUCT_REINVOICING_CONTEXT_INVALID';
    end if;
  elsif new.invoice_type='SERVICE'then
    if v_reconciliation.service_status<>'PENDING_REINVOICING'or v_reconciliation.current_service_invoice_id is distinct from new.replaces_invoice_id then
      raise exception 'SERVICE_REINVOICING_CONTEXT_INVALID';
    end if;
  else raise exception 'INVOICE_TYPE_MISMATCH';end if;

  return new;
end;
$$;

create or replace function app_private.refresh_dispatch_reconciliation(p_dispatch_id uuid)
returns public.dispatch_reconciliation_status
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_reconciliation public.dispatch_reconciliations%rowtype;
  v_product_id uuid;
  v_service_id uuid;
  v_product_exception public.invoice_recipient_exception_status;
  v_status public.dispatch_reconciliation_status;
begin
  select * into v_reconciliation
  from public.dispatch_reconciliations
  where dispatch_id = p_dispatch_id for update;
  if not found then
    insert into public.dispatch_reconciliations(project_id, dispatch_id, status)
    select project_id, id, 'NOT_STARTED'
    from public.dispatches where id = p_dispatch_id
    returning * into v_reconciliation;
  end if;

  select invoice.id, exception.status
  into v_product_id, v_product_exception
  from public.invoices invoice
  left join public.invoice_recipient_exceptions exception on exception.invoice_id = invoice.id
  where invoice.dispatch_id = p_dispatch_id
    and invoice.invoice_type = 'PRODUCT'
    and invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
    and exists (select 1 from public.invoice_extractions extraction where extraction.invoice_id = invoice.id)
  order by invoice.created_at desc
  limit 1;

  select id into v_service_id
  from public.invoices invoice
  where invoice.dispatch_id = p_dispatch_id
    and invoice.invoice_type = 'SERVICE'
    and invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
    and exists (select 1 from public.invoice_extractions extraction where extraction.invoice_id = invoice.id)
  order by invoice.created_at desc limit 1;

  v_status := case
    when v_product_id is null then 'NOT_STARTED'
    when v_product_exception = 'REINVOICE_REQUESTED' then 'PENDING_REINVOICING'
    when v_product_exception = 'PENDING' then 'PENDING_RECONCILIATION'
    when v_product_id = v_reconciliation.current_product_invoice_id
      and v_reconciliation.status in ('RECONCILED', 'WITH_DIFFERENCES', 'PENDING_REINVOICING')
      then v_reconciliation.status
    else 'PENDING_RECONCILIATION'
  end;

  update public.dispatch_reconciliations
  set current_product_invoice_id = v_product_id,
      current_service_invoice_id = v_service_id,
      service_status = case
        when v_service_id is null then 'NOT_STARTED'::public.dispatch_reconciliation_status
        when v_service_id=v_reconciliation.current_service_invoice_id then v_reconciliation.service_status
        else 'PENDING_RECONCILIATION'::public.dispatch_reconciliation_status end,
      service_comparison = case when v_service_id=v_reconciliation.current_service_invoice_id then v_reconciliation.service_comparison else null end,
      status = v_status,
      version = version + 1,
      updated_at = now()
  where id = v_reconciliation.id;
  return v_status;
end;
$$;

comment on column public.dispatch_reconciliations.status is 'Product quantity reconciliation. Independent from service_status.';
comment on column public.dispatch_reconciliations.service_status is 'Service invoice total versus rounded guide service price snapshots; advisory, does not change rollover or programming completion.';
comment on column public.dispatch_reconciliations.service_comparison is 'Last monetary comparison, also appended to immutable operational audit history.';
notify pgrst,'reload schema';
commit;
