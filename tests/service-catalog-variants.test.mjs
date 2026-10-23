import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/117_service_catalog_code_variants.sql", import.meta.url), "utf8");
const previous = await readFile(new URL("../supabase/migrations/116_service_catalog_optional_unit.sql", import.meta.url), "utf8");
const previousSearch = await readFile(new URL("../supabase/migrations/112_service_catalog_description_unit.sql", import.meta.url), "utf8");
const definition = (source, name) => source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "u"))?.[0];
const productBranch = (fn, condition) => fn.split(condition)[1].split("\n  else\n")[0];

test("117 distingue servicios por código y observaciones sin copiar estas a guías", () => {
  assert.match(migration, /drop constraint project_service_prices_project_code_key/u);
  assert.match(migration, /add column observations text/u);
  assert.match(migration, /unique nulls not distinct \(project_id, code, observations\)/u);
  assert.match(migration, /on conflict on constraint project_service_prices_project_variant_key\s+do update set price = excluded.price, description = excluded.description, unit_code = excluded.unit_code;/u);
  assert.match(migration, /existing.observations is not distinct from row_data.observations/u);
  assert.match(migration, /group by row_data.code, row_data.observations/u);
  assert.doesNotMatch(migration, /alter table public\.project_product_prices|update public\.dispatch_guide_lines|grant |revoke /u);
});

test("validación, identidad e importación de productos permanecen byte a byte iguales", () => {
  assert.equal(productBranch(definition(migration, "platform_import_project_price_catalog"), "if v_catalog_type = 'PRODUCT' then"),
    productBranch(definition(previous, "platform_import_project_price_catalog"), "if v_catalog_type = 'PRODUCT' then"));
  assert.equal(productBranch(definition(migration, "search_project_dispatch_catalog"), "if v_type = 'PRODUCT' then"),
    productBranch(definition(previousSearch, "search_project_dispatch_catalog"), "if v_type = 'PRODUCT' then"));
});

test("la búsqueda de servicios devuelve todas las variantes con orden determinista y alcance de proyecto", () => {
  const fn = definition(migration, "search_project_dispatch_catalog");
  assert.match(fn, /order by service.code, service.observations, service.id/u);
  assert.match(fn, /order by item.code, item.observations, item.id/u);
  assert.match(fn, /'observations', item.observations/u);
  assert.match(fn, /or service.observations ilike/u);
  assert.match(fn, /where service.project_id = p_project_id/u);
  assert.match(fn, /'id', item.id/u);
  assert.match(fn, /has_project_permission\(p_project_id, 'dispatch.view'\)/u);
});

test("la copia de configuración conserva un orden estable para códigos repetidos", async () => {
  const source = await readFile(new URL("../scripts/copy-ado-config-to-dev.mjs", import.meta.url), "utf8");
  assert.match(source, /order by sp.code,to_jsonb\(sp\)->>'observations'/u);
  assert.match(source, /r\.unit_code,r\.observations/u);
});

test("la guía no recibe observaciones ni las mezcla con descripción", async () => {
  const source = await readFile(new URL("../src/features/dispatches/components/dispatch-guide-dialog.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /observations|Observaciones/u);
});
