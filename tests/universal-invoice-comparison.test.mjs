import assert from "node:assert/strict";
import test from "node:test";

import { compareProductInvoice, compareServiceInvoice, hasReconciliationDifferences } from "../src/features/invoices/universal/reconciliation-comparison.ts";

const line = (subtotal, currency = "GTQ") => ({ unit_price: 1, estimated_subtotal: subtotal, currency });

test("Universal muestra las diferencias monetarias de los Servicios 106 y 147", () => {
  for (const [expected, invoiced, difference] of [[10055.22, 7776.05, -2279.17], [2121.56, 1477, -644.56]]) {
    const comparison = compareServiceInvoice([line(String(expected))], invoiced, "GTQ");
    assert.equal(comparison.expected, expected);
    assert.equal(comparison.invoiced, invoiced);
    assert.equal(comparison.difference, difference);
    assert.equal(comparison.matches, false);
    assert.equal(hasReconciliationDifferences({ comparison }), true);
  }
});

test("redondea una sola vez la suma de snapshots como PostgreSQL, sin errores de coma flotante", () => {
  const sum = compareServiceInvoice([line("0.5025"), line("0.5025")], 1.01, "GTQ");
  assert.equal(sum.expected, 1.01);
  assert.equal(sum.matches, true);
  assert.equal(compareServiceInvoice([line("50.2500")], 50.26, "GTQ").difference, 0.01);
  assert.equal(compareServiceInvoice([line("50.2500")], 50.25, "GTQ").matches, true);
});

test("no oculta estimados incompletos ni compara monedas distintas", () => {
  for (const lines of [[line(null)], [{ ...line("10.00"), unit_price: null }], [line("10.00", "USD")]]) {
    const value = compareServiceInvoice(lines, 10, "GTQ");
    assert.equal(value.matches, false); assert.equal(value.expected, null); assert.equal(value.difference, null);
  }
  assert.equal(compareServiceInvoice([line("10.00")], 10, "USD").difference, null);
  assert.equal(compareServiceInvoice([], 0, "GTQ").matches, true);
});

test("Producto conserva su comparación de cantidad y distingue unidades y base programada", () => {
  const product = { comparison_basis: "REAL_VOLUME", comparison_quantity: 7, comparison_unit_code: "M3", invoiced_quantity: 8, normalized_unit: "M3", difference: 1 };
  assert.equal(compareProductInvoice(product).difference, 1);
  assert.equal(compareProductInvoice(product).matches, false);
  assert.equal(compareProductInvoice({ ...product, invoiced_quantity: 7, difference: 0 }).matches, true);
  assert.equal(compareProductInvoice({ ...product, normalized_unit: "UN" }).difference, null);
  assert.equal(compareProductInvoice({ ...product, comparison_basis: "PROGRAMMED_QUANTITY" }).basis, "PROGRAMMED_QUANTITY");
});

test("una respuesta guardada con diferencias conserva su alerta aunque la clasificación inicial fuera READY", () => {
  assert.equal(hasReconciliationDifferences({ reconciliationStatus: "WITH_DIFFERENCES" }), true);
  assert.equal(hasReconciliationDifferences({ reconciliationStatus: "RECONCILED", comparison: compareServiceInvoice([line("10.00")], 10, "GTQ") }), false);
  assert.equal(hasReconciliationDifferences(null), false);
});
