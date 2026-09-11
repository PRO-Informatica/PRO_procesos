import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const dialog = await read("../src/components/ui/dialog.tsx");
const batchDetail = await read("../src/features/batches/components/batch-detail-view.tsx");
const batchDialogs = await read("../src/features/batches/components/batch-dialogs.tsx");
const invoiceDialogs = await read("../src/features/batches/components/invoice-dialogs.tsx");
const universalBatches = await read("../src/features/batches/components/universal-batches-workspace.tsx");
const universalInvoices = await read("../src/features/invoices/universal/components/universal-invoices-workspace.tsx");

test("los diálogos respetan el viewport móvil y apilan sus acciones", () => {
  assert.match(dialog, /max-h-\[calc\(100dvh-1rem\)\]/u);
  assert.match(dialog, /overflow-y-auto overscroll-contain/u);
  assert.match(dialog, /flex-col-reverse/u);
  assert.match(dialog, /\[&>\*\]:w-full/u);
});

test("la carga masiva usa tarjetas en móvil y reserva la tabla para escritorio", () => {
  assert.match(invoiceDialogs, /divide-y divide-border lg:hidden/u);
  assert.match(invoiceDialogs, /hidden overflow-x-auto lg:block/u);
  assert.match(invoiceDialogs, /bulkRowPresentation/u);
  assert.match(invoiceDialogs, /break-all text-sm font-semibold/u);
});

test("el detalle de lote presenta despachos y acciones sin tabla horizontal en móvil", () => {
  assert.match(batchDetail, /hidden overflow-x-auto lg:block/u);
  assert.match(batchDetail, /divide-y divide-border lg:hidden/u);
  assert.match(batchDetail, /grid-cols-1 gap-3[^"]*min-\[380px\]:grid-cols-2/u);
  assert.match(batchDetail, /secondary-button w-full/u);
});

test("Lotes Universal ofrece carrusel táctil, tarjetas de ancho seguro y salto al detalle", () => {
  assert.match(universalBatches, /touch-pan-x snap-x snap-mandatory/u);
  assert.match(universalBatches, /basis-\[calc\(100%-0\.5rem\)\]/u);
  assert.match(universalBatches, /window\.matchMedia\("\(max-width: 767px\)"\)/u);
  assert.match(universalBatches, /scrollIntoView/u);
  assert.match(universalBatches, /hidden shrink-0 gap-2 sm:flex/u);
});

test("Facturas Universal reduce la zona de carga y usa acciones de ancho completo en móvil", () => {
  assert.match(universalInvoices, /min-h-32[^"]*sm:min-h-40/u);
  assert.match(universalInvoices, /Selecciona tus facturas PDF/u);
  assert.ok((universalInvoices.match(/w-full sm:w-auto/gu) ?? []).length >= 4);
  assert.match(universalInvoices, /Acepta la excepción C14 o solicita refacturación/u);
});

test("selección múltiple de despachos mantiene scroll corto y controles táctiles", () => {
  assert.match(batchDialogs, /dispatches\.length > 3/u);
  assert.match(batchDialogs, /max-h-\[13rem\] overflow-y-auto/u);
  assert.match(batchDialogs, /min-\[420px\]:flex-row/u);
  assert.match(batchDialogs, /size-5 shrink-0/u);
});
