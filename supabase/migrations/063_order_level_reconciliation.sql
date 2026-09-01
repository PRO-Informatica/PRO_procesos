-- 063_order_level_reconciliation.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Order-level reconciliation handoff after Operational Phases 8 and 9.
-- Non-destructively changes the reconciliation aggregate from Guide/Invoice
-- to Batch/normalized Order, while retaining batch_guides and guide_invoices.

begin;

do $$
begin
  if to_regclass('public.reconciliation_orders') is not null
     or to_regclass('public.reconciliation_order_invoices') is not null
     or to_regclass('public.reconciliation_order_lines') is not null then
    raise exception 'ORDER_RECONCILIATION_RELATION_ALREADY_EXISTS';
  end if;
  if to_regprocedure(
    'public.prepare_batch_invoice_upload(uuid,public.invoice_type,text,date,text,numeric,numeric,uuid[],jsonb,text,text,bigint,uuid)'
  ) is null
     or to_regprocedure('public.reconcile_batch_invoice(uuid,uuid)') is null
     or to_regprocedure(
       'app_private.prepare_document_upload_version(uuid,uuid,uuid,text,text,bigint)'
     ) is null then
    raise exception 'ORDER_RECONCILIATION_PHASE9_CONTRACT_MISSING';
  end if;
end;
$$;

create type public.order_document_status as enum (
  'OPEN', 'DOCUMENTS_LOADING', 'READY_TO_RECONCILE', 'CLOSED'
);
create type public.order_reconciliation_status as enum (
  'NOT_EVALUATED', 'NO_INVOICES', 'PARTIAL', 'MATCHED',
  'WITH_DIFFERENCES', 'REQUIRES_REVIEW'
);
create type public.order_line_reconciliation_status as enum (
  'MATCHED', 'INVOICED_OVER_DISPATCHED',
  'DISPATCHED_OVER_INVOICED', 'MISSING_INVOICE',
  'INVOICED_WITHOUT_GUIDE', 'REQUIRES_REVIEW'
);

alter table public.invoices
add column pca_original text;

alter table public.invoices
add constraint invoices_pca_original_ck
check (
  pca_original is null
  or (
    nullif(btrim(pca_original), '') is not null
    and char_length(pca_original) <= 255
  )
);

create unique index batches_id_project_order_uq
on public.batches(id, project_id);
create unique index invoices_id_project_order_uq
on public.invoices(id, project_id);

create function app_private.normalize_reconciliation_order_number(p_value text)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_value text := nullif(btrim(p_value), '');
begin
  if v_value is null then return null; end if;
  if upper(v_value) like 'PCA-%' then
    v_value := regexp_replace(v_value, '^.*-', '');
  end if;
  v_value := nullif(btrim(v_value), '');
  if v_value ~ '^[0-9]+$' then
    return coalesce(nullif(ltrim(v_value, '0'), ''), '0');
  end if;
  return upper(regexp_replace(v_value, '[[:space:]]+', '', 'g'));
end;
$$;

alter function app_private.normalize_reconciliation_order_number(text)
owner to postgres;
revoke all on function app_private.normalize_reconciliation_order_number(text)
from public, anon, authenticated;
grant execute on function app_private.normalize_reconciliation_order_number(text)
to service_role;

create table public.reconciliation_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  batch_id uuid not null references public.batches(id) on delete restrict,
  normalized_order_number text not null,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  document_status public.order_document_status not null default 'OPEN',
  reconciliation_status public.order_reconciliation_status not null
    default 'NOT_EVALUATED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete restrict,
  version integer not null default 1,
  constraint reconciliation_orders_number_ck
    check (nullif(btrim(normalized_order_number), '') is not null),
  constraint reconciliation_orders_version_ck check (version > 0),
  constraint reconciliation_orders_close_ck check (
    (document_status = 'CLOSED' and closed_at is not null and closed_by is not null)
    or
    (document_status <> 'CLOSED' and closed_at is null and closed_by is null)
  ),
  constraint reconciliation_orders_batch_number_uq
    unique (batch_id, normalized_order_number),
  constraint reconciliation_orders_batch_project_fk
    foreign key (batch_id, project_id)
    references public.batches(id, project_id) on delete restrict,
  constraint reconciliation_orders_id_project_uq unique (id, project_id)
);

create index idx_reconciliation_orders_project_status
on public.reconciliation_orders(project_id, reconciliation_status);

create table public.reconciliation_order_invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  reconciliation_order_id uuid not null,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  assignment_source text not null default 'USER',
  constraint reconciliation_order_invoices_order_fk
    foreign key (reconciliation_order_id, project_id)
    references public.reconciliation_orders(id, project_id) on delete restrict,
  constraint reconciliation_order_invoices_invoice_uq unique (invoice_id),
  constraint reconciliation_order_invoices_invoice_project_fk
    foreign key (invoice_id, project_id)
    references public.invoices(id, project_id) on delete restrict,
  constraint reconciliation_order_invoices_source_ck
    check (assignment_source in ('USER', 'SYSTEM', 'BACKFILL'))
);

create index idx_reconciliation_order_invoices_order
on public.reconciliation_order_invoices(reconciliation_order_id, invoice_id);

create table public.reconciliation_order_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  reconciliation_order_id uuid not null,
  product_code text not null,
  product_description text not null,
  unit_code text,
  dispatched_total numeric not null default 0,
  invoiced_total numeric not null default 0,
  difference numeric not null default 0,
  status public.order_line_reconciliation_status not null,
  guide_count integer not null default 0,
  invoice_count integer not null default 0,
  secondary_discrepancies jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint reconciliation_order_lines_order_fk
    foreign key (reconciliation_order_id, project_id)
    references public.reconciliation_orders(id, project_id) on delete restrict,
  constraint reconciliation_order_lines_totals_ck check (
    dispatched_total >= 0 and invoiced_total >= 0
    and difference = invoiced_total - dispatched_total
    and guide_count >= 0 and invoice_count >= 0
  ),
  constraint reconciliation_order_lines_discrepancies_ck
    check (jsonb_typeof(secondary_discrepancies) = 'array')
);

create unique index reconciliation_order_lines_key_uq
on public.reconciliation_order_lines(
  reconciliation_order_id,
  product_code,
  coalesce(unit_code, '')
);

alter table public.reconciliation_orders enable row level security;
alter table public.reconciliation_order_invoices enable row level security;
alter table public.reconciliation_order_lines enable row level security;

create policy reconciliation_orders_select
on public.reconciliation_orders for select to authenticated
using (app_private.has_project_permission(project_id, 'invoice.view'));
create policy platform_admin_read_reconciliation_orders
on public.reconciliation_orders for select to authenticated
using (app_private.is_platform_admin());

create policy reconciliation_order_invoices_select
on public.reconciliation_order_invoices for select to authenticated
using (app_private.has_project_permission(project_id, 'invoice.view'));
create policy platform_admin_read_reconciliation_order_invoices
on public.reconciliation_order_invoices for select to authenticated
using (app_private.is_platform_admin());

create policy reconciliation_order_lines_select
on public.reconciliation_order_lines for select to authenticated
using (app_private.has_project_permission(project_id, 'invoice.view'));
create policy platform_admin_read_reconciliation_order_lines
on public.reconciliation_order_lines for select to authenticated
using (app_private.is_platform_admin());

revoke all privileges on table
  public.reconciliation_orders,
  public.reconciliation_order_invoices,
  public.reconciliation_order_lines
from public, anon, authenticated;
grant select on table
  public.reconciliation_orders,
  public.reconciliation_order_invoices,
  public.reconciliation_order_lines
to authenticated;
grant all privileges on table
  public.reconciliation_orders,
  public.reconciliation_order_invoices,
  public.reconciliation_order_lines
to service_role;

create function app_private.ensure_reconciliation_orders_for_batch(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_inserted integer;
begin
  insert into public.reconciliation_orders(
    project_id, batch_id, normalized_order_number, supplier_id
  )
  select
    b.project_id,
    b.id,
    normalized.order_number,
    case when count(distinct dg.supplier_id) = 1 then min(dg.supplier_id::text)::uuid end
  from public.batches b
  join public.batch_guides bg
    on bg.batch_id = b.id and bg.project_id = b.project_id
   and bg.removed_at is null
  join public.dispatch_guides dg
    on dg.id = bg.guide_id and dg.project_id = bg.project_id
  cross join lateral (
    select app_private.normalize_reconciliation_order_number(dg.order_number)
      as order_number
  ) normalized
  where b.id = p_batch_id and normalized.order_number is not null
  group by b.project_id, b.id, normalized.order_number
  on conflict (batch_id, normalized_order_number)
  do update set
    supplier_id = excluded.supplier_id,
    updated_at = now();
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

alter function app_private.ensure_reconciliation_orders_for_batch(uuid)
owner to postgres;
revoke all on function app_private.ensure_reconciliation_orders_for_batch(uuid)
from public, anon, authenticated;

create function app_private.recalculate_reconciliation_order(p_order_id uuid)
returns public.order_reconciliation_status
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_order public.reconciliation_orders%rowtype;
  v_invoice_count integer;
  v_unverified_count integer;
  v_line_count integer;
  v_match_count integer;
  v_review_count integer;
  v_status public.order_reconciliation_status;
  v_document_status public.order_document_status;
  v_supplier_count integer;
  v_company_id uuid;
begin
  select ro.* into v_order
  from public.reconciliation_orders ro
  where ro.id = p_order_id for update;
  if not found then raise exception 'RECONCILIATION_ORDER_NOT_FOUND'; end if;

  delete from public.reconciliation_order_lines rol
  where rol.reconciliation_order_id = v_order.id;

  insert into public.reconciliation_order_lines(
    project_id, reconciliation_order_id, product_code,
    product_description, unit_code, dispatched_total, invoiced_total,
    difference, status, guide_count, invoice_count,
    secondary_discrepancies
  )
  with guide_lines as (
    select
      upper(btrim(dgl.product_code)) product_code,
      dgl.unit_code,
      min(btrim(dgl.product_description)) product_description,
      count(distinct lower(btrim(dgl.product_description))) description_count,
      sum(dgl.quantity) dispatched_total,
      count(distinct dg.id)::integer guide_count
    from public.batch_guides bg
    join public.dispatch_guides dg
      on dg.id = bg.guide_id and dg.project_id = bg.project_id
    join public.dispatch_guide_lines dgl
      on dgl.guide_id = dg.id and dgl.project_id = dg.project_id
    where bg.batch_id = v_order.batch_id
      and bg.project_id = v_order.project_id
      and bg.removed_at is null
      and app_private.normalize_reconciliation_order_number(dg.order_number)
          = v_order.normalized_order_number
    group by upper(btrim(dgl.product_code)), dgl.unit_code
  ),
  current_invoices as (
    select i.*
    from public.reconciliation_order_invoices roi
    join public.invoices i on i.id = roi.invoice_id
    where roi.reconciliation_order_id = v_order.id
      and i.status not in ('SUPERSEDED', 'CANCELLED')
      and not exists (
        select 1 from public.invoices replacement
        where replacement.replaces_invoice_id = i.id
          and replacement.status not in ('SUPERSEDED', 'CANCELLED')
      )
  ),
  invoice_lines_agg as (
    select
      coalesce(upper(nullif(btrim(il.code), '')), '__MISSING__') product_code,
      il.unit_code,
      min(btrim(il.description)) product_description,
      count(distinct lower(btrim(il.description))) description_count,
      sum(il.quantity) invoiced_total,
      count(distinct i.id)::integer invoice_count
    from current_invoices i
    join public.invoice_lines il on il.invoice_id = i.id
    group by coalesce(upper(nullif(btrim(il.code), '')), '__MISSING__'), il.unit_code
  ),
  compared as (
    select
      coalesce(gl.product_code, il.product_code) product_code,
      coalesce(gl.product_description, il.product_description, 'Sin descripción')
        product_description,
      coalesce(gl.unit_code, il.unit_code) unit_code,
      coalesce(gl.dispatched_total, 0) dispatched_total,
      coalesce(il.invoiced_total, 0) invoiced_total,
      coalesce(gl.guide_count, 0) guide_count,
      coalesce(il.invoice_count, 0) invoice_count,
      coalesce(gl.description_count, 0) guide_description_count,
      coalesce(il.description_count, 0) invoice_description_count,
      gl.product_description guide_description,
      il.product_description invoice_description
    from guide_lines gl
    full join invoice_lines_agg il
      on il.product_code = gl.product_code
     and il.unit_code is not distinct from gl.unit_code
  )
  select
    v_order.project_id,
    v_order.id,
    compared.product_code,
    compared.product_description,
    compared.unit_code,
    compared.dispatched_total,
    compared.invoiced_total,
    compared.invoiced_total - compared.dispatched_total,
    case
      when compared.product_code = '__MISSING__'
        or compared.unit_code is null
        or compared.guide_description_count > 1
        or compared.invoice_description_count > 1
        or (
          compared.guide_description is not null
          and compared.invoice_description is not null
          and lower(compared.guide_description) <> lower(compared.invoice_description)
        ) then 'REQUIRES_REVIEW'::public.order_line_reconciliation_status
      when compared.dispatched_total > 0 and compared.invoiced_total = 0
        then 'MISSING_INVOICE'::public.order_line_reconciliation_status
      when compared.invoiced_total > 0 and compared.dispatched_total = 0
        then 'INVOICED_WITHOUT_GUIDE'::public.order_line_reconciliation_status
      when compared.invoiced_total > compared.dispatched_total
        then 'INVOICED_OVER_DISPATCHED'::public.order_line_reconciliation_status
      when compared.dispatched_total > compared.invoiced_total
        then 'DISPATCHED_OVER_INVOICED'::public.order_line_reconciliation_status
      else 'MATCHED'::public.order_line_reconciliation_status
    end,
    compared.guide_count,
    compared.invoice_count,
    case
      when compared.product_code = '__MISSING__' then '["MISSING_PRODUCT_CODE"]'::jsonb
      when compared.unit_code is null then '["MISSING_UNIT_CODE"]'::jsonb
      when compared.guide_description_count > 1
        or compared.invoice_description_count > 1
        or (
          compared.guide_description is not null
          and compared.invoice_description is not null
          and lower(compared.guide_description)
              <> lower(compared.invoice_description)
        )
        then '["PRODUCT_DESCRIPTION_MISMATCH"]'::jsonb
      else '[]'::jsonb
    end
  from compared;

  select count(*)::integer into v_invoice_count
  from public.reconciliation_order_invoices roi
  join public.invoices i on i.id = roi.invoice_id
  where roi.reconciliation_order_id = v_order.id
    and i.status not in ('SUPERSEDED', 'CANCELLED')
    and not exists (
      select 1 from public.invoices replacement
      where replacement.replaces_invoice_id = i.id
        and replacement.status not in ('SUPERSEDED', 'CANCELLED')
    );

  select count(*)::integer into v_unverified_count
  from public.reconciliation_order_invoices roi
  join public.invoices i on i.id = roi.invoice_id
  where roi.reconciliation_order_id = v_order.id
    and i.status not in ('SUPERSEDED', 'CANCELLED')
    and not exists (
      select 1
      from public.invoice_documents idoc
      join public.document_versions dv
        on dv.document_id = idoc.document_id
       and dv.upload_status = 'UPLOADED' and dv.is_current = true
      join public.document_processing_jobs dpj
        on dpj.document_version_id = dv.id
      join public.ocr_extractions oe
        on oe.processing_job_id = dpj.id
       and oe.verification_status in ('CONFIRMED', 'CORRECTED')
      where idoc.invoice_id = i.id
    );

  select
    count(*)::integer,
    count(*) filter (where rol.status = 'MATCHED')::integer,
    count(*) filter (where rol.status = 'REQUIRES_REVIEW')::integer
  into v_line_count, v_match_count, v_review_count
  from public.reconciliation_order_lines rol
  where rol.reconciliation_order_id = v_order.id;

  select count(distinct supplier_id)::integer into v_supplier_count
  from (
    select dg.supplier_id
    from public.batch_guides bg
    join public.dispatch_guides dg on dg.id = bg.guide_id
    where bg.batch_id = v_order.batch_id and bg.removed_at is null
      and app_private.normalize_reconciliation_order_number(dg.order_number)
          = v_order.normalized_order_number
    union all
    select i.supplier_id
    from public.reconciliation_order_invoices roi
    join public.invoices i on i.id = roi.invoice_id
    where roi.reconciliation_order_id = v_order.id
      and i.status not in ('SUPERSEDED', 'CANCELLED')
  ) suppliers;

  v_status := case
    when v_invoice_count = 0 then 'NO_INVOICES'
    when v_supplier_count > 1 or v_review_count > 0 then 'REQUIRES_REVIEW'
    when v_line_count > 0 and v_match_count = v_line_count then 'MATCHED'
    when v_match_count > 0 then 'PARTIAL'
    else 'WITH_DIFFERENCES'
  end;
  v_document_status := case
    when v_order.document_status = 'CLOSED' then 'CLOSED'
    when v_invoice_count = 0 then 'OPEN'
    when v_unverified_count > 0 then 'DOCUMENTS_LOADING'
    else 'READY_TO_RECONCILE'
  end;

  update public.reconciliation_orders
  set reconciliation_status = v_status,
      document_status = v_document_status,
      supplier_id = case when v_supplier_count = 1 then (
        select min(dg.supplier_id::text)::uuid
        from public.batch_guides bg
        join public.dispatch_guides dg on dg.id = bg.guide_id
        where bg.batch_id = v_order.batch_id and bg.removed_at is null
          and app_private.normalize_reconciliation_order_number(dg.order_number)
              = v_order.normalized_order_number
      ) else null end,
      version = version + 1,
      updated_at = now()
  where id = v_order.id;

  select p.company_id into v_company_id
  from public.projects p where p.id = v_order.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    auth.uid(), v_company_id, v_order.project_id,
    'reconciliation_order', v_order.id,
    'ORDER_RECONCILIATION_RECALCULATED',
    jsonb_build_object(
      'batch_id', v_order.batch_id,
      'normalized_order_number', v_order.normalized_order_number,
      'document_status', v_document_status,
      'reconciliation_status', v_status,
      'line_count', v_line_count,
      'invoice_count', v_invoice_count
    )
  );
  return v_status;
end;
$$;

alter function app_private.recalculate_reconciliation_order(uuid)
owner to postgres;
revoke all on function app_private.recalculate_reconciliation_order(uuid)
from public, anon, authenticated;

create function app_private.sync_reconciliation_order_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_order_id uuid;
  v_batch_id uuid;
  v_guide_id uuid;
  v_invoice_id uuid;
  v_old_order_number text;
  v_new_order_number text;
  v_company_id uuid;
begin
  if tg_table_name = 'dispatch_guide_lines' then
    v_guide_id := case when tg_op = 'DELETE' then old.guide_id else new.guide_id end;
  elsif tg_table_name = 'dispatch_guides' then
    v_guide_id := new.id;
    v_old_order_number := app_private.normalize_reconciliation_order_number(old.order_number);
    v_new_order_number := app_private.normalize_reconciliation_order_number(new.order_number);
  elsif tg_table_name = 'batch_guides' then
    v_guide_id := case when tg_op = 'DELETE' then old.guide_id else new.guide_id end;
    v_batch_id := case when tg_op = 'DELETE' then old.batch_id else new.batch_id end;
  elsif tg_table_name = 'invoice_lines' then
    v_invoice_id := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  elsif tg_table_name = 'invoices' then
    v_invoice_id := new.id;
    if new.replaces_invoice_id is not null
       and new.status in ('UNDER_REVIEW', 'MATCHED', 'APPROVED') then
      update public.invoices
      set status = 'SUPERSEDED', updated_at = now()
      where id = new.replaces_invoice_id
        and status not in ('SUPERSEDED', 'CANCELLED');
      if found then
        select p.company_id into v_company_id
        from public.projects p where p.id = new.project_id;
        insert into public.audit_events(
          actor_user_id, company_id, project_id, entity_type,
          entity_id, action, new_values
        ) values (
          auth.uid(), v_company_id, new.project_id, 'invoice', new.id,
          'INVOICE_REPLACED',
          jsonb_build_object(
            'replaces_invoice_id', new.replaces_invoice_id,
            'replacement_invoice_id', new.id
          )
        );
      end if;
    end if;
  elsif tg_table_name = 'reconciliation_order_invoices' then
    v_order_id := case when tg_op = 'DELETE'
      then old.reconciliation_order_id else new.reconciliation_order_id end;
  end if;

  if v_batch_id is not null then
    perform app_private.ensure_reconciliation_orders_for_batch(v_batch_id);
  elsif v_guide_id is not null then
    for v_batch_id in
      select distinct bg.batch_id
      from public.batch_guides bg
      where bg.guide_id = v_guide_id and bg.removed_at is null
    loop
      perform app_private.ensure_reconciliation_orders_for_batch(v_batch_id);
    end loop;
  end if;

  if v_guide_id is not null then
    for v_order_id in
      select distinct ro.id
      from public.reconciliation_orders ro
      join public.dispatch_guides dg
        on dg.id = v_guide_id and dg.project_id = ro.project_id
      where (
          (v_batch_id is not null and ro.batch_id = v_batch_id)
          or exists (
            select 1 from public.batch_guides bg
            where bg.guide_id = v_guide_id
              and bg.batch_id = ro.batch_id
              and bg.project_id = ro.project_id
          )
        )
        and (
          ro.normalized_order_number =
            app_private.normalize_reconciliation_order_number(dg.order_number)
          or ro.normalized_order_number = v_old_order_number
          or ro.normalized_order_number = v_new_order_number
        )
    loop
      perform app_private.recalculate_reconciliation_order(v_order_id);
    end loop;
  elsif v_invoice_id is not null then
    for v_order_id in
      select roi.reconciliation_order_id
      from public.reconciliation_order_invoices roi
      where roi.invoice_id = v_invoice_id
    loop
      perform app_private.recalculate_reconciliation_order(v_order_id);
    end loop;
  elsif v_order_id is not null then
    perform app_private.recalculate_reconciliation_order(v_order_id);
  end if;
  return null;
end;
$$;

alter function app_private.sync_reconciliation_order_change()
owner to postgres;
revoke all on function app_private.sync_reconciliation_order_change()
from public, anon, authenticated;

create trigger reconciliation_sync_guide_lines
after insert or update or delete on public.dispatch_guide_lines
for each row execute function app_private.sync_reconciliation_order_change();
create trigger reconciliation_sync_guides
after update of order_number on public.dispatch_guides
for each row execute function app_private.sync_reconciliation_order_change();
create trigger reconciliation_sync_batch_guides
after insert or update of removed_at or delete on public.batch_guides
for each row execute function app_private.sync_reconciliation_order_change();
create trigger reconciliation_sync_invoice_lines
after insert or update or delete on public.invoice_lines
for each row execute function app_private.sync_reconciliation_order_change();
create trigger reconciliation_sync_invoices
after update of status, supplier_id, replaces_invoice_id on public.invoices
for each row execute function app_private.sync_reconciliation_order_change();
create trigger reconciliation_sync_order_invoices
after insert or update or delete on public.reconciliation_order_invoices
for each row execute function app_private.sync_reconciliation_order_change();

-- Backfill orders from active Guide membership. No order number is invented.
do $$
declare
  v_batch record;
begin
  for v_batch in select id from public.batches order by created_at, id loop
    perform app_private.ensure_reconciliation_orders_for_batch(v_batch.id);
  end loop;
end;
$$;

-- Associate an existing Invoice only when all of its linked active Guides
-- resolve to exactly one Batch + normalized Order. Ambiguous invoices remain
-- deliberately unassigned for human review.
insert into public.reconciliation_order_invoices(
  project_id, reconciliation_order_id, invoice_id,
  assigned_by, assignment_source
)
select resolved.project_id, ro.id, resolved.invoice_id, null, 'BACKFILL'
from (
  select
    gi.invoice_id,
    min(gi.project_id::text)::uuid project_id,
    min(bg.batch_id::text)::uuid batch_id,
    min(app_private.normalize_reconciliation_order_number(dg.order_number))
      normalized_order_number
  from public.guide_invoices gi
  join public.batch_guides bg
    on bg.guide_id = gi.guide_id and bg.project_id = gi.project_id
   and bg.removed_at is null
  join public.dispatch_guides dg
    on dg.id = gi.guide_id and dg.project_id = gi.project_id
  where app_private.normalize_reconciliation_order_number(dg.order_number) is not null
  group by gi.invoice_id
  having count(distinct (
    bg.batch_id::text || ':' ||
    app_private.normalize_reconciliation_order_number(dg.order_number)
  )) = 1
) resolved
join public.reconciliation_orders ro
  on ro.batch_id = resolved.batch_id
 and ro.project_id = resolved.project_id
 and ro.normalized_order_number = resolved.normalized_order_number
on conflict (invoice_id) do nothing;

do $$
declare
  v_order record;
begin
  for v_order in select id from public.reconciliation_orders order by created_at, id loop
    perform app_private.recalculate_reconciliation_order(v_order.id);
  end loop;
end;
$$;

create function public.prepare_order_invoice_upload(
  p_reconciliation_order_id uuid,
  p_invoice_type public.invoice_type,
  p_invoice_number text,
  p_invoice_date date,
  p_currency text,
  p_subtotal numeric,
  p_total numeric,
  p_lines jsonb,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_pca_original text default null,
  p_replaces_invoice_id uuid default null
)
returns table(
  invoice_id uuid, document_id uuid, version_id uuid,
  version_number integer, storage_bucket text, storage_path text,
  file_name text, mime_type text, file_size bigint,
  upload_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.reconciliation_orders%rowtype;
  v_batch public.batches%rowtype;
  v_company_id uuid;
  v_supplier_id uuid;
  v_invoice_id uuid := gen_random_uuid();
  v_document_id uuid := gen_random_uuid();
  v_prepared record;
  v_currency text := upper(nullif(btrim(p_currency), ''));
  v_number text := nullif(btrim(p_invoice_number), '');
  v_guide_count integer;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select ro.* into v_order from public.reconciliation_orders ro
  where ro.id = p_reconciliation_order_id for update;
  if not found then raise exception 'RECONCILIATION_ORDER_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_order.project_id, 'invoice.create') then
    raise exception 'PERMISSION_DENIED';
  end if;
  select b.* into v_batch from public.batches b
  where b.id = v_order.batch_id and b.project_id = v_order.project_id;
  if v_batch.status not in (
    'DRAFT','ASSEMBLING','READY_FOR_REVIEW','UNDER_REVIEW','NEEDS_CORRECTION','VALIDATED'
  ) then raise exception 'BATCH_INVOICE_NOT_EDITABLE'; end if;
  if v_number is null or char_length(v_number) > 120 then
    raise exception 'INVOICE_NUMBER_INVALID';
  end if;
  if p_invoice_date is null
     or date_trunc('month', p_invoice_date)::date <> v_batch.accounting_period then
    raise exception 'INVOICE_ACCOUNTING_PERIOD_MISMATCH';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'INVOICE_CURRENCY_INVALID';
  end if;
  if p_total is null or p_total <= 0 or p_subtotal is null
     or p_subtotal < 0 or p_subtotal > p_total then
    raise exception 'INVOICE_TOTALS_INVALID';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVOICE_LINES_REQUIRED';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) line(value)
    where jsonb_typeof(line.value) <> 'object'
       or nullif(btrim(line.value ->> 'description'), '') is null
       or jsonb_typeof(line.value -> 'quantity') is distinct from 'number'
       or (line.value ->> 'quantity')::numeric <= 0
  ) then raise exception 'INVOICE_LINE_INVALID'; end if;

  select count(*)::integer,
         case when count(distinct dg.supplier_id) = 1
           then min(dg.supplier_id::text)::uuid end
  into v_guide_count, v_supplier_id
  from public.batch_guides bg
  join public.dispatch_guides dg
    on dg.id = bg.guide_id and dg.project_id = bg.project_id
  where bg.batch_id = v_order.batch_id
    and bg.project_id = v_order.project_id
    and bg.removed_at is null
    and app_private.normalize_reconciliation_order_number(dg.order_number)
        = v_order.normalized_order_number;
  if v_guide_count = 0 then raise exception 'ORDER_GUIDES_REQUIRED'; end if;
  if v_supplier_id is null then raise exception 'ORDER_SUPPLIER_REQUIRES_REVIEW'; end if;

  if p_pca_original is not null
     and app_private.normalize_reconciliation_order_number(p_pca_original)
         <> v_order.normalized_order_number then
    raise exception 'PCA_ORDER_MISMATCH';
  end if;
  if p_replaces_invoice_id is not null and not exists (
    select 1
    from public.reconciliation_order_invoices roi
    join public.invoices i on i.id = roi.invoice_id
    where roi.reconciliation_order_id = v_order.id
      and i.id = p_replaces_invoice_id
      and i.supplier_id = v_supplier_id
      and i.invoice_type = p_invoice_type
      and i.status not in ('SUPERSEDED', 'CANCELLED')
  ) then raise exception 'REPLACED_INVOICE_CONTEXT_INVALID'; end if;

  select p.company_id into v_company_id
  from public.projects p where p.id = v_order.project_id and p.status = 'ACTIVE';
  if not found then raise exception 'BATCH_PROJECT_INACTIVE'; end if;

  insert into public.invoices(
    id, project_id, supplier_id, invoice_type, invoice_number,
    invoice_date, subtotal, total, currency, status,
    replaces_invoice_id, order_number, pca_original, created_by
  ) values (
    v_invoice_id, v_order.project_id, v_supplier_id, p_invoice_type,
    v_number, p_invoice_date, p_subtotal, p_total, v_currency,
    'REGISTERED', p_replaces_invoice_id,
    v_order.normalized_order_number, nullif(btrim(p_pca_original), ''), v_actor
  );

  insert into public.invoice_lines(
    invoice_id, line_number, code, description, quantity,
    unit_code, unit_price, line_total
  )
  select v_invoice_id, line.ordinality::integer,
    nullif(upper(btrim(coalesce(
      line.value ->> 'product_code',
      line.value ->> 'code'
    ))), ''),
    btrim(line.value ->> 'description'),
    (line.value ->> 'quantity')::numeric,
    nullif(upper(btrim(line.value ->> 'unit_code')), ''),
    case when jsonb_typeof(line.value -> 'unit_price') = 'number'
      then (line.value ->> 'unit_price')::numeric end,
    case when jsonb_typeof(line.value -> 'line_total') = 'number'
      then (line.value ->> 'line_total')::numeric end
  from jsonb_array_elements(p_lines) with ordinality line(value, ordinality);

  insert into public.reconciliation_order_invoices(
    project_id, reconciliation_order_id, invoice_id,
    assigned_by, assignment_source
  ) values (v_order.project_id, v_order.id, v_invoice_id, v_actor, 'USER');

  insert into public.guide_invoices(
    project_id, supplier_id, guide_id, invoice_id, linked_by
  )
  select v_order.project_id, v_supplier_id, dg.id, v_invoice_id, v_actor
  from public.batch_guides bg
  join public.dispatch_guides dg
    on dg.id = bg.guide_id and dg.project_id = bg.project_id
  where bg.batch_id = v_order.batch_id and bg.removed_at is null
    and app_private.normalize_reconciliation_order_number(dg.order_number)
        = v_order.normalized_order_number;

  insert into public.documents(id, project_id, category, created_by)
  values (v_document_id, v_order.project_id, 'INVOICE', v_actor);
  insert into public.invoice_documents(project_id, invoice_id, document_id, purpose)
  values (v_order.project_id, v_invoice_id, v_document_id, 'INVOICE');
  select prepared.* into v_prepared
  from app_private.prepare_document_upload_version(
    v_document_id, v_order.project_id, v_actor,
    p_file_name, p_mime_type, p_file_size
  ) prepared;

  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_order.project_id, 'invoice', v_invoice_id,
    case when p_replaces_invoice_id is null
      then 'INVOICE_ASSIGNED_TO_ORDER'
      else 'INVOICE_REPLACEMENT_ASSIGNED_TO_ORDER' end,
    jsonb_build_object(
      'reconciliation_order_id', v_order.id,
      'normalized_order_number', v_order.normalized_order_number,
      'guide_count', v_guide_count,
      'pca_original', nullif(btrim(p_pca_original), ''),
      'replaces_invoice_id', p_replaces_invoice_id,
      'document_id', v_document_id,
      'version_id', v_prepared.version_id
    )
  );
  return query select v_invoice_id, v_prepared.document_id,
    v_prepared.version_id, v_prepared.version_number,
    v_prepared.storage_bucket, v_prepared.storage_path,
    v_prepared.file_name, v_prepared.mime_type,
    v_prepared.file_size, v_prepared.upload_expires_at;
end;
$$;

alter function public.prepare_order_invoice_upload(
  uuid,public.invoice_type,text,date,text,numeric,numeric,jsonb,
  text,text,bigint,text,uuid
) owner to postgres;
revoke all on function public.prepare_order_invoice_upload(
  uuid,public.invoice_type,text,date,text,numeric,numeric,jsonb,
  text,text,bigint,text,uuid
) from public, anon;
grant execute on function public.prepare_order_invoice_upload(
  uuid,public.invoice_type,text,date,text,numeric,numeric,jsonb,
  text,text,bigint,text,uuid
) to authenticated, service_role;

-- Compatibility handoff: the Phase 9 Guide-oriented signature now resolves
-- exactly one normalized Order and delegates to the canonical Order intake.
create or replace function public.prepare_batch_invoice_upload(
  p_batch_id uuid,
  p_invoice_type public.invoice_type,
  p_invoice_number text,
  p_invoice_date date,
  p_currency text,
  p_subtotal numeric,
  p_total numeric,
  p_guide_ids uuid[],
  p_lines jsonb,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_replaces_invoice_id uuid default null
)
returns table(
  invoice_id uuid, document_id uuid, version_id uuid,
  version_number integer, storage_bucket text, storage_path text,
  file_name text, mime_type text, file_size bigint,
  upload_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_order_id uuid;
  v_context_count integer;
  v_guide_count integer;
begin
  if p_guide_ids is null or cardinality(p_guide_ids) = 0 then
    raise exception 'INVOICE_GUIDES_REQUIRED';
  end if;
  perform app_private.ensure_reconciliation_orders_for_batch(p_batch_id);
  select count(distinct ro.id)::integer,
         min(ro.id::text)::uuid,
         count(distinct bg.guide_id)::integer
  into v_context_count, v_order_id, v_guide_count
  from public.batch_guides bg
  join public.dispatch_guides dg
    on dg.id = bg.guide_id and dg.project_id = bg.project_id
  join public.reconciliation_orders ro
    on ro.batch_id = bg.batch_id and ro.project_id = bg.project_id
   and ro.normalized_order_number =
       app_private.normalize_reconciliation_order_number(dg.order_number)
  where bg.batch_id = p_batch_id and bg.removed_at is null
    and bg.guide_id = any(p_guide_ids);
  if v_context_count <> 1
     or v_guide_count <> cardinality(p_guide_ids)
     or (select count(distinct value) from unnest(p_guide_ids) value)
        <> cardinality(p_guide_ids) then
    raise exception 'INVOICE_ORDER_CONTEXT_INVALID';
  end if;
  return query select prepared.*
  from public.prepare_order_invoice_upload(
    v_order_id, p_invoice_type, p_invoice_number, p_invoice_date,
    p_currency, p_subtotal, p_total, p_lines, p_file_name,
    p_mime_type, p_file_size, null, p_replaces_invoice_id
  ) prepared;
end;
$$;

alter function public.prepare_batch_invoice_upload(
  uuid,public.invoice_type,text,date,text,numeric,numeric,uuid[],jsonb,
  text,text,bigint,uuid
) owner to postgres;
revoke all on function public.prepare_batch_invoice_upload(
  uuid,public.invoice_type,text,date,text,numeric,numeric,uuid[],jsonb,
  text,text,bigint,uuid
) from public, anon;
grant execute on function public.prepare_batch_invoice_upload(
  uuid,public.invoice_type,text,date,text,numeric,numeric,uuid[],jsonb,
  text,text,bigint,uuid
) to authenticated, service_role;

create function public.assign_invoice_to_reconciliation_order(
  p_invoice_id uuid,
  p_batch_id uuid,
  p_order_reference text,
  p_pca_original text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice public.invoices%rowtype;
  v_order public.reconciliation_orders%rowtype;
  v_normalized text := app_private.normalize_reconciliation_order_number(
    coalesce(nullif(btrim(p_pca_original), ''), p_order_reference)
  );
  v_company_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select i.* into v_invoice from public.invoices i
  where i.id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_invoice.project_id, 'invoice.match') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_normalized is null then raise exception 'ORDER_NUMBER_REQUIRED'; end if;
  perform app_private.ensure_reconciliation_orders_for_batch(p_batch_id);
  select ro.* into v_order from public.reconciliation_orders ro
  where ro.batch_id = p_batch_id
    and ro.project_id = v_invoice.project_id
    and ro.normalized_order_number = v_normalized;
  if not found then raise exception 'RECONCILIATION_ORDER_NOT_FOUND'; end if;
  if v_order.supplier_id is null or v_order.supplier_id <> v_invoice.supplier_id then
    raise exception 'INVOICE_ORDER_SUPPLIER_MISMATCH';
  end if;
  delete from public.guide_invoices where invoice_id = v_invoice.id;
  delete from public.reconciliation_order_invoices
  where invoice_id = v_invoice.id;
  insert into public.reconciliation_order_invoices(
    project_id, reconciliation_order_id, invoice_id,
    assigned_by, assignment_source
  ) values (v_order.project_id, v_order.id, v_invoice.id, v_actor, 'USER');
  insert into public.guide_invoices(
    project_id, supplier_id, guide_id, invoice_id, linked_by
  )
  select v_order.project_id, v_invoice.supplier_id, dg.id, v_invoice.id, v_actor
  from public.batch_guides bg
  join public.dispatch_guides dg on dg.id = bg.guide_id
  where bg.batch_id = v_order.batch_id and bg.removed_at is null
    and app_private.normalize_reconciliation_order_number(dg.order_number)
        = v_order.normalized_order_number;
  update public.invoices
  set order_number = v_order.normalized_order_number,
      pca_original = nullif(btrim(p_pca_original), ''),
      updated_at = now()
  where id = v_invoice.id;
  select p.company_id into v_company_id
  from public.projects p where p.id = v_order.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, new_values
  ) values (
    v_actor, v_company_id, v_order.project_id, 'invoice', v_invoice.id,
    'INVOICE_ASSIGNED_TO_ORDER',
    jsonb_build_object(
      'reconciliation_order_id', v_order.id,
      'normalized_order_number', v_order.normalized_order_number,
      'pca_original', nullif(btrim(p_pca_original), '')
    )
  );
  perform app_private.recalculate_reconciliation_order(v_order.id);
  return v_order.id;
end;
$$;

alter function public.assign_invoice_to_reconciliation_order(uuid,uuid,text,text)
owner to postgres;
revoke all on function public.assign_invoice_to_reconciliation_order(uuid,uuid,text,text)
from public, anon;
grant execute on function public.assign_invoice_to_reconciliation_order(uuid,uuid,text,text)
to authenticated, service_role;

create or replace function public.reconcile_batch_invoice(
  p_batch_id uuid,
  p_invoice_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.reconciliation_orders%rowtype;
  v_status public.order_reconciliation_status;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select ro.* into v_order
  from public.reconciliation_order_invoices roi
  join public.reconciliation_orders ro
    on ro.id = roi.reconciliation_order_id
  where roi.invoice_id = p_invoice_id and ro.batch_id = p_batch_id;
  if not found then raise exception 'INVOICE_ORDER_CONTEXT_INVALID'; end if;
  if not app_private.has_project_permission(v_order.project_id, 'invoice.match') then
    raise exception 'PERMISSION_DENIED';
  end if;
  v_status := app_private.recalculate_reconciliation_order(v_order.id);
  return jsonb_build_object(
    'reconciliation_order_id', v_order.id,
    'normalized_order_number', v_order.normalized_order_number,
    'document_status', (
      select document_status from public.reconciliation_orders where id = v_order.id
    ),
    'reconciliation_status', v_status
  );
end;
$$;

alter function public.reconcile_batch_invoice(uuid,uuid) owner to postgres;
revoke all on function public.reconcile_batch_invoice(uuid,uuid) from public, anon;
grant execute on function public.reconcile_batch_invoice(uuid,uuid)
to authenticated, service_role;

create function public.close_reconciliation_order(
  p_reconciliation_order_id uuid,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.reconciliation_orders%rowtype;
  v_company_id uuid;
  v_new_version integer;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select ro.* into v_order from public.reconciliation_orders ro
  where ro.id = p_reconciliation_order_id for update;
  if not found then raise exception 'RECONCILIATION_ORDER_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_order.project_id, 'invoice.match') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_expected_version is null or p_expected_version <> v_order.version then
    raise exception 'RECONCILIATION_ORDER_VERSION_CONFLICT';
  end if;
  if v_order.document_status = 'CLOSED' then return v_order.version; end if;
  v_new_version := v_order.version + 1;
  update public.reconciliation_orders
  set document_status = 'CLOSED', closed_at = now(), closed_by = v_actor,
      version = v_new_version, updated_at = now()
  where id = v_order.id;
  select p.company_id into v_company_id
  from public.projects p where p.id = v_order.project_id;
  insert into public.audit_events(
    actor_user_id, company_id, project_id, entity_type,
    entity_id, action, old_values, new_values
  ) values (
    v_actor, v_company_id, v_order.project_id,
    'reconciliation_order', v_order.id, 'ORDER_DOCUMENTATION_CLOSED',
    jsonb_build_object(
      'document_status', v_order.document_status,
      'version', v_order.version
    ),
    jsonb_build_object(
      'document_status', 'CLOSED',
      'version', v_new_version,
      'reconciliation_status', v_order.reconciliation_status
    )
  );
  return v_new_version;
end;
$$;

alter function public.close_reconciliation_order(uuid,integer)
owner to postgres;
revoke all on function public.close_reconciliation_order(uuid,integer)
from public, anon;
grant execute on function public.close_reconciliation_order(uuid,integer)
to authenticated, service_role;

do $$
begin
  if app_private.normalize_reconciliation_order_number('0045') <> '45'
     or app_private.normalize_reconciliation_order_number(' 45 ') <> '45'
     or app_private.normalize_reconciliation_order_number('PCA-08082026-0045') <> '45' then
    raise exception 'ORDER_NUMBER_NORMALIZATION_INVALID';
  end if;
  if has_table_privilege('authenticated', 'public.reconciliation_orders', 'INSERT')
     or has_table_privilege('authenticated', 'public.reconciliation_order_invoices', 'UPDATE')
     or has_table_privilege('authenticated', 'public.reconciliation_order_lines', 'DELETE')
     or has_function_privilege(
       'anon', 'public.prepare_order_invoice_upload(uuid,public.invoice_type,text,date,text,numeric,numeric,jsonb,text,text,bigint,text,uuid)', 'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated', 'public.close_reconciliation_order(uuid,integer)', 'EXECUTE'
     ) then raise exception 'ORDER_RECONCILIATION_SECURITY_NOT_ALIGNED'; end if;
  if exists (
    select 1 from public.reconciliation_orders ro
    group by ro.batch_id, ro.normalized_order_number having count(*) > 1
  ) then raise exception 'ORDER_RECONCILIATION_DUPLICATE_ORDER'; end if;
  if exists (
    select 1
    from public.batch_guides bg
    join public.dispatch_guides dg
      on dg.id = bg.guide_id and dg.project_id = bg.project_id
    where bg.removed_at is null
      and app_private.normalize_reconciliation_order_number(dg.order_number)
          is not null
      and not exists (
        select 1 from public.reconciliation_orders ro
        where ro.batch_id = bg.batch_id
          and ro.project_id = bg.project_id
          and ro.normalized_order_number =
            app_private.normalize_reconciliation_order_number(dg.order_number)
      )
  ) then raise exception 'ORDER_RECONCILIATION_BACKFILL_INCOMPLETE'; end if;
  if exists (
    select 1 from (
      values
        ('reconciliation_orders'),
        ('reconciliation_order_invoices'),
        ('reconciliation_order_lines')
    ) expected(table_name)
    where not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = expected.table_name
        and c.relrowsecurity = true
    )
  ) then raise exception 'ORDER_RECONCILIATION_RLS_NOT_ENABLED'; end if;
  if exists (
    select 1 from (
      values
        ('dispatch_guide_lines', 'reconciliation_sync_guide_lines'),
        ('dispatch_guides', 'reconciliation_sync_guides'),
        ('batch_guides', 'reconciliation_sync_batch_guides'),
        ('invoice_lines', 'reconciliation_sync_invoice_lines'),
        ('invoices', 'reconciliation_sync_invoices'),
        ('reconciliation_order_invoices', 'reconciliation_sync_order_invoices')
    ) expected(table_name, trigger_name)
    where not exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = expected.table_name
        and t.tgname = expected.trigger_name
        and t.tgenabled <> 'D'
        and not t.tgisinternal
    )
  ) then raise exception 'ORDER_RECONCILIATION_TRIGGER_MISSING'; end if;
end;
$$;

-- QA after manual execution:
--   * 0045 / 45 / PCA-...-0045 resolve to one Order per Batch;
--   * totals use dispatch_guide_lines.quantity, never received_quantity;
--   * multiple Guides and multiple current Invoice lines aggregate by
--     product_code + unit_code;
--   * all six comparison states, progressive upload and secondary mismatch;
--   * PRODUCT and SERVICE remain separately typed Invoice documents;
--   * replacement excludes the superseded predecessor without deleting it;
--   * close is optimistic, explicit and independent from quantity match;
--   * ambiguous legacy Invoices remain unassigned; anon/mutation grants fail;
--   * all QA rows, documents and Storage objects are rolled back cleanly.

commit;
