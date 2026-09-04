import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  orderNumberFromMixtoListoPca,
  parseMixtoListoInvoiceText,
} from "../src/features/batches/mixto-listo-parser.ts";

const batchMigration = await readFile(new URL("../supabase/migrations/083_phase3_batch_dispatch_membership.sql", import.meta.url), "utf8");
const reconciliationMigration = await readFile(new URL("../supabase/migrations/084_phase3_dispatch_invoice_reconciliation.sql", import.meta.url), "utf8");
const cleanupMigration = await readFile(new URL("../supabase/migrations/085_phase3_legacy_cleanup.sql", import.meta.url), "utf8");
const reconciliationStatusFix = await readFile(new URL("../supabase/migrations/086_fix_dispatch_reconciliation_status_cast.sql", import.meta.url), "utf8");
const purchasingInvoiceReviewGrant = await readFile(new URL("../supabase/migrations/087_grant_invoice_review_to_purchasing.sql", import.meta.url), "utf8");
const actions = await readFile(new URL("../src/features/batches/actions.ts", import.meta.url), "utf8");
const processor = await readFile(new URL("../src/features/invoices/invoice-processing.ts", import.meta.url), "utf8");
const dispatchQueries = await readFile(new URL("../src/features/dispatches/queries.ts", import.meta.url), "utf8");
const dispatchDetail = await readFile(new URL("../src/features/dispatches/components/dispatch-detail-view.tsx", import.meta.url), "utf8");
const invoiceDialogs = await readFile(new URL("../src/features/batches/components/invoice-dialogs.tsx", import.meta.url), "utf8");
const dashboardQueries = await readFile(new URL("../src/features/dashboard/queries.ts", import.meta.url), "utf8");

const productInvoice = `
MEZCLADORA S.A.
NIT: 32709-3
NÚMERO: 4710-001
FECHA 01 09 2026
NOMBRE O RAZÓN SOCIAL: LAS CAMPANELAS, S. A.
NIT: 04038325-5
CANTIDAD MEDIDA CÓDIGO DESCRIPCIÓN
20 M3 1001 CONCRETO 4000 PSI 100.00 2000.00
3 m³ 1002 CONCRETO COLUMNAS 100.00 300.00
1 UNI SERV001 BOMBEO 50.00 50.00
OBSERVACIONES: PCA-29052026-0091
SUBTOTAL: GTQ 2350.00
TOTAL: GTQ 2350.00
`;

const serviceInvoice = `
MEZCLADORA, S.A.
NIT: 32709-3
NÚMERO: 29902740
FECHA 02 09 2026
NOMBRE O RAZÓN SOCIAL: INMOBILIARIA LOS ANTURIOS, SOCIEDAD ANÓNIMA
NIT: 111871344
CANTIDAD MEDIDA CÓDIGO DESCRIPCIÓN PRECIO UNITARIO TOTAL
159.00 M3 SERV0250 BOMBA + OPERADOR ( M³) 80.64 12,821.76
159.00 M3 SERV0253 GRUPO COLOCACIÓN EQUIPOS NUESTROS 93.80 14,914.20
TOTAL EN LETRAS: VEINTISIETE MIL SETECIENTOS TREINTA Y CINCO QUETZALES CON 96/100 GTQ 27,735.96
OBSERVACIONES: PCA-01092026-0021
`;

test("extrae el pedido operativo del último correlativo PCA", () => {
  assert.equal(orderNumberFromMixtoListoPca("PCA-29052026-0091"), "91");
});

test("extrae múltiples líneas y normaliza M³ sin confundir servicio", () => {
  const parsed = parseMixtoListoInvoiceText(productInvoice);
  assert.equal(parsed.invoice_number, "4710-001");
  assert.equal(parsed.pca_original, "PCA-29052026-0091");
  assert.deepEqual(parsed.lines.map((line) => line.unit_code), ["M3", "M3", "UNI"]);
  assert.equal(parsed.lines[0].quantity + parsed.lines[1].quantity, 23);
  assert.equal(parsed.billing_legal_name, "LAS CAMPANELAS, S. A.");
  assert.equal(parsed.supplier_tax_id, "32709-3");
});

test("extrae el total final de una factura de servicio con separador de miles", () => {
  const parsed = parseMixtoListoInvoiceText(serviceInvoice);
  assert.equal(parsed.total, 27735.96);
  assert.equal(parsed.currency, "GTQ");
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.supplier_legal_name, "MEZCLADORA, S.A.");
  assert.equal(parsed.billing_legal_name, "INMOBILIARIA LOS ANTURIOS, SOCIEDAD ANÓNIMA");
});

test("un PDF con dos números de factura queda detectable como inválido", () => {
  const parsed = parseMixtoListoInvoiceText(`${productInvoice}\nNÚMERO: 4710-002\n`);
  assert.equal(parsed.detected_invoice_numbers.length, 2);
});

test("Lote usa despacho y mantiene una sola relación activa", () => {
  assert.match(batchMigration, /create table public\.batch_dispatches/u);
  assert.match(batchMigration, /unique index batch_dispatches_one_active_batch_uq/u);
  assert.match(batchMigration, /where removed_at is null/u);
  assert.doesNotMatch(batchMigration, /update public\.dispatches\s+set status/iu);
});

test("Dashboard desambigua la pertenencia del despacho al lote", () => {
  assert.match(dashboardQueries, /members:batch_dispatches!batch_dispatches_batch_project_fk/u);
  assert.match(dashboardQueries, /current\.members/u);
  assert.doesNotMatch(dashboardQueries, /status, batch_dispatches\(id, removed_at\)/u);
});

test("conciliación usa Volumen Real y conserva intentos/refacturación", () => {
  assert.match(reconciliationMigration, /create table public\.dispatch_reconciliations/u);
  assert.match(reconciliationMigration, /create table public\.dispatch_reconciliation_attempts/u);
  assert.match(reconciliationMigration, /v_dispatch\.real_volume/u);
  assert.match(reconciliationMigration, /replaces_invoice_id/u);
  assert.match(reconciliationMigration, /current_product_invoice_id/u);
  assert.match(reconciliationMigration, /current_service_invoice_id/u);
  assert.match(reconciliationStatusFix, /end\)::public\.dispatch_reconciliation_status/u);
});

test("Compras puede solicitar refacturación sin ampliar otros permisos", () => {
  assert.match(purchasingInvoiceReviewGrant, /r\.code = 'PURCHASING'/u);
  assert.match(purchasingInvoiceReviewGrant, /p\.code = 'invoice\.review'/u);
  assert.match(purchasingInvoiceReviewGrant, /on conflict do nothing/u);
  assert.doesNotMatch(purchasingInvoiceReviewGrant, /invoice\.(create|match)'/u);
  assert.match(reconciliationMigration, /has_project_permission\(\s*v_reconciliation\.project_id, 'invoice\.review'/u);
});

test("pipeline individual y masivo consumen el mismo motor y preview no persiste", () => {
  assert.match(actions, /processInvoicePdf/u);
  assert.match(actions, /inspectDispatchInvoicePdf/u);
  assert.match(actions, /inspectBatchInvoicePdf/u);
  const previewSection = actions.slice(actions.indexOf("export async function inspectBatchInvoicePdf"), actions.indexOf("export async function saveDispatchInvoice"));
  assert.doesNotMatch(previewSection, /\.insert\(|\.update\(|\.rpc\(/u);
  assert.doesNotMatch(processor, /OCR|tesseract/iu);
});

test("carga masiva acumula, permite quitar y valida proyecto antes del pedido", () => {
  assert.match(invoiceDialogs, /return \[\.\.\.current, \.\.\.additions\]/u);
  assert.match(invoiceDialogs, /removeFile\(row\.key\)/u);
  assert.match(invoiceDialogs, /label=\{row\.saved \? "La factura ya fue guardada" : `Quitar \$\{row\.file\.name\} de la carga`\}/u);
  assert.match(invoiceDialogs, /!row\.saved && result\?\.payload/u);
  assert.match(invoiceDialogs, /Pedido \$\{orderNumber \?\? "sin número"\}/u);
  assert.match(invoiceDialogs, /Las facturas de este grupo se asociarán al despacho/u);
  assert.match(invoiceDialogs, /Sin destino asignado/u);
  assert.match(invoiceDialogs, /Archivo PDF/u);
  assert.match(invoiceDialogs, /formatInvoiceTotal\(payload\.total, payload\.currency\)/u);
  const previewSection = actions.slice(actions.indexOf("export async function inspectBatchInvoicePdf"), actions.indexOf("export async function saveDispatchInvoice"));
  assert.ok(previewSection.indexOf("matchesFiscalIdentity") < previewSection.indexOf("orderNumberFromMixtoListoPca"));
  assert.match(previewSection, /La factura no pertenece al proyecto actual/u);
});

test("ambos pipelines persisten el total y el despacho muestra dos tarjetas con datos extraídos", () => {
  assert.match(actions, /p_payload: processed\.payload/u);
  assert.match(reconciliationMigration, /v_total := \(p_payload ->> 'total'\)::numeric/u);
  assert.match(reconciliationMigration, /subtotal, total, currency/u);
  assert.match(dispatchQueries, /invoice_date, status, subtotal, total, currency/u);
  assert.match(dispatchQueries, /supplier_legal_name/u);
  assert.match(dispatchDetail, /Factura de producto/u);
  assert.match(dispatchDetail, /Factura de servicio/u);
  assert.match(dispatchDetail, /Total extraído de la factura/u);
  assert.match(dispatchDetail, /getInvoiceDownloadUrl/u);
});

test("la limpieza elimina las fuentes legacy de guía/pedido", () => {
  assert.match(cleanupMigration, /pg_catalog\.pg_trigger/u);
  assert.match(cleanupMigration, /pg_catalog\.pg_depend/u);
  assert.match(cleanupMigration, /audit_reconciliation_order_completion/u);
  assert.match(cleanupMigration, /review_invoice/u);
  assert.doesNotMatch(cleanupMigration, /drop function[^;]*cascade/iu);
  assert.match(cleanupMigration, /drop table if exists public\.batch_guides/u);
  assert.match(cleanupMigration, /drop table if exists public\.reconciliation_orders/u);
  assert.match(cleanupMigration, /alter table public\.dispatch_guides drop column order_number/u);
  assert.match(cleanupMigration, /alter table public\.dispatch_guides drop column supplier_id/u);
});
