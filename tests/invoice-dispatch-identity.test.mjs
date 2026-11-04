import assert from "node:assert/strict";
import test from "node:test";

import { dispatchProducts, matchInvoiceProducts, normalizeFullPca, sameFullPca } from "../src/features/invoices/dispatch-invoice-identity.ts";

const expected = [{ code: "86131066", reference: "CONF5001" }];
const correct = { code: "86131066", description: 'CONF5001 FLUIDO 5000 PSI TNM 3/8"' };

test("pedido 47: acepta CONF5001 y rechaza la factura CONF4001 aunque comparta pedido", () => {
  assert.equal(matchInvoiceProducts([correct], expected), "MATCH");
  assert.equal(matchInvoiceProducts([{ code: "86131064", description: 'CONF4001 FLUIDO 4000 PSI TNM 3/8"' }], expected), "MISMATCH");
});

test("el código por sí solo no valida un concreto con referencia diferente", () => {
  assert.equal(matchInvoiceProducts([{ ...correct, description: "CONF4001 FLUIDO" }], expected), "MISMATCH");
  assert.equal(matchInvoiceProducts([{ ...correct, code: "86131064" }], expected), "MISMATCH");
  assert.equal(matchInvoiceProducts([{ ...correct, description: "CONF50010 FLUIDO" }], expected), "MISMATCH");
  assert.equal(matchInvoiceProducts([{ ...correct, description: "CONF5001-ESPECIAL FLUIDO" }], expected), "MISMATCH");
});

test("solo normaliza mayúsculas, Unicode y espacios; conserva la estructura de referencias", () => {
  assert.equal(matchInvoiceProducts([{ code: " 86131066 ", description: " conf5001\u00a0FLUIDO " }], expected), "MATCH");
  assert.equal(matchInvoiceProducts([{ code: "1", description: "CON.3003 FLUIDO" }], [{ code: "1", reference: "CON.3003" }]), "MATCH");
  assert.equal(matchInvoiceProducts([{ code: "1", description: "CON3003 FLUIDO" }], [{ code: "1", reference: "CON.3003" }]), "MISMATCH");
});

test("todas las líneas de producto deben corresponder; las de servicio no se hacen pasar por concreto", () => {
  assert.equal(matchInvoiceProducts([correct, { code: "86131064", description: "CONF4001" }], expected), "MISMATCH");
  assert.equal(matchInvoiceProducts([correct, { code: "SERV0250", description: "BOMBA + OPERADOR" }], expected), "MATCH");
  assert.equal(matchInvoiceProducts([{ code: "SERV0250", description: "BOMBA + OPERADOR" }], expected), "UNVERIFIABLE");
  assert.equal(matchInvoiceProducts([correct], []), "UNVERIFIABLE");
});

test("las guías conservan su identidad histórica aun si cambia el catálogo o la programación", () => {
  assert.deepEqual(dispatchProducts([{ catalog_type: "PRODUCT", product_code: "86131066", catalog_reference: "CONF5001" }],
    ["CONF4001"], [{ code: "86131064", reference: "CONF4001" }]), expected);
});

test("el respaldo de programación exige una coincidencia única y no completa códigos arbitrarios", () => {
  assert.deepEqual(dispatchProducts([], [" conf5001 "], expected), expected);
  assert.deepEqual(dispatchProducts([], ["CONF5001"], [...expected, { code: "otro", reference: "CONF5001" }]), []);
  assert.deepEqual(dispatchProducts([], ["5000"], expected), []);
  assert.deepEqual(dispatchProducts([], [null], expected), []);
  assert.deepEqual(dispatchProducts([{ catalog_type: "PRODUCT", product_code: null, catalog_reference: "CONF5001" }], ["CONF5001"], expected), []);
});

test("servicios: el PCA completo distingue las dos parejas que terminan en 47", () => {
  assert.equal(sameFullPca("PCA-13102026-0047", "PCA-13102026-47"), true);
  assert.equal(sameFullPca("PCA-15102026-0047", "PCA-13102026-0047"), false);
  assert.equal(sameFullPca(null, null), false);
  assert.equal(sameFullPca("47", "47"), false);
  assert.equal(normalizeFullPca(" pca-13102026-0047 "), "PCA-13102026-47");
});
