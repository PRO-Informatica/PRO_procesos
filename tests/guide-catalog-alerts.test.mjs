import assert from "node:assert/strict";
import test from "node:test";
import { guideCatalogReviewWarnings } from "../src/features/vision-ocr/guide-draft.ts";

const warning = "Código fuera de la cotización del proyecto. Puedes guardar la guía con precio pendiente.";
const line = { productCode: "60090002", catalogType: "SERVICE", catalogItemId: "", ocrWarning: warning };

test("el resumen incluye los productos y servicios sin catálogo con su número de línea y código", () => {
  const warnings = guideCatalogReviewWarnings([
    { ...line, catalogItemId: "known" },
    line,
    { ...line, catalogType: "PRODUCT", productCode: "CON-NUEVO" },
    { ...line, productCode: " " },
  ]);
  assert.deepEqual(warnings, [`Línea 2 · Servicio 60090002: ${warning}`, `Línea 3 · Producto CON-NUEVO: ${warning}`]);
});

test("seleccionar una opción o quitar una línea elimina su alerta del resumen sin cambiar la advertencia original", () => {
  assert.equal(guideCatalogReviewWarnings([line]).length, 1);
  assert.deepEqual(guideCatalogReviewWarnings([{ ...line, catalogItemId: "selected" }]), []);
  assert.deepEqual(guideCatalogReviewWarnings([]), []);
  assert.equal(line.ocrWarning, warning);
});

test("también resume variantes pendientes y los códigos corregidos que aún no tienen selección", () => {
  assert.match(guideCatalogReviewWarnings([{ ...line, ocrWarning: "El código tiene varias opciones. Selecciona la variante." }])[0], /varias opciones/);
  assert.match(guideCatalogReviewWarnings([{ ...line, productCode: " CORREGIDO ", ocrWarning: null }])[0], /Servicio CORREGIDO: Sin precio seleccionado/);
});
