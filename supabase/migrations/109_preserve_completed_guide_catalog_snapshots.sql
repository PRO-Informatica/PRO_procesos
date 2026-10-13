begin;

do $$
begin
  if to_regclass('public.dispatch_guide_lines') is null
     or to_regprocedure('app_private.sync_dispatch_guide_line_rollup()') is null then
    raise exception 'Missing completed Guide catalog snapshot prerequisites';
  end if;
end;
$$;

create or replace function app_private.sync_dispatch_guide_line_rollup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_guide_id uuid := coalesce(new.guide_id, old.guide_id);
  v_programming_unit text;
  v_count integer;
  v_total numeric(12,3);
begin
  -- Catalog replacement may only clear a foreign key. Price, code, reference,
  -- quantity and subtotal snapshots remain on the line, so no physical rollup
  -- is necessary and a completed Guide remains immutable.
  if tg_op = 'UPDATE'
     and (new.quantity, new.unit_code, new.catalog_type)
       is not distinct from
         (old.quantity, old.unit_code, old.catalog_type) then
    return null;
  end if;

  select programming.unit_code
  into v_programming_unit
  from public.dispatch_guides guide
  join public.dispatches dispatch on dispatch.id = guide.dispatch_id
  join public.programming programming on programming.id = dispatch.programming_id
  where guide.id = v_guide_id;

  if v_programming_unit is null then return null; end if;

  select count(*)::integer, sum(line.quantity)::numeric(12,3)
  into v_count, v_total
  from public.dispatch_guide_lines line
  where line.guide_id = v_guide_id
    and (line.catalog_type = 'PRODUCT' or line.catalog_type is null);

  if v_count = 0 then return null; end if;
  if exists (
    select 1 from public.dispatch_guide_lines line
    where line.guide_id = v_guide_id
      and (line.catalog_type = 'PRODUCT' or line.catalog_type is null)
      and line.unit_code is distinct from v_programming_unit
  ) then
    raise exception 'DISPATCH_PROGRAMMING_UNIT_MISMATCH';
  end if;

  update public.dispatch_guides
  set quantity = v_total, unit_code = v_programming_unit, updated_at = now()
  where id = v_guide_id;
  return null;
end;
$$;

alter function app_private.sync_dispatch_guide_line_rollup() owner to postgres;
revoke all on function app_private.sync_dispatch_guide_line_rollup()
  from public, anon, authenticated, service_role;

commit;
