-- 068_quantity_only_order_reconciliation.sql
-- READY FOR MANUAL EXECUTION — NOT YET EXECUTED.
--
-- Product codes and descriptions remain visible and auditable, but no longer
-- affect reconciliation. The authority is invoiced versus dispatched
-- quantity per unit of measure. Invoice month and PCA/Order ownership continue
-- to be enforced by the existing intake pipeline.

begin;

do $$
declare
  v_signature regprocedure :=
    to_regprocedure('app_private.recalculate_reconciliation_order(uuid)');
  v_definition text;
  v_patched text;
  v_guide_select_original text := $block$
      upper(btrim(dgl.product_code)) product_code,
      dgl.unit_code,
$block$;
  v_guide_select_replacement text := $block$
      min(upper(btrim(dgl.product_code))) product_code,
      dgl.unit_code,
$block$;
  v_guide_group_original text :=
    'group by upper(btrim(dgl.product_code)), dgl.unit_code';
  v_guide_group_replacement text := 'group by dgl.unit_code';
  v_invoice_select_original text := $block$
      coalesce(upper(nullif(btrim(il.code), '')), '__MISSING__') product_code,
      il.unit_code,
$block$;
  v_invoice_select_replacement text := $block$
      min(coalesce(upper(nullif(btrim(il.code), '')), '__MISSING__')) product_code,
      il.unit_code,
$block$;
  v_invoice_group_original text :=
    'group by coalesce(upper(nullif(btrim(il.code), '''')), ''__MISSING__''), il.unit_code';
  v_invoice_group_replacement text := 'group by il.unit_code';
  v_join_original text := $block$
      on il.product_code = gl.product_code
     and il.unit_code is not distinct from gl.unit_code
$block$;
  v_join_replacement text := $block$
      on coalesce(il.unit_code, '__MISSING__')
       = coalesce(gl.unit_code, '__MISSING__')
$block$;
  v_status_original text := $block$
      when compared.product_code = '__MISSING__'
        or compared.unit_code is null
        or compared.guide_description_count > 1
        or compared.invoice_description_count > 1
        or (
          compared.guide_description is not null
          and compared.invoice_description is not null
          and lower(compared.guide_description) <> lower(compared.invoice_description)
        ) then 'REQUIRES_REVIEW'::public.order_line_reconciliation_status
$block$;
  v_status_replacement text := $block$
      when compared.unit_code is null
        then 'REQUIRES_REVIEW'::public.order_line_reconciliation_status
$block$;
  v_secondary_original text := $block$
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
$block$;
  v_secondary_replacement text := $block$
    case
      when compared.unit_code is null then '["MISSING_UNIT_CODE"]'::jsonb
      else '[]'::jsonb
    end
$block$;
begin
  if v_signature is null then
    raise exception 'ORDER_RECONCILIATION_RPC_MISSING';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;

  if position('and i.invoice_type = ''PRODUCT''' in v_definition) = 0 then
    raise exception 'ORDER_PRODUCT_ONLY_RECONCILIATION_REQUIRED';
  end if;

  if position('PRODUCT_DESCRIPTION_MISMATCH' in v_definition) = 0
     or position(v_guide_select_original in v_definition) = 0
     or position(v_invoice_select_original in v_definition) = 0 then
    raise exception 'ORDER_QUANTITY_ONLY_RECONCILIATION_ALREADY_APPLIED';
  end if;

  if position(v_status_original in v_definition) = 0
     or position(v_secondary_original in v_definition) = 0
     or position(v_guide_group_original in v_definition) = 0
     or position(v_invoice_group_original in v_definition) = 0
     or position(v_join_original in v_definition) = 0 then
    raise exception 'ORDER_QUANTITY_ONLY_RECONCILIATION_DEFINITION_DRIFT';
  end if;

  v_patched := replace(
    v_definition, v_guide_select_original, v_guide_select_replacement
  );
  v_patched := replace(
    v_patched, v_guide_group_original, v_guide_group_replacement
  );
  v_patched := replace(
    v_patched, v_invoice_select_original, v_invoice_select_replacement
  );
  v_patched := replace(
    v_patched, v_invoice_group_original, v_invoice_group_replacement
  );
  v_patched := replace(v_patched, v_join_original, v_join_replacement);
  v_patched := replace(v_patched, v_status_original, v_status_replacement);
  v_patched := replace(
    v_patched, v_secondary_original, v_secondary_replacement
  );
  execute v_patched;

  select pg_get_functiondef(v_signature) into v_definition;
  if position('PRODUCT_DESCRIPTION_MISMATCH' in v_definition) > 0
     or position(v_status_replacement in v_definition) = 0
     or position(v_guide_group_replacement in v_definition) = 0
     or position(v_invoice_group_replacement in v_definition) = 0
     or position(v_join_replacement in v_definition) = 0 then
    raise exception 'ORDER_QUANTITY_ONLY_RECONCILIATION_NOT_APPLIED';
  end if;
end;
$$;

alter function app_private.recalculate_reconciliation_order(uuid)
owner to postgres;

revoke all on function app_private.recalculate_reconciliation_order(uuid)
from public, anon, authenticated;

-- Re-evaluate existing Orders so metadata differences stop producing false
-- refactoring and quantity matches become MATCHED immediately.
do $$
declare
  v_order record;
begin
  for v_order in
    select ro.id
    from public.reconciliation_orders ro
    order by ro.created_at, ro.id
  loop
    perform app_private.recalculate_reconciliation_order(v_order.id);
  end loop;

  -- A request caused only by metadata must not remain visually active after
  -- the new quantity authority resolves the Order as MATCHED.
  update public.invoices invoice
  set status = 'UNDER_REVIEW',
      updated_at = now()
  from public.reconciliation_order_invoices relation
  join public.reconciliation_orders reconciliation_order
    on reconciliation_order.id = relation.reconciliation_order_id
  where relation.invoice_id = invoice.id
    and invoice.invoice_type = 'PRODUCT'
    and invoice.status = 'REINVOICING'
    and reconciliation_order.reconciliation_status = 'MATCHED'
    and not exists (
      select 1
      from public.invoices replacement
      where replacement.replaces_invoice_id = invoice.id
        and replacement.status not in ('SUPERSEDED', 'CANCELLED')
    );
end;
$$;

commit;
