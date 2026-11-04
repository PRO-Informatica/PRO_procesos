import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const old = await readFile(new URL("../supabase/migrations/113_service_catalog_dose_unit.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/118_service_catalog_supplier_units.sql", import.meta.url), "utf8");
const definition = (source, name) => source.match(new RegExp(`create (?:or replace )?function app_private\\.${name}\\([\\s\\S]*?\\$\\$;`, "u"))?.[0];

test("118 solo agrega el alias U y M comercial; no modifica la importación, identidad por observaciones ni permisos", () => {
  assert.equal(definition(migration, "normalize_service_catalog_unit"), definition(old, "normalize_service_catalog_unit")
    .replace("create function", "create or replace function")
    .replace("normalized_unit = 'UNIDAD'", "normalized_unit in ('UNIDAD', 'U')")
    .replace("('KM', 'M3'", "('KM', 'M', 'M3'"));
  assert.match(migration, /values \('M','Metro lineal',true\)/u);
  assert.doesNotMatch(migration, /grant |revoke |update public\.|platform_import_project_price_catalog\(|search_project_dispatch_catalog\(/u);
});

test("la resolución de guías conserva todas las reglas previas y sigue prohibiendo M para productos", () => {
  assert.equal(definition(migration, "resolve_dispatch_guide_lines"), definition(old, "resolve_dispatch_guide_lines")
    .replace("v_unit not in ('KM', 'M3', 'UN', 'SERVICIO'", "v_unit not in ('KM', 'M', 'M3', 'UN', 'SERVICIO'"));
  assert.match(migration, /v_type <> 'SERVICE' and v_unit not in \('KM', 'M3', 'UN'\)/u);
  assert.match(migration, /DISPATCH_SERVICE_UNIT_MISMATCH/u);
});
