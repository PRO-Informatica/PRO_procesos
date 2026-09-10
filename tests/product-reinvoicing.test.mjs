import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveInvoiceUploadSlot } from "../src/features/invoices/reinvoicing.ts";

const universalService = await readFile(new URL("../src/features/invoices/universal/service.ts", import.meta.url), "utf8");
const universalTypes = await readFile(new URL("../src/features/invoices/universal/types.ts", import.meta.url), "utf8");
const universalWorkspace = await readFile(new URL("../src/features/invoices/universal/components/universal-invoices-workspace.tsx", import.meta.url), "utf8");
const batchActions = await readFile(new URL("../src/features/batches/actions.ts", import.meta.url), "utf8");
const batchDetail = await readFile(new URL("../src/features/batches/components/batch-detail-view.tsx", import.meta.url), "utf8");
const invoiceDialogs = await readFile(new URL("../src/features/batches/components/invoice-dialogs.tsx", import.meta.url), "utf8");
const baseInvoiceMigration = await readFile(new URL("../supabase/migrations/084_phase3_dispatch_invoice_reconciliation.sql", import.meta.url), "utf8");
const universalMigration = await readFile(new URL("../supabase/migrations/090_universal_invoice_pipeline.sql", import.meta.url), "utf8");
const reinvoicingMigration = await readFile(new URL("../supabase/migrations/095_product_invoice_reinvoicing.sql", import.meta.url), "utf8");

test("Universal reconoce Producto en PENDING_REINVOICING como refacturación", () => {
  assert.match(universalService, /resolveInvoiceUploadSlot/u);
  assert.match(universalService, /operation: isReinvoicing \? "REINVOICE" : "NEW"/u);
});

test("Universal relaciona el reemplazo con la Producto vigente", () => {
  assert.match(universalService, /replacesInvoiceId: invoiceSlot\.replacesInvoiceId/u);
  assert.match(universalService, /p_replaces_invoice_id: classified\.replacesInvoiceId/u);
});

test("Universal conserva el bloqueo si hay factura activa fuera de refacturación", () => {
  assert.match(universalService, /if \(invoiceSlot\.occupied\)/u);
  assert.match(universalService, /Ya existe una Factura de/u);
});

test("la preview Universal explica el reemplazo al usuario", () => {
  assert.match(universalTypes, /operation: "NEW" \| "REINVOICE"/u);
  assert.match(universalWorkspace, /Nueva Factura de Producto · Tipo: Refacturación/u);
  assert.match(universalWorkspace, /Reemplaza la factura/u);
});

test("la carga individual identifica la refacturación sin marcarla como duplicada", () => {
  assert.match(batchActions, /const reinvoicing = invoiceSlot\.operation === "REINVOICE"/u);
  assert.match(batchActions, /const duplicate = invoiceSlot\.occupied/u);
  assert.match(batchActions, /Factura refacturada lista para reemplazar/u);
});

test("el slot de Producto pendiente permite reemplazar exclusivamente la factura vigente", () => {
  assert.deepEqual(resolveInvoiceUploadSlot({
    invoiceType: "PRODUCT",
    reconciliationStatus: "PENDING_REINVOICING",
    currentProductInvoiceId: "product-current",
    currentServiceInvoiceId: "service-current",
  }), {
    currentInvoiceId: "product-current",
    operation: "REINVOICE",
    occupied: false,
    replacesInvoiceId: "product-current",
  });
});

test("una Factura de Servicio nunca entra al flujo de refacturación de Producto", () => {
  assert.deepEqual(resolveInvoiceUploadSlot({
    invoiceType: "SERVICE",
    reconciliationStatus: "PENDING_REINVOICING",
    currentProductInvoiceId: "product-current",
    currentServiceInvoiceId: "service-current",
  }), {
    currentInvoiceId: "service-current",
    operation: "NEW",
    occupied: true,
    replacesInvoiceId: null,
  });
});

test("una Producto vigente fuera de PENDING_REINVOICING continúa bloqueada", () => {
  assert.deepEqual(resolveInvoiceUploadSlot({
    invoiceType: "PRODUCT",
    reconciliationStatus: "RECONCILED",
    currentProductInvoiceId: "product-current",
    currentServiceInvoiceId: null,
  }), {
    currentInvoiceId: "product-current",
    operation: "NEW",
    occupied: true,
    replacesInvoiceId: null,
  });
});

test("un espacio documental vacío conserva el flujo normal de factura nueva", () => {
  assert.deepEqual(resolveInvoiceUploadSlot({
    invoiceType: "PRODUCT",
    reconciliationStatus: "NOT_STARTED",
    currentProductInvoiceId: null,
    currentServiceInvoiceId: null,
  }), {
    currentInvoiceId: null,
    operation: "NEW",
    occupied: false,
    replacesInvoiceId: null,
  });
});

test("la carga masiva transmite la factura reemplazada al mismo pipeline", () => {
  assert.match(invoiceDialogs, /result\.replacesInvoiceId \?\? null/u);
  assert.match(batchActions, /p_replaces_invoice_id: effectiveReplacementId/u);
});

test("Lotes ofrece una acción contextual para cargar la Producto refacturada", () => {
  assert.match(batchDetail, /PENDING_REINVOICING/u);
  assert.match(batchDetail, /Cargar factura refacturada/u);
  assert.match(batchDetail, /type: "PRODUCT"[\s\S]*replacement: true/u);
});

test("la DB solo permite reemplazar Producto durante PENDING_REINVOICING", () => {
  assert.match(reinvoicingMigration, /new\.invoice_type <> 'PRODUCT'/u);
  assert.match(reinvoicingMigration, /v_reconciliation\.status <> 'PENDING_REINVOICING'/u);
  assert.match(reinvoicingMigration, /current_product_invoice_id is distinct from new\.replaces_invoice_id/u);
});

test("la identidad fiscal repetida continúa rechazada", () => {
  assert.match(universalService, /fiscal_document_key/u);
  assert.match(universalService, /status: "DUPLICATE"/u);
  assert.match(universalMigration, /FISCAL_DOCUMENT_ALREADY_EXISTS/u);
});

test("la factura anterior se marca SUPERSEDED solo al completar el procesamiento", () => {
  const completionStart = baseInvoiceMigration.indexOf("create function public.complete_dispatch_invoice_processing");
  const completionEnd = baseInvoiceMigration.indexOf("create function public.reconcile_dispatch", completionStart);
  const completion = baseInvoiceMigration.slice(completionStart, completionEnd);
  assert.match(completion, /insert into public\.invoice_extractions/u);
  assert.match(completion, /if v_invoice\.replaces_invoice_id is not null/u);
  assert.match(completion, /set status = 'SUPERSEDED'/u);
  assert.ok(completion.indexOf("invoice_extractions") < completion.indexOf("SUPERSEDED"));
});

test("un fallo de procesamiento excluye solo la nueva factura fallida", () => {
  const failureStart = baseInvoiceMigration.indexOf("create function public.fail_dispatch_invoice_processing");
  const failure = baseInvoiceMigration.slice(failureStart);
  assert.match(failure, /where id = v_invoice\.id/u);
  assert.match(failure, /set status = 'NON_PROCEEDING'/u);
  assert.doesNotMatch(failure, /replaces_invoice_id[\s\S]*SUPERSEDED/u);
  assert.match(failure, /refresh_dispatch_reconciliation\(v_invoice\.dispatch_id\)/u);
});

test("la Factura de Servicio se conserva independientemente", () => {
  const refreshStart = universalMigration.indexOf("create function app_private.refresh_dispatch_reconciliation");
  const refreshEnd = universalMigration.indexOf("create function app_private.sync_completed_dispatch_reconciliation", refreshStart);
  const refresh = universalMigration.slice(refreshStart, refreshEnd);
  assert.match(refresh, /invoice_type = 'SERVICE'/u);
  assert.match(refresh, /current_service_invoice_id = v_service_id/u);
  assert.doesNotMatch(reinvoicingMigration, /current_service_invoice_id\s*=/u);
});

test("la nueva Producto se reconcilia automáticamente contra Volumen Real", () => {
  assert.match(universalService, /classified\.detectedType === "PRODUCT"[\s\S]*reconcile_dispatch/u);
  assert.match(batchActions, /if \(effectiveReplacementId\)[\s\S]*reconcile_dispatch/u);
  assert.match(reinvoicingMigration, /v_difference := v_invoice_quantity - v_dispatch\.real_volume/u);
});

test("una nueva diferencia vuelve a WITH_DIFFERENCES y requiere solicitud humana", () => {
  assert.match(reinvoicingMigration, /when v_match then 'RECONCILED' else 'WITH_DIFFERENCES'/u);
  assert.match(reinvoicingMigration, /create or replace function public\.request_dispatch_reinvoicing/u);
  assert.match(batchDetail, /WITH_DIFFERENCES[\s\S]*Solicitar refacturación/u);
});
