import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveReconciliationQuantityBasis, selectValidProgrammedQuantity } from "../src/features/invoices/reconciliation-quantity.ts";

const migration = await readFile(
  new URL("../supabase/migrations/099_not_dispatched_incident_programmed_quantity.sql", import.meta.url),
  "utf8",
);
const priorMigration = await readFile(
  new URL("../supabase/migrations/097_c14_recipient_exception_decision.sql", import.meta.url),
  "utf8",
);
const batchActions = await readFile(
  new URL("../src/features/batches/actions.ts", import.meta.url),
  "utf8",
);
const universalService = await readFile(
  new URL("../src/features/invoices/universal/service.ts", import.meta.url),
  "utf8",
);
const reconciliationQuery = await readFile(
  new URL("../src/features/reconciliation/queries.ts", import.meta.url),
  "utf8",
);
const reconciliationView = await readFile(
  new URL("../src/features/reconciliation/components/reconciliation-workspace.tsx", import.meta.url),
  "utf8",
);
const batchQuery = await readFile(
  new URL("../src/features/batches/queries.ts", import.meta.url),
  "utf8",
);
const invoicePreview = await readFile(
  new URL("../src/features/batches/components/invoice-dialogs.tsx", import.meta.url),
  "utf8",
);
const invoiceProcessing = await readFile(
  new URL("../src/features/invoices/invoice-processing.ts", import.meta.url),
  "utf8",
);

test("No despachado con incidencia usa la cantidad programada", () => {
  assert.deepEqual(resolveReconciliationQuantityBasis({
    dispatchResult: "NOT_DISPATCHED",
    incidentCount: 1,
    realVolume: 0,
    realUnitCode: "M3",
    programmedQuantity: 125,
    programmedUnitCode: "M3",
  }), {
    quantity: 125,
    unitCode: "M3",
    source: "PROGRAMMED_QUANTITY",
  });
});

test("cantidad confirmada válida tiene prioridad y solicitada es respaldo", () => {
  assert.equal(selectValidProgrammedQuantity(125, 100), 125);
  assert.equal(selectValidProgrammedQuantity(null, 100), 100);
  assert.equal(selectValidProgrammedQuantity(0, 100), 100);
  assert.equal(selectValidProgrammedQuantity(null, null), null);
  assert.equal(selectValidProgrammedQuantity(0, -3), null);
});

test("No despachado sin cantidad o unidad válida no compara silenciosamente contra cero", () => {
  for (const input of [
    { programmedQuantity: null, programmedUnitCode: "M3" },
    { programmedQuantity: 0, programmedUnitCode: "M3" },
    { programmedQuantity: 125, programmedUnitCode: null },
  ]) {
    const basis = resolveReconciliationQuantityBasis({
      dispatchResult: "NOT_DISPATCHED", incidentCount: 1,
      realVolume: 0, realUnitCode: "M3", ...input,
    });
    assert.equal(basis.quantity, null);
    assert.equal(basis.source, "PROGRAMMED_QUANTITY");
  }
});

test("No despachado sin incidencia conserva el volumen real", () => {
  assert.deepEqual(resolveReconciliationQuantityBasis({
    dispatchResult: "NOT_DISPATCHED",
    incidentCount: 0,
    realVolume: 0,
    realUnitCode: "M3",
    programmedQuantity: 125,
    programmedUnitCode: "M3",
  }), {
    quantity: 0,
    unitCode: "M3",
    source: "REAL_VOLUME",
  });
});

test("Despachado con incidencia continúa usando el volumen real", () => {
  assert.deepEqual(resolveReconciliationQuantityBasis({
    dispatchResult: "DISPATCHED",
    incidentCount: 2,
    realVolume: 118,
    realUnitCode: "M3",
    programmedQuantity: 125,
    programmedUnitCode: "M3",
  }), {
    quantity: 118,
    unitCode: "M3",
    source: "REAL_VOLUME",
  });
});

test("la DB exige simultáneamente No despachado e incidencia", () => {
  assert.match(migration, /v_dispatch\.result = 'NOT_DISPATCHED'[\s\S]*exists \([\s\S]*public\.dispatch_incidents/u);
  assert.match(migration, /incident\.project_id = v_dispatch\.project_id/u);
  assert.match(migration, /incident\.reported_by is not null/u);
  assert.match(migration, /DISPATCH_INCIDENT_LIFECYCLE_REQUIRES_REVIEW/u);
  assert.match(migration, /when programming\.confirmed_quantity > 0 then programming\.confirmed_quantity/u);
  assert.match(migration, /when programming\.requested_quantity > 0 then programming\.requested_quantity/u);
  assert.match(migration, /NOT_DISPATCHED_PROGRAMMED_QUANTITY_REQUIRED/u);
  assert.match(migration, /v_difference := v_invoice_quantity - v_comparison_quantity/u);
  assert.match(migration, /case when v_match then 'RECONCILED' else 'WITH_DIFFERENCES' end/u);
});

test("099 preserva el volumen físico y persiste la base de comparación fuera de validations", () => {
  assert.match(migration, /v_dispatch\.real_volume,\s*coalesce\(v_dispatch\.real_unit_code, v_comparison_unit_code\),\s*v_comparison_quantity, v_comparison_unit_code/u);
  assert.match(migration, /comparison_quantity, comparison_unit_code, comparison_basis, invoiced_quantity/u);
  assert.match(migration, /comparison_basis in \('REAL_VOLUME', 'PROGRAMMED_QUANTITY'\)/u);
  const validations = migration.match(/v_validations := [\s\S]*?;\n  v_match/u)?.[0] ?? "";
  assert.doesNotMatch(validations, /'comparison_(?:quantity|unit_code|basis|uses_)/u);
  assert.match(migration, /update public\.dispatch_reconciliation_attempts\s+set comparison_quantity = expected_real_volume,\s+comparison_unit_code = nullif\(btrim\(expected_unit_code\), ''\),\s+comparison_basis = 'REAL_VOLUME'/u);
  assert.doesNotMatch(migration, /alter column comparison_unit_code set not null/u);
});

test("099 conserva firma, retorno y seguridad de 097", () => {
  const contract = /create or replace function public\.reconcile_dispatch\(p_dispatch_id uuid\)\s+returns public\.dispatch_reconciliation_status\s+language plpgsql\s+security definer\s+set search_path = pg_catalog, public, app_private/u;
  assert.match(priorMigration, contract);
  assert.match(migration, contract);
  assert.match(migration, /alter function public\.reconcile_dispatch\(uuid\) owner to postgres/u);
  assert.match(migration, /revoke all on function public\.reconcile_dispatch\(uuid\) from public, anon/u);
  assert.match(migration, /grant execute on function public\.reconcile_dispatch\(uuid\) to authenticated, service_role/u);
});

test("consultas y UI usan comparison_basis y comparison_quantity", () => {
  assert.match(reconciliationQuery, /comparison_quantity, comparison_unit_code, comparison_basis/u);
  assert.match(batchQuery, /comparison_quantity, comparison_unit_code, comparison_basis/u);
  assert.match(reconciliationView, /item\.comparisonSource === "PROGRAMMED_QUANTITY" \? "Cantidad programada" : "Volumen real"/u);
  assert.match(invoicePreview, /inspection\.payload\.comparison_basis === "PROGRAMMED_QUANTITY"/u);
  assert.match(invoicePreview, /inspection\.payload\.comparison_quantity/u);
  assert.match(invoiceProcessing, /expected_real_volume: context\.realVolume/u);
  assert.match(invoiceProcessing, /comparison_quantity: context\.expectedQuantity/u);
});

test("la carga individual y Universal resuelven la misma base", () => {
  assert.match(batchActions, /resolveReconciliationQuantityBasis/u);
  assert.match(batchActions, /dispatch_incidents/u);
  assert.match(universalService, /resolveReconciliationQuantityBasis/u);
  assert.match(universalService, /dispatch_incidents/u);
});
