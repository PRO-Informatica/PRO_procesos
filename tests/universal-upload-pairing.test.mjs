import assert from "node:assert/strict";
import test from "node:test";

import { classifyProductFirst, uploadedProductForService } from "../src/features/invoices/universal/upload-pairing.ts";

const product = { result: { detectedType: "PRODUCT", status: "READY", projectId: "ado", orderNumber: "47", pcaOriginal: "PCA-13102026-0047", dispatchId: "dispatch-5001" } };
const service = { result: { detectedType: "SERVICE", status: "REQUIRES_PRODUCT_VALIDATION", projectId: "ado", orderNumber: "47", pcaOriginal: "PCA-13102026-0047", dispatchId: null } };
const otherProduct = { result: { ...product.result, pcaOriginal: "PCA-15102026-0047", dispatchId: "dispatch-4001" } };
const otherService = { result: { ...service.result, pcaOriginal: "PCA-15102026-0047" } };

test("empareja Producto/Servicio en la misma carga aunque Servicios aparezcan antes", () => {
  const uploads = [otherService, service, otherProduct, product];
  assert.equal(uploadedProductForService(service, uploads), product);
  assert.equal(uploadedProductForService(otherService, uploads), otherProduct);
  assert.equal(uploadedProductForService(product, uploads), null);
});

test("no empareja por el 47 si cambia el PCA, el proyecto o el pedido", () => {
  for (const changes of [{ projectId: "cer" }, { orderNumber: "48" }, { pcaOriginal: "PCA-15102026-0047" }, { pcaOriginal: null }]) {
    assert.equal(uploadedProductForService(service, [{ result: { ...product.result, ...changes } }]), null);
  }
});

test("un Producto rechazado, sin despacho o con error no valida Servicios", () => {
  for (const status of ["PRODUCT_MISMATCH", "DISPATCH_AMBIGUOUS", "DISPATCH_IDENTITY_UNVERIFIED", "ERROR", "DUPLICATE"]) {
    assert.equal(uploadedProductForService(service, [{ result: { ...product.result, status } }]), null);
  }
  assert.equal(uploadedProductForService(service, [{ result: { ...product.result, dispatchId: null } }]), null);
});

test("dos Productos con el mismo PCA requieren resolver la ambigüedad, no elegir el primero", () => {
  assert.equal(uploadedProductForService(service, [product, { result: { ...product.result, dispatchId: "otro" } }]), null);
  assert.equal(uploadedProductForService(service, []), null);
  assert.equal(uploadedProductForService({ result: null }, [product]), null);
});

test("identifica tipos primero, valida cada Producto en orden y solo después procesa Servicios", async () => {
  // Services come first in the upload. Product that has no dispatch comes
  // before the valid Product; neither condition can change processing order.
  const uploads = [
    { id: "servicio-bueno", result: service.result },
    { id: "producto-sin-despacho", result: otherProduct.result },
    { id: "servicio-otro", result: otherService.result },
    { id: "producto-bueno", result: product.result },
  ];
  const events = [], inspected = new Set();
  const results = await classifyProductFirst(uploads, uploads, {
    async identify(upload) {
      await Promise.resolve();
      inspected.add(upload.id);
      events.push(`identify:${upload.id}`);
      return { ...upload, result: { ...upload.result, status: "IDENTIFIED", dispatchId: null } };
    },
    async classify(upload, companion) {
      assert.equal(inspected.size, 4, "no se busca ningún despacho durante la identificación");
      events.push(`classify:${upload.id}:${companion?.id ?? "sin-pareja"}`);
      return { ...upload, result: { ...upload.result,
        status: upload.id === "producto-sin-despacho" ? "DISPATCH_NOT_FOUND"
          : upload.id === "servicio-otro" ? "REQUIRES_PRODUCT_VALIDATION" : "READY",
        dispatchId: upload.id === "producto-bueno" || companion ? "dispatch-5001" : null } };
    },
    onStage(stage) { events.push(`stage:${stage}`); },
  });
  assert.deepEqual(events.filter(event => event.startsWith("classify:")), [
    "classify:producto-sin-despacho:sin-pareja",
    "classify:producto-bueno:sin-pareja",
    "classify:servicio-bueno:producto-bueno",
    "classify:servicio-otro:sin-pareja",
  ]);
  assert.deepEqual(events.filter(event => event.startsWith("stage:")), ["stage:IDENTIFYING", "stage:PRODUCTS", "stage:SERVICES"]);
  assert.equal(results.find(upload => upload.id === "servicio-bueno").result.status, "READY");
});

test("un error de identificación no se reintenta como Producto ni vincula un Servicio", async () => {
  const uploads = [{ id: "producto", result: product.result }, { id: "servicio", result: service.result }];
  const calls = [];
  await classifyProductFirst(uploads, uploads, {
    async identify(upload) {
      return { ...upload, result: { ...upload.result, status: upload.id === "producto" ? "ERROR" : "IDENTIFIED" } };
    },
    async classify(upload, companion) {
      calls.push([upload.id, companion]);
      return { ...upload, result: { ...upload.result, status: "REQUIRES_PRODUCT_VALIDATION" } };
    },
    onStage() {},
  });
  assert.deepEqual(calls, [["servicio", null]]);
});

test("resolver solo un Servicio conserva los Productos ya clasificados de esa misma carga", async () => {
  const goodProduct = { id: "producto", result: product.result };
  const pendingService = { id: "servicio", result: service.result };
  const calls = [];
  await classifyProductFirst([pendingService], [goodProduct, pendingService], {
    async identify(upload) { return { ...upload, result: { ...upload.result, status: "IDENTIFIED" } }; },
    async classify(upload, companion) { calls.push(companion?.id); return upload; },
    onStage() {},
  });
  assert.deepEqual(calls, ["producto"]);
});
