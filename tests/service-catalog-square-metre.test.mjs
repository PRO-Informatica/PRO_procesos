import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const oldHelper = await readFile(new URL("../supabase/migrations/119_service_catalog_unitario_alias.sql", import.meta.url), "utf8");
const oldGuide = await readFile(new URL("../supabase/migrations/118_service_catalog_supplier_units.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/120_service_catalog_square_metre.sql", import.meta.url), "utf8");
const definition = (source, name) => source.match(new RegExp(`create or replace function app_private\\.${name}\\([\\s\\S]*?\\$\\$;`, "u"))?.[0];

test("120 agrega M2 sin cambiar alias Unitario, M3, precios, historial ni permisos", () => {
  assert.equal(definition(migration, "normalize_service_catalog_unit"), definition(oldHelper, "normalize_service_catalog_unit")
    .replace("('KM', 'M', 'M3'", "('KM', 'M', 'M2', 'M3'"));
  assert.match(migration, /values \('M2','Metro cuadrado',true\)/u);
  assert.doesNotMatch(migration, /grant |revoke |update public\.|delete from|alter table public\.project_product_prices/u);
});

test("M2 solo amplía las UM de servicio: productos siguen limitados a KM, M3 y UN", () => {
  assert.equal(definition(migration, "resolve_dispatch_guide_lines"), definition(oldGuide, "resolve_dispatch_guide_lines")
    .replace("v_unit not in ('KM', 'M', 'M3', 'UN', 'SERVICIO'", "v_unit not in ('KM', 'M', 'M2', 'M3', 'UN', 'SERVICIO'"));
  assert.match(migration, /v_type <> 'SERVICE' and v_unit not in \('KM', 'M3', 'UN'\)/u);
  assert.match(migration, /DISPATCH_SERVICE_UNIT_MISMATCH/u);
});
