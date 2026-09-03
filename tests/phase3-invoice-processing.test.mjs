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
const actions = await readFile(new URL("../src/features/batches/actions.ts", import.meta.url), "utf8");
const processor = await readFile(new URL("../src/features/invoices/invoice-processing.ts", import.meta.url), "utf8");

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

test("conciliación usa Volumen Real y conserva intentos/refacturación", () => {
  assert.match(reconciliationMigration, /create table public\.dispatch_reconciliations/u);
  assert.match(reconciliationMigration, /create table public\.dispatch_reconciliation_attempts/u);
  assert.match(reconciliationMigration, /v_dispatch\.real_volume/u);
  assert.match(reconciliationMigration, /replaces_invoice_id/u);
  assert.match(reconciliationMigration, /current_product_invoice_id/u);
  assert.match(reconciliationMigration, /current_service_invoice_id/u);
});

test("pipeline individual y masivo consumen el mismo motor y preview no persiste", () => {
  assert.match(actions, /processInvoicePdf/u);
  assert.match(actions, /inspectDispatchInvoicePdf/u);
  assert.match(actions, /inspectBatchInvoicePdf/u);
  const previewSection = actions.slice(actions.indexOf("export async function inspectBatchInvoicePdf"), actions.indexOf("export async function saveDispatchInvoice"));
  assert.doesNotMatch(previewSection, /\.insert\(|\.update\(|\.rpc\(/u);
  assert.doesNotMatch(processor, /OCR|tesseract/iu);
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
