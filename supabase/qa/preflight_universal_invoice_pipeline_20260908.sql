-- Read-only preflight for 090_universal_invoice_pipeline.sql.
-- Run before the migration in the target environment. It never mutates data.

select id, code, name, address,
  nullif(btrim(regexp_replace(upper(translate(address,
    'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')), '[^A-Z0-9]+', ' ', 'g')), '')
    as address_normalized
from public.projects
order by code;

select project.id, project.code,
  (select count(*) from public.programming row where row.project_id = project.id) as programming,
  (select count(*) from public.dispatches row where row.project_id = project.id) as dispatches,
  (select count(*) from public.dispatch_guides row where row.project_id = project.id) as guides,
  (select count(*) from public.batches row where row.project_id = project.id) as batches,
  (select count(*) from public.invoices row where row.project_id = project.id) as invoices,
  (select count(*) from public.dispatch_reconciliations row where row.project_id = project.id) as reconciliations,
  (select count(*) from public.documents row where row.project_id = project.id) as documents
from public.projects project
order by project.code;

select status, count(*)
from public.dispatch_reconciliations
group by status
order by status;

select project_id, order_number, count(*) as dispatch_count
from public.dispatches
where order_number is not null
group by project_id, order_number
having count(*) > 1
order by project_id, order_number;

select id, code, name
from public.projects
where nullif(btrim(address), '') is null;

select invoice.id, invoice.project_id, invoice.dispatch_id,
  invoice.invoice_number, supplier.tax_id as issuer_tax_id
from public.invoices invoice
join public.suppliers supplier on supplier.id = invoice.supplier_id
where invoice.status::text not in ('CANCELLED', 'NON_PROCEEDING')
order by invoice.created_at;

with latest_extraction as (
  select distinct on (extraction.invoice_id)
    extraction.invoice_id,
    coalesce(extraction.corrected_payload, extraction.normalized_payload, '{}'::jsonb) as payload
  from public.invoice_extractions extraction
  order by extraction.invoice_id, extraction.created_at desc
), candidate_identity as (
  select invoice.id,
    invoice.invoice_number,
    coalesce(
      nullif(latest.payload ->> 'authorization_number', ''),
      nullif(invoice.authorization_number, '')
    ) as authorization_number,
    coalesce(
      nullif(latest.payload ->> 'series', ''),
      nullif(invoice.series, '')
    ) as series,
    nullif(upper(regexp_replace(
      coalesce(latest.payload ->> 'supplier_tax_id', supplier.tax_id, ''),
      '[^0-9A-Za-z]', '', 'g'
    )), '') as issuer_tax_id_normalized
  from public.invoices invoice
  join public.suppliers supplier on supplier.id = invoice.supplier_id
  left join latest_extraction latest on latest.invoice_id = invoice.id
), candidate_key as (
  select id,
    case
      when issuer_tax_id_normalized is not null
           and nullif(upper(regexp_replace(authorization_number, '[^0-9A-Za-z]', '', 'g')), '') is not null
        then concat(
          issuer_tax_id_normalized,
          ':AUTH:', upper(regexp_replace(authorization_number, '[^0-9A-Za-z]', '', 'g'))
        )
      when issuer_tax_id_normalized is not null
           and nullif(upper(regexp_replace(series, '[^0-9A-Za-z]', '', 'g')), '') is not null
           and nullif(upper(regexp_replace(coalesce(invoice.invoice_number, ''), '[^0-9A-Za-z]', '', 'g')), '') is not null
        then concat(
          issuer_tax_id_normalized,
          ':SERIES:', upper(regexp_replace(series, '[^0-9A-Za-z]', '', 'g')),
          ':NUMBER:', upper(regexp_replace(invoice.invoice_number, '[^0-9A-Za-z]', '', 'g'))
        )
      else null
    end as fiscal_document_key
  from candidate_identity invoice
)
select fiscal_document_key, count(*) as occurrences, array_agg(id order by id) as invoice_ids
from candidate_key
where fiscal_document_key is not null
group by fiscal_document_key
having count(*) > 1
order by fiscal_document_key;
