import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateInvoiceRecipientPolicy,
  isC14BillingIdentity,
} from "../src/features/invoices/invoice-recipient-policy.ts";

const processor = await readFile(new URL("../src/features/invoices/invoice-processing.ts", import.meta.url), "utf8");
const batchActions = await readFile(new URL("../src/features/batches/actions.ts", import.meta.url), "utf8");
const universalService = await readFile(new URL("../src/features/invoices/universal/service.ts", import.meta.url), "utf8");
const universalWorkspace = await readFile(new URL("../src/features/invoices/universal/components/universal-invoices-workspace.tsx", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/096_c14_invoice_recipient_policy.sql", import.meta.url), "utf8");
const reportQuery = await readFile(new URL("../src/features/reports/queries.ts", import.meta.url), "utf8");

test("reconoce variantes determinísticas de C14 sin coincidencias parciales", () => {
  assert.equal(isC14BillingIdentity("CONSTRUCTORA CATORCE, SOCIEDAD ANÓNIMA"), true);
  assert.equal(isC14BillingIdentity("CONSTRUCTORA CATORCE, S.A."), true);
  assert.equal(isC14BillingIdentity("C14"), true);
  assert.equal(isC14BillingIdentity("CLIENTE C14 ADICIONAL"), false);
});

test("C14 se permite exclusivamente para la empresa canónica PRO-CSAL", () => {
  assert.deepEqual(evaluateInvoiceRecipientPolicy({
    billingLegalName: "CONSTRUCTORA CATORCE, S.A.",
    companyCode: "PRO-CSAL",
  }), {
    detectedIdentity: "CONSTRUCTORACATORCESA",
    isC14: true,
    allowed: true,
    requiresReinvoicing: false,
    reason: null,
  });
});

test("C14 fuera de CSAL exige refacturación", () => {
  const result = evaluateInvoiceRecipientPolicy({
    billingLegalName: "CONSTRUCTORA CATORCE, SOCIEDAD ANONIMA",
    companyCode: "PRO-ADO",
  });
  assert.equal(result.allowed, false);
  assert.equal(result.requiresReinvoicing, true);
  assert.equal(result.reason, "C14_NOT_ALLOWED_FOR_PROJECT");
});

test("una sociedad ordinaria conserva el flujo normal", () => {
  const result = evaluateInvoiceRecipientPolicy({
    billingLegalName: "INMOBILIARIA LOS ANTURIOS, S.A.",
    companyCode: "PRO-ADO",
  });
  assert.equal(result.allowed, true);
  assert.equal(result.requiresReinvoicing, false);
});

test("individual, masiva y Universal consumen el procesador compartido", () => {
  assert.match(processor, /evaluateInvoiceRecipientPolicy/u);
  assert.match(batchActions, /processInvoicePdf/u);
  assert.match(batchActions, /REQUIRES_REINVOICING/u);
  assert.match(universalService, /processExtractedInvoice/u);
  assert.match(universalService, /REQUIRES_REINVOICING/u);
});

test("Universal conserva proyecto y pedido y resume la sociedad sin duplicar mensajes", () => {
  assert.match(universalWorkspace, /C14 no está permitido para este proyecto/u);
  assert.match(universalWorkspace, /status !== "REQUIRES_REINVOICING"/u);
  assert.match(universalService, /projectId: project\.id/u);
  assert.match(universalService, /dispatchId: selectedDispatch\.id/u);
});

test("Producto C14 no CSAL nunca queda conciliado", () => {
  assert.match(migration, /when v_recipient_requires_reinvoicing then 'PENDING_REINVOICING'/u);
  assert.match(migration, /v_match := not v_recipient_requires_reinvoicing/u);
});

test("Servicio C14 no CSAL se conserva como documento no procedente", () => {
  assert.match(migration, /v_invoice\.invoice_type = 'SERVICE'/u);
  assert.match(migration, /set status = 'NON_PROCEEDING'/u);
  assert.match(migration, /current_service_invoice_id = v_service_id/u);
});

test("las diferencias ordinarias siguen requiriendo acción humana", () => {
  assert.match(migration, /when v_match then 'RECONCILED'\s+else 'WITH_DIFFERENCES'/u);
  assert.doesNotMatch(migration, /create or replace function public\.request_dispatch_reinvoicing/u);
});

test("la validación del Excel no depende de la política de facturas", () => {
  assert.doesNotMatch(reportQuery, /invoice-recipient-policy/u);
});
