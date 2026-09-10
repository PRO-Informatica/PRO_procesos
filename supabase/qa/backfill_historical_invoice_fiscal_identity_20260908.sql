-- Protected, idempotent backfill for the four invoices that existed before
-- 090_universal_invoice_pipeline.sql. The values were verified against the
-- original PDFs stored for each invoice.
--
-- This script intentionally updates only the legacy authorization_number and
-- series columns. Migration 090 derives the new fiscal identity columns from
-- these values without embedding environment-specific UUIDs in the migration.

begin;

create temporary table expected_historical_invoice_fiscal_identity (
  invoice_id uuid primary key,
  expected_invoice_number text not null,
  expected_issuer_tax_id text not null,
  expected_authorization_number text not null,
  expected_series text not null,
  expected_fiscal_document_key text not null
) on commit drop;

insert into expected_historical_invoice_fiscal_identity (
  invoice_id,
  expected_invoice_number,
  expected_issuer_tax_id,
  expected_authorization_number,
  expected_series,
  expected_fiscal_document_key
)
values
  (
    '64ad10fa-2488-4d86-8cf4-c895d0e7f160',
    '988300107',
    '32709-3',
    'C1AAE06B-3AE8-434B-BCC0-1ED45B5BC630',
    'C1AAE06B',
    '327093:AUTH:C1AAE06B3AE8434BBCC01ED45B5BC630'
  ),
  (
    'c55d99b3-fb22-4421-b49a-83acd10a349a',
    '2844412820',
    '32709-3',
    'BF0FA077-A98A-4B94-B714-1ED45B5ECEE5',
    'BF0FA077',
    '327093:AUTH:BF0FA077A98A4B94B7141ED45B5ECEE5'
  ),
  (
    'eb587b01-ebd3-4db5-a886-a8a46d74a10b',
    '2779072669',
    '32709-3',
    '8309A353-A5A5-489D-AF8A-1ED45B53DC3E',
    '8309A353',
    '327093:AUTH:8309A353A5A5489DAF8A1ED45B53DC3E'
  ),
  (
    '9a91504c-3355-4c89-a8f4-e9015296c457',
    '29902740',
    '32709-3',
    '77D6D114-01C8-4794-8CEE-1ED45B5BEE11',
    '77D6D114',
    '327093:AUTH:77D6D11401C847948CEE1ED45B5BEE11'
  );

do $$
declare
  expected record;
  actual record;
  expected_count integer;
begin
  select count(*) into expected_count
  from expected_historical_invoice_fiscal_identity;

  if expected_count <> 4 then
    raise exception 'HISTORICAL_FISCAL_BACKFILL_EXPECTED_FOUR_ROWS: found %', expected_count;
  end if;

  if (
    select count(distinct expected_fiscal_document_key)
    from expected_historical_invoice_fiscal_identity
  ) <> 4 then
    raise exception 'HISTORICAL_FISCAL_BACKFILL_EXPECTED_KEYS_NOT_UNIQUE';
  end if;

  for expected in
    select *
    from expected_historical_invoice_fiscal_identity
    order by invoice_id
  loop
    select
      invoice.id,
      invoice.invoice_number,
      supplier.tax_id as issuer_tax_id,
      invoice.authorization_number,
      invoice.series
    into actual
    from public.invoices invoice
    join public.suppliers supplier on supplier.id = invoice.supplier_id
    where invoice.id = expected.invoice_id
    for update of invoice;

    if not found then
      raise exception 'HISTORICAL_FISCAL_BACKFILL_INVOICE_NOT_FOUND: %', expected.invoice_id;
    end if;

    if actual.invoice_number is distinct from expected.expected_invoice_number then
      raise exception
        'HISTORICAL_FISCAL_BACKFILL_INVOICE_NUMBER_MISMATCH: invoice %, expected %, found %',
        expected.invoice_id,
        expected.expected_invoice_number,
        actual.invoice_number;
    end if;

    if actual.issuer_tax_id is distinct from expected.expected_issuer_tax_id then
      raise exception
        'HISTORICAL_FISCAL_BACKFILL_ISSUER_TAX_ID_MISMATCH: invoice %, expected %, found %',
        expected.invoice_id,
        expected.expected_issuer_tax_id,
        actual.issuer_tax_id;
    end if;

    if actual.authorization_number is not null
       and actual.authorization_number is distinct from expected.expected_authorization_number then
      raise exception
        'HISTORICAL_FISCAL_BACKFILL_AUTHORIZATION_MISMATCH: invoice %, expected %, found %',
        expected.invoice_id,
        expected.expected_authorization_number,
        actual.authorization_number;
    end if;

    if actual.series is not null
       and actual.series is distinct from expected.expected_series then
      raise exception
        'HISTORICAL_FISCAL_BACKFILL_SERIES_MISMATCH: invoice %, expected %, found %',
        expected.invoice_id,
        expected.expected_series,
        actual.series;
    end if;
  end loop;
end;
$$;

update public.invoices invoice
set authorization_number = coalesce(invoice.authorization_number, expected.expected_authorization_number),
    series = coalesce(invoice.series, expected.expected_series)
from expected_historical_invoice_fiscal_identity expected
where invoice.id = expected.invoice_id
  and (invoice.authorization_number is null or invoice.series is null);

do $$
declare
  matching_count integer;
  fiscal_identity_columns_installed boolean;
  matching_fiscal_key_count integer;
  distinct_fiscal_key_count integer;
begin
  select count(*) into matching_count
  from public.invoices invoice
  join expected_historical_invoice_fiscal_identity expected
    on expected.invoice_id = invoice.id
  where invoice.invoice_number = expected.expected_invoice_number
    and invoice.authorization_number = expected.expected_authorization_number
    and invoice.series = expected.expected_series;

  if matching_count <> 4 then
    raise exception 'HISTORICAL_FISCAL_BACKFILL_FINAL_VALUE_CHECK_FAILED: matched % of 4', matching_count;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'fiscal_document_key'
  ) into fiscal_identity_columns_installed;

  if fiscal_identity_columns_installed then
    execute $query$
      select count(*), count(distinct invoice.fiscal_document_key)
      from public.invoices invoice
      join expected_historical_invoice_fiscal_identity expected
        on expected.invoice_id = invoice.id
      where invoice.fiscal_document_key = expected.expected_fiscal_document_key
        and invoice.fiscal_document_key is not null
    $query$
    into matching_fiscal_key_count, distinct_fiscal_key_count;

    if matching_fiscal_key_count <> 4 or distinct_fiscal_key_count <> 4 then
      raise exception
        'HISTORICAL_FISCAL_BACKFILL_FINAL_KEY_CHECK_FAILED: matched %, distinct %',
        matching_fiscal_key_count,
        distinct_fiscal_key_count;
    end if;
  else
    raise notice 'Fiscal identity columns are not installed yet; migration 090 will derive and validate the four keys.';
  end if;
end;
$$;

commit;
