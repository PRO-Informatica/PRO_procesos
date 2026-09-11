import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateInvoiceRecipientPolicy,
  isC14BillingIdentity,
} from "../src/features/invoices/invoice-recipient-policy.ts";

const processor = await readFile(new URL("../src/features/invoices/invoice-processing.ts", import.meta.url), "utf8");
const batchActions = await readFile(new URL("../src/features/batches/actions.ts", import.meta.url), "utf8");
const batchDialogs = await readFile(new URL("../src/features/batches/components/invoice-dialogs.tsx", import.meta.url), "utf8");
const batchDetail = await readFile(new URL("../src/features/batches/components/batch-detail-view.tsx", import.meta.url), "utf8");
const universalService = await readFile(new URL("../src/features/invoices/universal/service.ts", import.meta.url), "utf8");
const universalWorkspace = await readFile(new URL("../src/features/invoices/universal/components/universal-invoices-workspace.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/097_c14_recipient_exception_decision.sql", import.meta.url), "utf8");
const completionMigration = await readFile(new URL("../supabase/migrations/098_c14_exception_blocks_programming_completion.sql", import.meta.url), "utf8");
const reportQuery = await readFile(new URL("../src/features/reports/queries.ts", import.meta.url), "utf8");

test("CSAL acepta C14 sin advertencia ni excepción", () => {
  assert.deepEqual(evaluateInvoiceRecipientPolicy({
    billingLegalName: "CONSTRUCTORA CATORCE, S.A.",
    companyCode: "PRO-CSAL",
  }), {
    detectedIdentity: "CONSTRUCTORACATORCESA",
    isC14: true,
    allowed: true,
    requiresSocietyException: false,
    requiresReinvoicing: false,
    reason: null,
  });
});

test("C14 fuera de CSAL se guarda con decisión pendiente, no refacturación automática", () => {
  const result = evaluateInvoiceRecipientPolicy({ billingLegalName: "CONSTRUCTORA CATORCE, SOCIEDAD ANONIMA", companyCode: "PRO-ADO" });
  assert.equal(result.allowed, true);
  assert.equal(result.requiresSocietyException, true);
  assert.equal(result.requiresReinvoicing, false);
  assert.equal(result.reason, "C14_EXCEPTION_REQUIRES_REVIEW");
});

test("normalización reconoce variantes exactas y rechaza coincidencias parciales", () => {
  assert.equal(isC14BillingIdentity("CONSTRUCTORA CATORCE, SOCIEDAD ANÓNIMA"), true);
  assert.equal(isC14BillingIdentity("CONSTRUCTORA CATORCE, S.A."), true);
  assert.equal(isC14BillingIdentity("C14"), true);
  assert.equal(isC14BillingIdentity("CLIENTE C14 ADICIONAL"), false);
});

test("una sociedad ordinaria conserva el flujo normal", () => {
  const result = evaluateInvoiceRecipientPolicy({ billingLegalName: "INMOBILIARIA LOS ANTURIOS, S.A.", companyCode: "PRO-ADO" });
  assert.equal(result.allowed, true);
  assert.equal(result.requiresSocietyException, false);
});

test("el procesador separa excepción fiscal de refacturación y conciliación", () => {
  assert.match(processor, /recipient_exception_required/u);
  assert.match(processor, /billing_society_allowed: !recipientPolicy\.requiresSocietyException/u);
  assert.match(processor, /requires_reinvoicing: recipientPolicy\.requiresReinvoicing/u);
});

test("carga individual permite guardar la excepción pendiente", () => {
  assert.match(batchActions, /REQUIRES_RECIPIENT_EXCEPTION/u);
  assert.match(batchDialogs, /REQUIRES_RECIPIENT_EXCEPTION/u);
  assert.match(batchActions, /Factura guardada\. Compras debe aceptar la excepción C14/u);
});

test("carga masiva no concilia Producto mientras la excepción está pendiente", () => {
  assert.match(batchDialogs, /!result\.payload\.recipient_exception_required/u);
  assert.match(batchDialogs, /REQUIRES_RECIPIENT_EXCEPTION/u);
});

test("Facturas Universal conserva proyecto y despacho y expone ambas decisiones", () => {
  assert.match(universalService, /projectId: project\.id/u);
  assert.match(universalService, /dispatchId: selectedDispatch\.id/u);
  assert.match(universalWorkspace, /Aceptar excepción/u);
  assert.match(universalWorkspace, /Solicitar refacturación/u);
});

test("la excepción se persiste separada de dispatch_reconciliations", () => {
  assert.match(migration, /create table public\.invoice_recipient_exceptions/u);
  assert.match(migration, /'PENDING',[\s\S]*'APPROVED',[\s\S]*'REINVOICE_REQUESTED'/u);
  assert.match(migration, /invoice_id uuid not null unique/u);
});

test("aceptar Producto ejecuta la conciliación cuantitativa normal", () => {
  assert.match(migration, /if v_invoice\.invoice_type = 'PRODUCT' then\s+v_reconciliation_status := public\.reconcile_dispatch/u);
  assert.match(migration, /case when v_match then 'RECONCILED' else 'WITH_DIFFERENCES'/u);
});

test("solicitar refacturación de Producto cambia a PENDING_REINVOICING", () => {
  assert.match(migration, /elsif v_invoice\.invoice_type = 'PRODUCT' then[\s\S]*set status = 'PENDING_REINVOICING'/u);
});

test("solicitar refacturación de Servicio libera solo el documento de Servicio", () => {
  assert.match(migration, /else\s+update public\.invoices\s+set status = 'NON_PROCEEDING'/u);
  assert.match(migration, /app_private\.refresh_dispatch_reconciliation\(v_invoice\.dispatch_id\)/u);
});

test("las decisiones exigen permiso, quedan auditadas y la tabla tiene RLS", () => {
  assert.match(migration, /has_project_permission\(v_exception\.project_id, 'invoice\.review'\)/u);
  assert.match(migration, /INVOICE_RECIPIENT_EXCEPTION_APPROVED/u);
  assert.match(migration, /INVOICE_RECIPIENT_EXCEPTION_REINVOICE_REQUESTED/u);
  assert.match(migration, /enable row level security/u);
});

test("la vista del lote muestra la excepción y ambas acciones", () => {
  assert.match(batchDetail, /Decisión C14 pendiente/u);
  assert.match(batchDetail, /Aceptar excepción/u);
  assert.match(batchDetail, /Solicitar refacturación/u);
});

test("una excepción pendiente de Producto o Servicio impide finalizar Programación", () => {
  assert.match(completionMigration, /current_product_invoice_id/u);
  assert.match(completionMigration, /current_service_invoice_id/u);
  assert.match(completionMigration, /exception\.status = 'PENDING'/u);
});

test("la validación del Excel permanece fuera de esta política", () => {
  assert.doesNotMatch(reportQuery, /invoice-recipient-policy|recipient_exception/u);
});
