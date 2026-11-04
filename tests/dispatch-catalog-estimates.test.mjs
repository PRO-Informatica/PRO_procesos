import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  formatDispatchMoney,
  normalizeCatalogReference,
} from "../src/features/dispatches/catalog-estimates.ts";

const migration = await readFile(
  new URL("../supabase/migrations/108_dispatch_catalog_estimates.sql", import.meta.url),
  "utf8",
);
const snapshotMigration = await readFile(
  new URL("../supabase/migrations/109_preserve_completed_guide_catalog_snapshots.sql", import.meta.url),
  "utf8",
);
const queries = await readFile(
  new URL("../src/features/dispatches/queries.ts", import.meta.url),
  "utf8",
);
const actions = await readFile(
  new URL("../src/features/dispatches/actions.ts", import.meta.url),
  "utf8",
);
const guideDialog = await readFile(
  new URL("../src/features/dispatches/components/dispatch-guide-dialog.tsx", import.meta.url),
  "utf8",
);
const catalogDialog = await readFile(
  new URL("../src/features/dispatches/components/dispatch-catalog-combobox.tsx", import.meta.url),
  "utf8",
);
const workspace = await readFile(
  new URL("../src/features/dispatches/components/dispatches-workspace.tsx", import.meta.url),
  "utf8",
);

test("normaliza la referencia sin quitar su estructura", () => {
  assert.equal(normalizeCatalogReference("  con.3003  "), "CON.3003");
  assert.equal(normalizeCatalogReference("CON.  3003"), "CON. 3003");
});

test("muestra estimaciones en quetzales", () => {
  assert.match(formatDispatchMoney(10897.6), /10[,.]897[,.]60/u);
});

test("la migración conserva precio histórico y subtotal decimal exacto", () => {
  assert.match(migration, /unit_price numeric\(18,4\)/u);
  assert.match(migration, /estimated_subtotal numeric\(22,4\) generated always/u);
  assert.match(migration, /on delete set null/u);
  assert.match(migration, /v_existing\.product_price_id = v_catalog_id/u);
  assert.match(migration, /v_existing\.unit_price/u);
  assert.match(migration, /DISPATCH_CATALOG_ITEM_NOT_FOUND/u);
  assert.match(snapshotMigration, /new\.quantity, new\.unit_code, new\.catalog_type/u);
  assert.match(snapshotMigration, /completed Guide remains immutable/u);
});

test("el servidor resuelve el precio y limita el catálogo al proyecto", () => {
  assert.match(migration, /product\.id = v_catalog_id and product\.project_id = p_project_id/u);
  assert.match(migration, /service\.id = v_catalog_id and service\.project_id = p_project_id/u);
  assert.match(migration, /search_project_dispatch_catalog/u);
  assert.match(migration, /dispatch\.view/u);
  assert.doesNotMatch(actions, /lineUnitPrice/u);
});

test("producto y servicio no se mezclan con el volumen operativo", () => {
  assert.match(migration, /line\.catalog_type = 'PRODUCT' or line\.catalog_type is null/u);
  assert.match(migration, /DISPATCH_GUIDE_OPERATIONAL_PRODUCT_REQUIRED/u);
  assert.match(migration, /DISPATCH_PROGRAMMING_UNIT_MISMATCH/u);
});

test("la primera línea puede autoseleccionarse y las adicionales quedan vacías", () => {
  assert.match(queries, /normalized_reference/u);
  assert.match(queries, /matches\.length !== 1/u);
  assert.match(guideDialog, /catalogItemId: defaultProduct\.id/u);
  assert.match(guideDialog, /emptyLine\(crypto\.randomUUID\(\)\)/u);
});

test("la UI selecciona catálogos y muestra totales independientes", () => {
  assert.match(catalogDialog, /Productos/u);
  assert.match(catalogDialog, /Servicios/u);
  assert.match(catalogDialog, /searchDispatchCatalogAction/u);
  assert.match(workspace, /Estimado productos/u);
  assert.match(workspace, /Estimado servicios/u);
  assert.match(workspace, /Estimación incompleta/u);
});
