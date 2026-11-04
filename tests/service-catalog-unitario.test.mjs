import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const old = await readFile(new URL("../supabase/migrations/118_service_catalog_supplier_units.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/119_service_catalog_unitario_alias.sql", import.meta.url), "utf8");
const definition = source => source.match(/create or replace function app_private\.normalize_service_catalog_unit\([\s\S]*?\$\$;/u)?.[0];

test("119 únicamente agrega Unitario como alias de UN, conservando unidades y configuración previa", () => {
  assert.equal(definition(migration), definition(old).replace("('UNIDAD', 'U')", "('UNIDAD', 'U', 'UNITARIO')"));
  assert.equal(migration.match(/create or replace function/gu)?.length, 1);
  assert.doesNotMatch(migration, /alter table|create table|insert into|update public\.|delete from|grant |revoke /iu);
});
