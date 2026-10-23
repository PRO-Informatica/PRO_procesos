import assert from "node:assert/strict";
import test from "node:test";
import { catalogSelectionDefaults } from "../src/features/dispatches/catalog-selection.ts";
import { normalizeServiceUnit } from "../src/features/platform/project-price-catalogs/service-units.ts";
import { validateDispatchGuideLines } from "../src/features/dispatches/validation.ts";

const line = { catalogType: "PRODUCT", productDescription: "CONA3000", unitCode: "M3" };
const service = { type: "SERVICE", description: "Bomba y operador", unitCode: "M3", reference: null };

test("observaciones distinguen el selector pero nunca se copian a la descripción o UM de la guía", () => {
  const selected = { ...service, observations: "Tarifa especial por doble dosis" };
  assert.deepEqual(catalogSelectionDefaults(selected, line, "KM"), { productDescription: "Bomba y operador", unitCode: "M3" });
});

test("seleccionar servicio completa su descripción y su propia UM", () => {
  assert.deepEqual(catalogSelectionDefaults(service, line, "KM"), { productDescription: "Bomba y operador", unitCode: "M3" });
  assert.deepEqual(catalogSelectionDefaults({ ...service, description: "Laboratorio", unitCode: "COMBO" }, line, "M3"), { productDescription: "Laboratorio", unitCode: "COMBO" });
  assert.deepEqual(catalogSelectionDefaults({ ...service, description: "Dosis extra de retardante", unitCode: "DOSIS/M3" }, line, "M3"), { productDescription: "Dosis extra de retardante", unitCode: "DOSIS/M3" });
});

test("cambiar de servicio reemplaza los valores del servicio anterior", () => {
  assert.deepEqual(catalogSelectionDefaults(service, { catalogType: "SERVICE", productDescription: "Otro servicio", unitCode: "KM" }, "KM"), { productDescription: "Bomba y operador", unitCode: "M3" });
});

test("servicio legado sin metadatos no inventa descripción ni hereda una UM", () => {
  assert.deepEqual(catalogSelectionDefaults({ ...service, description: null, unitCode: null }, line, "M3"), { productDescription: "", unitCode: "" });
  assert.deepEqual(catalogSelectionDefaults({ ...service, description: null, unitCode: null }, { catalogType: "SERVICE", productDescription: "Nota del usuario", unitCode: "KM" }, "M3"), { productDescription: "Nota del usuario", unitCode: "" });
});

test("productos conservan referencia y unidad de programación, ignorando campos de servicio", () => {
  assert.deepEqual(catalogSelectionDefaults({ ...service, type: "PRODUCT", reference: "CON.3003" }, line, "KM"), { productDescription: "CON.3003", unitCode: "KM" });
});

test("normaliza sin conversiones y solo servicios aceptan unidades comerciales", () => {
  assert.equal(normalizeServiceUnit(" m³ "), "M3");
  assert.equal(normalizeServiceUnit("dosis/m3"), "DOSIS/M3");
  assert.equal(normalizeServiceUnit(" Dosis / m³ "), "DOSIS/M3");
  assert.equal(normalizeServiceUnit("Unidad"), "UN");
  assert.equal(normalizeServiceUnit(" u "), "UN");
  assert.equal(normalizeServiceUnit(" Unitario "), "UN");
  assert.equal(normalizeServiceUnit("unitario"), "UN");
  assert.equal(normalizeServiceUnit("m"), "M");
  assert.equal(normalizeServiceUnit("m²"), "M2");
  assert.equal(normalizeServiceUnit(" M2 "), "M2");
  assert.equal(normalizeServiceUnit("horas"), null);
  const input = { line_id: null, quantity: 1, unit_code: "COMBO", catalog_type: "SERVICE", catalog_item_id: "id", product_description: null };
  assert.equal(validateDispatchGuideLines([input]), null);
  assert.match(validateDispatchGuideLines([{ ...input, catalog_type: "PRODUCT" }]), /UM válida/u);
  assert.equal(validateDispatchGuideLines([{ ...input, unit_code: "DOSIS/M3" }]), null);
  assert.match(validateDispatchGuideLines([{ ...input, unit_code: "DOSIS/M3", catalog_type: "PRODUCT" }]), /UM válida/u);
  assert.equal(validateDispatchGuideLines([{ ...input, unit_code: "M" }]), null);
  assert.match(validateDispatchGuideLines([{ ...input, unit_code: "M", catalog_type: "PRODUCT" }]), /UM válida/u);
  assert.deepEqual(catalogSelectionDefaults({ ...service, unitCode: "M" }, line, "M3"), { productDescription: service.description, unitCode: "M" });
  assert.equal(validateDispatchGuideLines([{ ...input, unit_code: "M2" }]), null);
  assert.match(validateDispatchGuideLines([{ ...input, unit_code: "M2", catalog_type: "PRODUCT" }]), /UM válida/u);
  assert.deepEqual(catalogSelectionDefaults({ ...service, unitCode: "M2" }, line, "M3"), { productDescription: service.description, unitCode: "M2" });
});
