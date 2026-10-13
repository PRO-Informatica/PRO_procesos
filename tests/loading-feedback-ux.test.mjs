import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const delayedPending = await read("../src/components/feedback/use-delayed-pending.ts");
const loadingButton = await read("../src/components/feedback/loading-button.tsx");
const globalOverlay = await read("../src/components/feedback/global-loader-overlay.tsx");
const universalInvoices = await read("../src/features/invoices/universal/components/universal-invoices-workspace.tsx");
const universalBatches = await read("../src/features/batches/components/universal-batches-workspace.tsx");
const documentUploader = await read("../src/features/dispatches/components/document-uploader.tsx");
const programming = await read("../src/features/programming/components/programming-workspace.tsx");

test("el retraso de 180 ms afecta solo al indicador visual", () => {
  assert.match(delayedPending, /LOADING_INDICATOR_DELAY_MS = 180/u);
  assert.match(delayedPending, /window\.setTimeout[\s\S]*setVisible\(pending\)[\s\S]*pending \? delay : 0/u);
  assert.doesNotMatch(delayedPending, /await|Promise/u);
  assert.match(loadingButton, /disabled=\{pending \|\| disabled\}/u);
  assert.match(loadingButton, /aria-busy=\{pending\}/u);
  assert.match(loadingButton, /showLoading \? loadingLabel : children/u);
});

test("el overlay global evita parpadeos y los módulos prioritarios usan feedback local", () => {
  assert.match(globalOverlay, /useDelayedPending\(Boolean\(state\)\)/u);
  assert.match(universalBatches, /showDetailLoading/u);
  assert.match(universalBatches, /SkeletonBlock/u);
  assert.match(universalBatches, /detailCache\.current\.get/u);
  assert.doesNotMatch(universalBatches, /useGlobalPending|GlobalLoaderOverlay/u);
  assert.match(programming, /useDelayedPending\(pending\)/u);
});

test("Facturas Universal comunica etapas reales y evita doble ejecución", () => {
  assert.match(universalInvoices, /phaseCounts/u);
  assert.match(universalInvoices, /pendientes/u);
  assert.match(universalInvoices, /procesando/u);
  assert.match(universalInvoices, /clasificadas/u);
  assert.match(universalInvoices, /guardadas/u);
  assert.match(universalInvoices, /requieren atención/u);
  assert.match(universalInvoices, /con error/u);
  assert.match(universalInvoices, /operationPendingRef\.current/u);
  assert.match(universalInvoices, /finally \{[\s\S]*operationPendingRef\.current = false/u);
  assert.match(universalInvoices, /aria-live="polite" aria-busy=\{busy\}/u);
});

test("la carga documental conserva estado por archivo y siempre libera busy", () => {
  assert.match(documentUploader, /status: "pending" \| "uploading" \| "success" \| "error"/u);
  assert.match(documentUploader, /finally \{[\s\S]*setBusy\(false\)/u);
  assert.match(documentUploader, /if \(!selected\.length \|\| busy\) return/u);
  assert.match(documentUploader, /aria-live="polite"/u);
  assert.match(documentUploader, /motion-reduce:animate-none/u);
});
