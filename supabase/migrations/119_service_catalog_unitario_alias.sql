-- Service catalogs: the supplier's Unitario label is another alias for Unidad (UN).
-- No historical rows, prices, guide snapshots, constraints or privileges change.
begin;

create or replace function app_private.normalize_service_catalog_unit(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when normalized_unit in ('UNIDAD', 'U', 'UNITARIO') then 'UN'
    when normalized_unit in ('KM', 'M', 'M3', 'UN', 'SERVICIO', 'COMBO', 'RECARGO', 'DOSIS/M3')
      then normalized_unit
    else null
  end
  from (
    select upper(regexp_replace(
      regexp_replace(normalize(coalesce(p_value, ''), NFKC),
        '^[[:space:]]+|[[:space:]]+$', '', 'g'),
      '[[:space:]]*/[[:space:]]*', '/', 'g'
    )) as normalized_unit
  ) normalized;
$$;

notify pgrst, 'reload schema';
commit;
