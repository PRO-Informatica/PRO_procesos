-- 090_universal_invoice_pipeline.sql
-- Product-only reconciliation, deterministic project address identity and
-- globally idempotent fiscal invoice intake. Historical operational rows are
-- migrated in place; this migration does not delete testing data.

begin;

do $$
begin
  if to_regclass('public.projects') is null
     or to_regclass('public.invoices') is null
     or to_regclass('public.dispatch_reconciliations') is null
     or to_regprocedure('public.prepare_dispatch_invoice_upload(uuid,uuid,public.invoice_type,jsonb,text,bigint,uuid)') is null then
    raise exception 'UNIVERSAL_INVOICE_REQUIRED_CONTRACT_MISSING';
  end if;
  if exists (select 1 from public.projects where nullif(btrim(address), '') is null) then
    raise exception 'PROJECT_ADDRESS_PREFLIGHT_REQUIRED';
  end if;
end;
$$;

create or replace function app_private.normalize_address_identity(p_value text)
returns text
language sql
immutable
parallel safe
returns null on null input
set search_path = pg_catalog
as $$
  select nullif(
    btrim(
      regexp_replace(
        upper(translate(p_value, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')),
        '[^A-Z0-9]+', ' ', 'g'
      )
    ),
    ''
  );
$$;

alter table public.projects
  add column address_normalized text;
update public.projects
set address = btrim(address),
    address_normalized = app_private.normalize_address_identity(address);
alter table public.projects
  alter column address set not null,
  alter column address_normalized set not null,
  add constraint projects_address_nonempty_ck
    check (char_length(btrim(address)) between 5 and 300),
  add constraint projects_address_normalized_ck
    check (address_normalized = app_private.normalize_address_identity(address));
create index idx_projects_address_normalized
  on public.projects(address_normalized) where status = 'ACTIVE';

create function app_private.sync_project_address_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  new.address := btrim(new.address);
  new.address_normalized := app_private.normalize_address_identity(new.address);
  return new;
end;
$$;
create trigger projects_address_identity_sync
before insert or update of address on public.projects
for each row execute function app_private.sync_project_address_identity();

alter table public.invoices
  add column issuer_tax_id_normalized text,
  add column tax_authorization_number text,
  add column tax_series text,
  add column fiscal_document_key text,
  add column file_sha256 text,
  add constraint invoices_file_sha256_ck check (
    file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'
  );

with latest_extraction as (
  select distinct on (extraction.invoice_id)
    extraction.invoice_id,
    coalesce(extraction.corrected_payload, extraction.normalized_payload, '{}'::jsonb) as payload
  from public.invoice_extractions extraction
  order by extraction.invoice_id, extraction.created_at desc
), derived_identity as (
  select invoice.id,
    nullif(upper(regexp_replace(
      coalesce(latest.payload ->> 'supplier_tax_id', supplier.tax_id, ''),
      '[^0-9A-Za-z]', '', 'g'
    )), '') as issuer_tax_id_normalized,
    coalesce(
      nullif(latest.payload ->> 'authorization_number', ''),
      nullif(invoice.authorization_number, '')
    ) as tax_authorization_number,
    coalesce(
      nullif(latest.payload ->> 'series', ''),
      nullif(invoice.series, '')
    ) as tax_series
  from public.invoices invoice
  join public.suppliers supplier on supplier.id = invoice.supplier_id
  left join latest_extraction latest on latest.invoice_id = invoice.id
)
update public.invoices invoice
set issuer_tax_id_normalized = identity.issuer_tax_id_normalized,
    tax_authorization_number = identity.tax_authorization_number,
    tax_series = identity.tax_series
from derived_identity identity
where identity.id = invoice.id;

update public.invoices
set fiscal_document_key = case
  when issuer_tax_id_normalized is not null
       and nullif(upper(regexp_replace(coalesce(tax_authorization_number, ''), '[^0-9A-Za-z]', '', 'g')), '') is not null
    then concat(issuer_tax_id_normalized, ':AUTH:', upper(regexp_replace(tax_authorization_number, '[^0-9A-Za-z]', '', 'g')))
  when issuer_tax_id_normalized is not null
       and nullif(upper(regexp_replace(coalesce(tax_series, ''), '[^0-9A-Za-z]', '', 'g')), '') is not null
       and nullif(upper(regexp_replace(coalesce(invoice_number, ''), '[^0-9A-Za-z]', '', 'g')), '') is not null
    then concat(issuer_tax_id_normalized, ':SERIES:', upper(regexp_replace(tax_series, '[^0-9A-Za-z]', '', 'g')),
      ':NUMBER:', upper(regexp_replace(invoice_number, '[^0-9A-Za-z]', '', 'g')))
  else null
end;

do $$
begin
  if exists (
    select fiscal_document_key
    from public.invoices
    where fiscal_document_key is not null
    group by fiscal_document_key
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_FISCAL_IDENTITY_PREFLIGHT_REQUIRED';
  end if;
end;
$$;

create unique index invoices_fiscal_document_key_uq
  on public.invoices(fiscal_document_key)
  where fiscal_document_key is not null;
create index idx_invoices_file_sha256
  on public.invoices(file_sha256)
  where file_sha256 is not null;

alter table public.dispatch_reconciliation_attempts
  add column expected_project_address text,
  add column detected_shipping_address text,
  add column project_match_method text;

drop trigger if exists dispatch_reconciliation_lifecycle on public.dispatches;
drop function if exists app_private.sync_completed_dispatch_reconciliation();
drop function if exists app_private.refresh_dispatch_reconciliation(uuid);
drop function if exists public.reconcile_dispatch(uuid);
drop function if exists public.request_dispatch_reinvoicing(uuid,text);

alter table public.dispatch_reconciliations alter column status drop default;
alter table public.dispatch_reconciliations
  alter column status type text using status::text;
drop type public.dispatch_reconciliation_status;
create type public.dispatch_reconciliation_status as enum (
  'NOT_STARTED',
  'PENDING_RECONCILIATION',
  'WITH_DIFFERENCES',
  'PENDING_REINVOICING',
  'RECONCILED'
);
alter table public.dispatch_reconciliations
  alter column status type public.dispatch_reconciliation_status
  using (
    case status
      when 'PENDING_INVOICES' then 'NOT_STARTED'
      else status
    end
  )::public.dispatch_reconciliation_status,
  alter column status set default 'NOT_STARTED';

create function app_private.refresh_dispatch_reconciliation(p_dispatch_id uuid)
returns public.dispatch_reconciliation_status
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_reconciliation public.dispatch_reconciliations%rowtype;
  v_product_id uuid;
  v_service_id uuid;
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

  select id into v_product_id
  from public.invoices invoice
  where invoice.dispatch_id = p_dispatch_id
    and invoice.invoice_type = 'PRODUCT'
    and invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
    and exists (select 1 from public.invoice_extractions extraction where extraction.invoice_id = invoice.id)
  order by invoice.created_at desc limit 1;

  select id into v_service_id
  from public.invoices invoice
  where invoice.dispatch_id = p_dispatch_id
    and invoice.invoice_type = 'SERVICE'
    and invoice.status::text not in ('SUPERSEDED', 'CANCELLED', 'NON_PROCEEDING')
    and exists (select 1 from public.invoice_extractions extraction where extraction.invoice_id = invoice.id)
  order by invoice.created_at desc limit 1;

  v_status := case
    when v_product_id is null then 'NOT_STARTED'
    when v_product_id = v_reconciliation.current_product_invoice_id
      and v_reconciliation.status in ('RECONCILED', 'WITH_DIFFERENCES', 'PENDING_REINVOICING')
      then v_reconciliation.status
    else 'PENDING_RECONCILIATION'
  end;

  update public.dispatch_reconciliations
  set current_product_invoice_id = v_product_id,
      current_service_invoice_id = v_service_id,
      status = v_status,
      version = version + 1,
      updated_at = now()
  where id = v_reconciliation.id;
  return v_status;
end;
$$;

create function app_private.sync_completed_dispatch_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.status = 'COMPLETED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform app_private.refresh_dispatch_reconciliation(new.id);
  end if;
  return new;
end;
$$;
create trigger dispatch_reconciliation_lifecycle
after insert or update of status on public.dispatches
for each row execute function app_private.sync_completed_dispatch_reconciliation();

create function public.prepare_dispatch_invoice_upload_v2(
  p_batch_id uuid,
  p_dispatch_id uuid,
  p_invoice_type public.invoice_type,
  p_payload jsonb,
  p_file_name text,
  p_file_size bigint,
  p_replaces_invoice_id uuid default null
)
returns table(
  invoice_id uuid,
  document_id uuid,
  version_id uuid,
  storage_bucket text,
  storage_path text,
  upload_token_context text
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_row record;
  v_issuer_tax text := upper(regexp_replace(coalesce(p_payload ->> 'supplier_tax_id', ''), '[^0-9A-Za-z]', '', 'g'));
  v_authorization text := upper(regexp_replace(coalesce(p_payload ->> 'authorization_number', ''), '[^0-9A-Za-z]', '', 'g'));
  v_series text := upper(regexp_replace(coalesce(p_payload ->> 'series', ''), '[^0-9A-Za-z]', '', 'g'));
  v_invoice_number text := upper(regexp_replace(coalesce(p_payload ->> 'invoice_number', ''), '[^0-9A-Za-z]', '', 'g'));
  v_fiscal_key text;
  v_file_sha256 text := lower(nullif(btrim(p_payload ->> 'file_sha256'), ''));
begin
  if v_issuer_tax = '' then raise exception 'INVOICE_FISCAL_IDENTITY_INCOMPLETE'; end if;
  if v_authorization <> '' then
    v_fiscal_key := concat(v_issuer_tax, ':AUTH:', v_authorization);
  elsif v_series <> '' and v_invoice_number <> '' then
    v_fiscal_key := concat(v_issuer_tax, ':SERIES:', v_series, ':NUMBER:', v_invoice_number);
  else
    raise exception 'INVOICE_FISCAL_IDENTITY_INCOMPLETE';
  end if;
  if v_file_sha256 is null or v_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'INVOICE_FILE_DIGEST_INVALID';
  end if;
  if v_fiscal_key is distinct from nullif(p_payload ->> 'fiscal_document_key', '') then
    raise exception 'INVOICE_FISCAL_IDENTITY_MISMATCH';
  end if;
  if exists (select 1 from public.invoices invoice where invoice.fiscal_document_key = v_fiscal_key) then
    raise exception 'FISCAL_DOCUMENT_ALREADY_EXISTS';
  end if;

  select * into v_row
  from public.prepare_dispatch_invoice_upload(
    p_batch_id, p_dispatch_id, p_invoice_type, p_payload,
    p_file_name, p_file_size, p_replaces_invoice_id
  );

  update public.invoices
  set issuer_tax_id_normalized = v_issuer_tax,
      tax_authorization_number = nullif(p_payload ->> 'authorization_number', ''),
      tax_series = nullif(p_payload ->> 'series', ''),
      fiscal_document_key = v_fiscal_key,
      file_sha256 = v_file_sha256
  where id = v_row.invoice_id;

  return query select v_row.invoice_id, v_row.document_id, v_row.version_id,
    v_row.storage_bucket, v_row.storage_path, v_row.upload_token_context;
exception
  when unique_violation then raise exception 'FISCAL_DOCUMENT_ALREADY_EXISTS';
end;
$$;

create function public.reconcile_dispatch(p_dispatch_id uuid)
returns public.dispatch_reconciliation_status
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_dispatch public.dispatches%rowtype;
  v_reconciliation public.dispatch_reconciliations%rowtype;
  v_invoice public.invoices%rowtype;
  v_extraction public.invoice_extractions%rowtype;
  v_payload jsonb;
  v_attempt integer;
  v_invoice_quantity numeric(14,3);
  v_invoice_unit text;
  v_difference numeric(14,3);
  v_validations jsonb;
  v_match boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_dispatch from public.dispatches where id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_dispatch.project_id, 'invoice.match') then raise exception 'PERMISSION_DENIED'; end if;
  if v_dispatch.status <> 'COMPLETED' then raise exception 'DISPATCH_NOT_COMPLETED_FOR_RECONCILIATION'; end if;
  if not exists (
    select 1 from public.batch_dispatches relation
    join public.batches batch on batch.id = relation.batch_id
    where relation.dispatch_id = v_dispatch.id and relation.removed_at is null and batch.status = 'OPEN'
  ) then raise exception 'DISPATCH_ACTIVE_BATCH_REQUIRED'; end if;

  select * into v_reconciliation
  from public.dispatch_reconciliations where dispatch_id = v_dispatch.id for update;
  if not found or v_reconciliation.current_product_invoice_id is null then
    raise exception 'PRODUCT_INVOICE_REQUIRED';
  end if;
  select * into v_invoice from public.invoices where id = v_reconciliation.current_product_invoice_id;
  select extraction.* into v_extraction
  from public.invoice_extractions extraction
  where extraction.invoice_id = v_invoice.id
  order by extraction.created_at desc limit 1;
  if not found then raise exception 'PRODUCT_INVOICE_EXTRACTION_REQUIRED'; end if;

  v_payload := coalesce(v_extraction.corrected_payload, v_extraction.normalized_payload);
  v_invoice_quantity := (v_payload ->> 'invoiced_quantity')::numeric;
  v_invoice_unit := upper(v_payload ->> 'normalized_unit');
  v_difference := v_invoice_quantity - v_dispatch.real_volume;
  v_validations := coalesce(v_payload -> 'validations', '{}'::jsonb) || jsonb_build_object(
    'period_valid', coalesce((v_payload -> 'validations' ->> 'period_valid')::boolean, false),
    'unit_valid', v_invoice_unit = upper(v_dispatch.real_unit_code),
    'quantity_valid', abs(v_difference) < 0.001
  );
  v_match := coalesce((v_validations ->> 'document_valid')::boolean, false)
    and coalesce((v_validations ->> 'type_valid')::boolean, false)
    and coalesce((v_validations ->> 'project_valid')::boolean, false)
    and coalesce((v_validations ->> 'supplier_valid')::boolean, false)
    and coalesce((v_validations ->> 'order_valid')::boolean, false)
    and coalesce((v_validations ->> 'period_valid')::boolean, false)
    and coalesce((v_validations ->> 'unit_valid')::boolean, false)
    and coalesce((v_validations ->> 'quantity_valid')::boolean, false);

  select coalesce(max(attempt_number), 0) + 1 into v_attempt
  from public.dispatch_reconciliation_attempts where reconciliation_id = v_reconciliation.id;
  insert into public.dispatch_reconciliation_attempts(
    project_id, reconciliation_id, dispatch_id, product_invoice_id,
    extraction_id, attempt_number, expected_order_number,
    detected_order_number, expected_supplier_id, detected_supplier_name,
    detected_supplier_tax_id, expected_billing_legal_name,
    detected_billing_legal_name, expected_billing_tax_id,
    detected_billing_tax_id, expected_project_address,
    detected_shipping_address, project_match_method,
    expected_real_volume, expected_unit_code, invoiced_quantity,
    invoice_unit_code, difference, validations, result, executed_by
  )
  select v_dispatch.project_id, v_reconciliation.id, v_dispatch.id,
    v_invoice.id, v_extraction.id, v_attempt, v_dispatch.order_number,
    v_payload ->> 'detected_order_number', v_dispatch.supplier_id,
    v_payload ->> 'supplier_legal_name', v_payload ->> 'supplier_tax_id',
    project.billing_legal_name, v_payload ->> 'billing_legal_name',
    project.billing_tax_id, v_payload ->> 'billing_tax_id', project.address,
    v_payload ->> 'shipping_address', v_payload ->> 'project_match_method',
    v_dispatch.real_volume, v_dispatch.real_unit_code, v_invoice_quantity,
    v_invoice_unit, v_difference, v_validations,
    (case when v_match then 'MATCHED' else 'WITH_DIFFERENCES' end)::public.dispatch_reconciliation_result,
    v_actor
  from public.projects project where project.id = v_dispatch.project_id;

  update public.dispatch_reconciliations
  set status = (case when v_match then 'RECONCILED' else 'WITH_DIFFERENCES' end)::public.dispatch_reconciliation_status,
      version = version + 1, updated_at = now()
  where id = v_reconciliation.id;
  return (case when v_match then 'RECONCILED' else 'WITH_DIFFERENCES' end)::public.dispatch_reconciliation_status;
end;
$$;

create function public.request_dispatch_reinvoicing(p_dispatch_id uuid, p_reason text)
returns public.dispatch_reconciliation_status
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_reconciliation public.dispatch_reconciliations%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_reconciliation from public.dispatch_reconciliations
  where dispatch_id = p_dispatch_id for update;
  if not found then raise exception 'DISPATCH_RECONCILIATION_NOT_FOUND'; end if;
  if not app_private.has_project_permission(v_reconciliation.project_id, 'invoice.review') then raise exception 'PERMISSION_DENIED'; end if;
  if v_reconciliation.status <> 'WITH_DIFFERENCES' then raise exception 'REINVOICING_NOT_AVAILABLE'; end if;
  if v_reason is null or char_length(v_reason) > 1000 then raise exception 'REINVOICING_REASON_INVALID'; end if;
  update public.dispatch_reconciliations
  set status = 'PENDING_REINVOICING', version = version + 1, updated_at = now()
  where id = v_reconciliation.id;
  insert into public.audit_events(actor_user_id, project_id, entity_type, entity_id, action, new_values)
  values (v_actor, v_reconciliation.project_id, 'dispatch_reconciliation', v_reconciliation.id,
    'DISPATCH_REINVOICING_REQUESTED', jsonb_build_object('dispatch_id', p_dispatch_id, 'reason', v_reason));
  return 'PENDING_REINVOICING';
end;
$$;

insert into public.permissions(code, description, active)
values ('invoice.universal', 'Procesar facturas universalmente en el proyecto', true)
on conflict (code) do update set description = excluded.description, active = true;
insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role cross join public.permissions permission
where role.code = 'PURCHASING' and role.active
  and permission.code = 'invoice.universal' and permission.active
on conflict do nothing;

alter function app_private.normalize_address_identity(text) owner to postgres;
alter function app_private.sync_project_address_identity() owner to postgres;
alter function app_private.refresh_dispatch_reconciliation(uuid) owner to postgres;
alter function app_private.sync_completed_dispatch_reconciliation() owner to postgres;
alter function public.prepare_dispatch_invoice_upload_v2(uuid,uuid,public.invoice_type,jsonb,text,bigint,uuid) owner to postgres;
alter function public.reconcile_dispatch(uuid) owner to postgres;
alter function public.request_dispatch_reinvoicing(uuid,text) owner to postgres;

revoke all on function app_private.normalize_address_identity(text) from public, anon, authenticated, service_role;
revoke all on function app_private.sync_project_address_identity() from public, anon, authenticated, service_role;
revoke all on function app_private.refresh_dispatch_reconciliation(uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.sync_completed_dispatch_reconciliation() from public, anon, authenticated, service_role;
revoke all on function public.prepare_dispatch_invoice_upload(uuid,uuid,public.invoice_type,jsonb,text,bigint,uuid) from authenticated;
revoke all on function public.prepare_dispatch_invoice_upload_v2(uuid,uuid,public.invoice_type,jsonb,text,bigint,uuid) from public, anon;
revoke all on function public.reconcile_dispatch(uuid) from public, anon;
revoke all on function public.request_dispatch_reinvoicing(uuid,text) from public, anon;
grant execute on function public.prepare_dispatch_invoice_upload_v2(uuid,uuid,public.invoice_type,jsonb,text,bigint,uuid) to authenticated, service_role;
grant execute on function public.reconcile_dispatch(uuid) to authenticated, service_role;
grant execute on function public.request_dispatch_reinvoicing(uuid,text) to authenticated, service_role;

do $$
declare
  v_dispatch_id uuid;
begin
  for v_dispatch_id in
    select dispatch_id from public.dispatch_reconciliations
  loop
    perform app_private.refresh_dispatch_reconciliation(v_dispatch_id);
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from public.dispatch_reconciliations where status = 'NOT_STARTED' and current_product_invoice_id is not null) then
    raise exception 'NOT_STARTED_WITH_PRODUCT_INVOICE';
  end if;
  if not exists (
    select 1 from public.role_permissions assignment
    join public.roles role on role.id = assignment.role_id and role.code = 'PURCHASING'
    join public.permissions permission on permission.id = assignment.permission_id and permission.code = 'invoice.universal'
  ) then raise exception 'PURCHASING_UNIVERSAL_PERMISSION_MISSING'; end if;
end;
$$;

commit;
