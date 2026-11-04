import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const old = await readFile(new URL("../supabase/migrations/113_service_catalog_dose_unit.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/116_service_catalog_optional_unit.sql", import.meta.url), "utf8");
const definition = source => source.match(/create or replace function public\.platform_import_project_price_catalog\([\s\S]*?\$\$;/u)?.[0];

test("116 solo relaja el valor vacío/null de la UM y conserva todas las demás reglas del RPC", () => {
  const expected = definition(old)
    .replace("         or jsonb_typeof(item->'unit_code') is distinct from 'string'", () => "         or (\n           item ? 'unit_code'\n           and jsonb_typeof(item->'unit_code') not in ('string', 'null')\n         )")
    .replace("         or app_private.normalize_service_catalog_unit(item->>'unit_code') is null", () => "         or (\n           normalize(coalesce(item->>'unit_code', ''), NFKC) !~ '^[[:space:]]*$'\n           and app_private.normalize_service_catalog_unit(item->>'unit_code') is null\n         )");
  assert.equal(definition(migration), expected);
  assert.equal(migration.match(/create or replace function/gu)?.length, 1);
  assert.doesNotMatch(migration, /alter table|create table|grant |revoke |perform public\.platform_import/iu);
  assert.match(migration, /^begin;/mu);
  assert.match(migration, /commit;\s*$/u);
});
