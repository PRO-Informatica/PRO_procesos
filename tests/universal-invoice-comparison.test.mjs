import assert from "node:assert/strict";
import test from "node:test";

import { parseMixtoListoInvoiceText } from "../src/features/batches/mixto-listo-parser.ts";
import { compareMixedInvoice, compareProductInvoice, compareServiceInvoice, hasReconciliationDifferences, splitMixedInvoiceTotals } from "../src/features/invoices/universal/reconciliation-comparison.ts";

const line = (subtotal, currency = "GTQ") => ({ unit_price: 1, estimated_subtotal: subtotal, currency });

test("lee el importe por renglón y verifica ambos subtotales contra el total impreso", () => {
  const invoice = parseMixtoListoInvoiceText([
    "Cantidad Medida Código Descripción Precio Unitario Total",
    '17.00 M3 86131061 CONF3001 FLUIDO 3000 PSI TNM 3/8" 1,111.04 18,887.68',
    "34.00 UN SERV0226 DOSIS RETARDANTE 10.92 371.28",
    "1.00 UN SERV0276 COMBO TRES PAREJAS DE CILINDROS 832.16 832.16",
    "16.00 M3 SERV0507 BOMBEO DE CONCRETO REGIONAL 110.32 1,765.12",
    "17.00 M3 SERV0510 COLOCACIÓN REGIONAL 134.40 2,284.80",
    "Total en letras: VEINTICUATRO MIL GTQ 24,141.04",
  ].join("\n"));

  assert.equal(invoice.lines[0].unit_price, 1111.04);
  assert.equal(invoice.lines[0].line_total, 18887.68);
  assert.match(invoice.lines[0].description, /TNM 3\/8"$/u);
  assert.deepEqual(splitMixedInvoiceTotals(invoice.lines, invoice.total), { product: 18887.68, service: 5253.36 });
  assert.equal(splitMixedInvoiceTotals(invoice.lines, 24141.05), null);
  const missingAmount = invoice.lines.map((row, index) => index === 4 ? { ...row, line_total: undefined } : row);
  assert.equal(splitMixedInvoiceTotals(missingAmount, invoice.total), null);
});

test("un total mixto que coincide conserva diferencias opuestas de Producto y Servicio", () => {
  const mixedComparison = compareMixedInvoice({ product: 18887.68, service: 5253.36 }, "GTQ", {
    product: [line("18987.6808")],
    service: [line("5153.3600")],
  });
  assert.equal(mixedComparison.product.difference, -100);
  assert.equal(mixedComparison.service.difference, 100);
  assert.equal(mixedComparison.total.matches, true);
  assert.equal(hasReconciliationDifferences({ mixedComparison }), true);
});

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
