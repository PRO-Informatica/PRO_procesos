import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as identity from "../src/features/invoices/dispatch-invoice-identity.ts";
import * as classification from "../src/features/invoices/invoice-classification.ts";
import * as fiscal from "../src/features/invoices/invoice-identity.ts";
import * as recipient from "../src/features/invoices/invoice-recipient-policy.ts";
import * as quantity from "../src/features/invoices/reconciliation-quantity.ts";
import * as reinvoicing from "../src/features/invoices/reinvoicing.ts";
import * as parser from "../src/features/batches/mixto-listo-parser.ts";
import * as business from "../src/lib/business-identity.ts";
import * as address from "../src/lib/address-identity.ts";
import * as pairing from "../src/features/invoices/universal/upload-pairing.ts";

async function compile(path) {
  return ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const serviceCode = await compile("../src/features/invoices/universal/service.ts");
const processorCode = await compile("../src/features/invoices/invoice-processing.ts");
const queriesCode = await compile("../src/features/invoices/dispatch-invoice-identity-queries.ts");

function load(code, imports) {
  const exports = {};
  runInNewContext(code, { exports, Uint8Array, require(name) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected import ${name}`);
    return imports[name];
  } });
  return exports;
}
const queries = load(queriesCode, { "server-only": {}, "./dispatch-invoice-identity": identity });
const product = { quantity: 15.5, unit_code: "M3", code: "86131066", description: 'CONF5001 FLUIDO 5000 PSI TNM 3/8"' };
const wrongProduct = { quantity: 8, unit_code: "M3", code: "86131064", description: 'CONF4001 FLUIDO 4000 PSI TNM 3/8"' };
const serviceLine = { quantity: 15.5, unit_code: "M3", code: "SERV0250", description: "BOMBA + OPERADOR ( M³)" };

function fixture({ lines = [product], pca = "PCA-13102026-0047", savedProduct = false, savedLines = [product], secondDispatch = false,
  sameConcrete = false, queryFailure = "", expectedCode = product.code, expectedReference = "CONF5001", authorized = true } = {}) {
  const projectId = "project-ado", dispatchId = "dispatch-ado", batchId = "batch-ado";
  const raw = { invoice_number: lines[0]?.code.startsWith("SERV") ? "187584486" : "853688342", invoice_date: "2026-10-14",
    currency: "GTQ", subtotal: 20120.24, total: 20120.24, pca_original: pca, lines, detected_invoice_numbers: ["one"],
    supplier_legal_name: "MEZCLADORA, S.A.", supplier_tax_id: "32709-3", billing_legal_name: "LAS CAMPANELAS, SOCIEDAD ANONIMA",
    billing_tax_id: "106650653", shipping_address: "1 CALLE ZONA 1 QUETZALTENANGO", authorization_number: "AA-BB-CC", series: "S1" };
  const scopes = authorized ? [{ project: { id: projectId, status: "ACTIVE", code: "ADO-PRO", name: "ADO", companyCode: "PRO-ADO",
    address: raw.shipping_address, billingLegalName: raw.billing_legal_name, billingTaxId: raw.billing_tax_id, timezone: "America/Guatemala" },
    permissions: ["invoice.universal", "invoice.view", "invoice.create", "invoice.match"] }] : [];
  const dispatch = { id: dispatchId, project_id: projectId, programming_id: "programming-ado", supplier_id: "supplier-ado",
    order_number: "47", real_volume: 15.5, real_unit_code: "M3", status: "COMPLETED", result: "DISPATCHED" };
  const tables = {
    dispatches: [dispatch],
    project_product_prices: [{ id: "price-1", project_id: projectId, code: expectedCode, reference: expectedReference }],
    dispatch_guides: [{ id: "guide-1", project_id: projectId, dispatch_id: dispatchId }],
    dispatch_guide_lines: [{ id: "line-1", project_id: projectId, guide_id: "guide-1", catalog_type: "PRODUCT", product_code: expectedCode, catalog_reference: expectedReference }],
    programming_lines: [{ id: "pl-1", programming_id: dispatch.programming_id, concrete_type: expectedReference }],
    dispatch_reconciliations: [{ dispatch_id: dispatchId, project_id: projectId, current_product_invoice_id: savedProduct ? "invoice-product" : null,
      current_service_invoice_id: null, status: "NOT_STARTED" }],
    invoices: savedProduct ? [{ id: "invoice-product", project_id: projectId, dispatch_id: dispatchId, invoice_type: "PRODUCT", invoice_number: "previous-product",
      status: "REGISTERED", pca_original: "PCA-13102026-0047", fiscal_document_key: "another-fiscal-key" }] : [],
    invoice_lines: savedProduct ? savedLines.map((line, index) => ({ id: `il-${index}`, invoice_id: "invoice-product", ...line })) : [],
    batch_dispatches: [{ id: "bd-1", project_id: projectId, dispatch_id: dispatchId, batch_id: batchId, removed_at: null }],
    batches: [{ id: batchId, status: "OPEN", code: "LOT-TEST", accounting_period: "2026-10-01" }],
    programming: [{ id: dispatch.programming_id, project_id: projectId, requested_quantity: 15.5, confirmed_quantity: null, unit_code: "M3" }],
    dispatch_incidents: [], suppliers: [{ id: dispatch.supplier_id, name: raw.supplier_legal_name, tax_id: raw.supplier_tax_id }],
  };
  if (secondDispatch) {
    const secondCode = sameConcrete ? product.code : wrongProduct.code;
    const secondReference = sameConcrete ? "CONF5001" : "CONF4001";
    tables.dispatches.push({ ...dispatch, id: "dispatch-other", programming_id: "programming-other" });
    tables.dispatch_guides.push({ id: "guide-2", project_id: projectId, dispatch_id: "dispatch-other" });
    tables.dispatch_guide_lines.push({ id: "line-2", project_id: projectId, guide_id: "guide-2", catalog_type: "PRODUCT", product_code: secondCode, catalog_reference: secondReference });
    tables.programming.push({ ...tables.programming[0], id: "programming-other" });
    tables.batch_dispatches.push({ id: "bd-2", project_id: projectId, dispatch_id: "dispatch-other", batch_id: batchId, removed_at: null });
  }
  const reads = [], writes = [], authorizations = [];
  const uploadedRaw = new Map();
  const admin = { from(table) {
    const filters = [], spec = { table, filters };
    let range, single = false, limit, head = false;
    const query = {
      select(_columns, options) { head = options?.head ?? false; return query; },
      eq(key, value) { filters.push(["eq", key, value]); return query; },
      in(key, value) { filters.push(["in", key, value]); return query; },
      is(key, value) { filters.push(["is", key, value]); return query; },
      order() { return query; }, limit(value) { limit = value; return query; },
      range(from, to) { range = [from, to]; return query; },
      maybeSingle() { single = true; return query; },
      then(resolve, reject) {
        reads.push(spec);
        const rows = (tables[table] ?? []).filter(row => filters.every(([op, key, value]) => op === "in" ? value.includes(row[key]) : op === "is" && value === null ? row[key] == null : row[key] === value));
        const selected = range ? rows.slice(range[0], range[1] + 1) : limit ? rows.slice(0, limit) : rows;
        return Promise.resolve({ data: head ? null : single ? selected[0] ?? null : selected,
          error: queryFailure === table ? { message: "unavailable" } : null, count: rows.length }).then(resolve, reject);
      },
    };
    return query;
  } };
  const processor = load(processorCode, {
    "server-only": {}, "@/features/batches/mixto-listo-extractor": {}, "@/features/batches/mixto-listo-parser": parser,
    "@/lib/business-identity": business, "@/lib/address-identity": address, "./invoice-classification": classification,
    "./dispatch-invoice-identity": identity, "./invoice-identity": fiscal, "./invoice-recipient-policy": recipient,
    "@/features/batches/period-policy": { evaluateInvoicePeriod: () => ({ valid: true, graceUsed: false }), projectCalendarDate: () => "2026-10-23" },
  });
  const api = load(serviceCode, {
    "server-only": {}, "node:crypto": { createHash },
    "@/features/batches/mixto-listo-extractor": { extractMixtoListoInvoicePdf: async (buffer) => uploadedRaw.get(new TextDecoder().decode(buffer)) ?? raw },
    "@/features/auth/queries": { requireActiveProfile: async () => ({ id: "user" }) },
    "@/features/projects/queries": { getOperationalProjectAccess: async () => { authorizations.push("authorized"); return scopes; } },
    "@/lib/address-identity": address, "@/lib/business-identity": business,
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/supabase/server": { createClient() { writes.push("createClient"); throw new Error("Unexpected persistence"); } },
    "../invoice-classification": classification, "../dispatch-invoice-identity": identity,
    "../dispatch-invoice-identity-queries": queries, "../invoice-identity": fiscal,
    "../invoice-processing": processor, "../reconciliation-quantity": quantity, "../reinvoicing": reinvoicing,
    "./upload-pairing": pairing,
  });
  const file = new File(["synthetic PDF"], "invoice.pdf", { type: "application/pdf" });
  function upload(name, overrides = {}) {
    uploadedRaw.set(name, { ...raw, ...overrides });
    return new File([name], `${name}.pdf`, { type: "application/pdf" });
  }
  return { api, file, reads, writes, tables, processor, raw, upload, authorizations };
}

test("clasifica el producto correcto y rechaza CONF4001 antes de preparar documentos", async () => {
  const good = fixture();
  const accepted = await good.api.classifyUniversalInvoice(good.file);
  assert.equal(accepted.status, "READY"); assert.equal(accepted.dispatchId, "dispatch-ado");
  assert.equal(accepted.pcaOriginal, "PCA-13102026-0047");
  const bad = fixture({ lines: [wrongProduct], pca: "PCA-15102026-0047" });
  const blocked = await bad.api.commitUniversalInvoice(bad.file, { projectId: "project-ado", dispatchId: "dispatch-ado" });
  assert.equal(blocked.status, "PRODUCT_MISMATCH"); assert.equal(blocked.dispatchId, null); assert.equal(blocked.saved, false);
  assert.equal(bad.writes.length, 0);
});

test("identificación inicial solo devuelve tipo y pedido, sin consultas de despacho ni resultado listo", async () => {
  for (const lines of [[product], [serviceLine]]) {
    const f = fixture({ lines });
    const result = await f.api.identifyUniversalInvoice(f.file);
    assert.equal(result.status, "IDENTIFIED");
    assert.equal(result.orderNumber, "47");
    assert.equal(result.detectedType, lines[0].code.startsWith("SERV") ? "SERVICE" : "PRODUCT");
    assert.equal(result.dispatchId, null);
    assert.equal(f.reads.length, 0);
    assert.equal(f.writes.length, 0);
    assert.equal("fileSha256" in result, false);
    assert.equal("payload" in result, false);
  }
});

test("identificar no evita autorización del proyecto", async () => {
  const f = fixture({ authorized: false });
  assert.equal((await f.api.identifyUniversalInvoice(f.file)).status, "ERROR");
  assert.equal(f.reads.length, 0);
  assert.equal(f.writes.length, 0);
});

test("dos despachos del mismo pedido se desambiguan por código y referencia, nunca por posición", async () => {
  const f = fixture({ secondDispatch: true, lines: [wrongProduct] });
  assert.equal((await f.api.classifyUniversalInvoice(f.file)).dispatchId, "dispatch-other");
  const manual = await f.api.commitUniversalInvoice(f.file, { dispatchId: "dispatch-ado" });
  assert.equal(manual.saved, false); assert.equal(manual.dispatchId, null); assert.equal(f.writes.length, 0);
});

test("guardar vuelve a verificar la identidad si una guía cambió después de clasificar", async () => {
  const f = fixture();
  assert.equal((await f.api.classifyUniversalInvoice(f.file)).status, "READY");
  f.tables.dispatch_guide_lines[0].catalog_reference = "CONF4001";
  const result = await f.api.commitUniversalInvoice(f.file, { dispatchId: "dispatch-ado" });
  assert.equal(result.status, "PRODUCT_MISMATCH");
  assert.equal(result.saved, false);
  assert.equal(f.writes.length, 0);
});

test("una selección manual no acepta un código compartido con referencia equivocada", async () => {
  const f = fixture({ expectedReference: "CONF4001" });
  const result = await f.api.commitUniversalInvoice(f.file, { dispatchId: "dispatch-ado" });
  assert.equal(result.status, "PRODUCT_MISMATCH");
  assert.equal(result.saved, false);
  assert.equal(f.writes.length, 0);
});

test("si pedido, código y referencia aún coinciden en dos despachos no selecciona arbitrariamente", async () => {
  const f = fixture({ secondDispatch: true, sameConcrete: true });
  const ambiguous = await f.api.classifyUniversalInvoice(f.file);
  assert.equal(ambiguous.status, "DISPATCH_AMBIGUOUS"); assert.equal(ambiguous.dispatchId, null);
  assert.equal(ambiguous.candidateDispatches.length, 2);
  assert.match(ambiguous.candidateDispatches[0].label, /CONF5001/u);
});

test("servicios no se asocian al 47 sin producto validado, ni forzando selección", async () => {
  const f = fixture({ lines: [serviceLine] });
  const result = await f.api.commitUniversalInvoice(f.file, { dispatchId: "dispatch-ado" });
  assert.equal(result.status, "REQUIRES_PRODUCT_VALIDATION"); assert.equal(result.saved, false);
  assert.equal(result.dispatchId, null); assert.equal(f.writes.length, 0);
});

test("clasifica Producto y Servicio de la misma carga sin guardar previamente ninguno", async () => {
  const f = fixture({ lines: [serviceLine] });
  const productFile = f.upload("producto", { lines: [product], invoice_number: "853688342" });
  const result = await f.api.classifyUniversalInvoice(f.file, undefined, productFile);
  assert.equal(result.status, "READY");
  assert.equal(result.dispatchId, "dispatch-ado");
  assert.equal(f.tables.invoices.length, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(f.authorizations.length, 1, "la autorización solo se comparte dentro de la misma solicitud, no entre usuarios ni peticiones");
});

test("el servidor no confía en un Producto acompañante con otro concreto o PCA", async () => {
  for (const overrides of [
    { lines: [wrongProduct] },
    { lines: [product], pca_original: "PCA-15102026-0047" },
    { lines: [serviceLine] },
    { lines: [product], shipping_address: "OTRA OBRA" },
    { lines: [product], supplier_tax_id: "999999" },
    { lines: [product], total: null },
  ]) {
    const f = fixture({ lines: [serviceLine] });
    const productFile = f.upload("acompañante", overrides);
    const result = await f.api.commitUniversalInvoice(f.file, { dispatchId: "dispatch-ado" }, productFile);
    assert.equal(result.status, "REQUIRES_PRODUCT_VALIDATION", JSON.stringify(overrides));
    assert.equal(result.saved, false);
    assert.equal(f.writes.length, 0);
  }
});

test("la pareja de la misma carga resuelve dos despachos con el mismo número de pedido", async () => {
  const f = fixture({ lines: [serviceLine], secondDispatch: true });
  const firstProduct = f.upload("producto-5001", { lines: [product] });
  const secondProduct = f.upload("producto-4001", { lines: [wrongProduct], pca_original: "PCA-15102026-0047" });
  const secondService = f.upload("servicio-15", { pca_original: "PCA-15102026-0047" });
  const first = await f.api.classifyUniversalInvoice(f.file, undefined, firstProduct);
  const second = await f.api.classifyUniversalInvoice(secondService, undefined, secondProduct);
  assert.equal(first.dispatchId, "dispatch-ado");
  assert.equal(second.dispatchId, "dispatch-other");
  assert.equal(first.status, "READY");
  assert.equal(second.status, "READY");
  assert.equal(f.writes.length, 0);
});

test("la carga acompañante no permite forzar el Servicio a un despacho diferente", async () => {
  const f = fixture({ lines: [serviceLine], secondDispatch: true });
  const productFile = f.upload("producto", { lines: [product] });
  const result = await f.api.commitUniversalInvoice(f.file, { dispatchId: "dispatch-other" }, productFile);
  assert.equal(result.saved, false);
  assert.equal(result.dispatchId, null);
  assert.equal(f.writes.length, 0);
});

test("una selección explícita válida del Producto también resuelve el Servicio de esa carga", async () => {
  const f = fixture({ lines: [serviceLine], secondDispatch: true, sameConcrete: true });
  const productFile = f.upload("producto", { lines: [product] });
  assert.equal((await f.api.classifyUniversalInvoice(productFile)).status, "DISPATCH_AMBIGUOUS");
  const result = await f.api.classifyUniversalInvoice(f.file, { dispatchId: "dispatch-other" }, productFile);
  assert.equal(result.status, "READY");
  assert.equal(result.dispatchId, "dispatch-other");
  assert.equal(f.writes.length, 0);
});

test("guardar Servicio revalida el Producto acompañante si la guía cambió", async () => {
  const f = fixture({ lines: [serviceLine] });
  const productFile = f.upload("producto", { lines: [product] });
  assert.equal((await f.api.classifyUniversalInvoice(f.file, undefined, productFile)).status, "READY");
  f.tables.dispatch_guide_lines[0].catalog_reference = "CONF4001";
  const result = await f.api.commitUniversalInvoice(f.file, { dispatchId: "dispatch-ado" }, productFile);
  assert.equal(result.status, "REQUIRES_PRODUCT_VALIDATION");
  assert.equal(result.saved, false);
  assert.equal(f.writes.length, 0);
});

test("la selección automática empareja los cuatro archivos del 47 sin importar el orden", async () => {
  const f = fixture({ lines: [serviceLine] });
  const productFile = f.upload("producto-bueno", { lines: [product] });
  const wrongFile = f.upload("producto-otro", { lines: [wrongProduct], pca_original: "PCA-15102026-0047" });
  const otherService = f.upload("servicio-otro", { pca_original: "PCA-15102026-0047" });
  const files = [otherService, f.file, wrongFile, productFile];
  const selected = files.map((file, index) => ({ id: String(index), file, result: null }));
  const calls = [];
  const uploads = await pairing.classifyProductFirst(selected, selected, {
    async identify(entry) { return { ...entry, result: await f.api.identifyUniversalInvoice(entry.file) }; },
    async classify(entry, companion) {
      calls.push([entry.result.detectedType, entry.file.name, companion?.file.name ?? null]);
      return { ...entry, result: await f.api.classifyUniversalInvoice(entry.file, undefined, companion?.file) };
    },
    onStage() {},
  });
  assert.deepEqual(uploads.map(entry => entry.result.status), ["REQUIRES_PRODUCT_VALIDATION", "READY", "PRODUCT_MISMATCH", "READY"]);
  assert.deepEqual(calls.map(call => call[0]), ["PRODUCT", "PRODUCT", "SERVICE", "SERVICE"]);
  assert.equal(calls[2][2], null, "el servicio del concreto rechazado no toma otro Producto solo por compartir el 47");
  assert.equal(calls[3][2], productFile.name);
  assert.equal(uploads[1].result.dispatchId, uploads[3].result.dispatchId);
  assert.equal(f.tables.invoices.length, 0);
  assert.equal(f.writes.length, 0);
});

test("producto ya validado: acepta Servicio PCA del 13 y rechaza PCA del 15, ambos pedido 47", async () => {
  const good = fixture({ lines: [serviceLine], savedProduct: true });
  assert.equal((await good.api.classifyUniversalInvoice(good.file)).status, "READY");
  const bad = fixture({ lines: [serviceLine], savedProduct: true, pca: "PCA-15102026-0047" });
  const result = await bad.api.commitUniversalInvoice(bad.file, { dispatchId: "dispatch-ado" });
  assert.equal(result.status, "SERVICE_PCA_MISMATCH"); assert.equal(result.saved, false);
  assert.equal(bad.writes.length, 0);
});

test("una factura de Producto histórica incorrectamente asignada no valida nuevos Servicios", async () => {
  const f = fixture({ lines: [serviceLine], savedProduct: true, savedLines: [wrongProduct] });
  assert.equal((await f.api.classifyUniversalInvoice(f.file)).status, "REQUIRES_PRODUCT_VALIDATION");
});

test("la falta de identidad y los fallos de consulta no se convierten en READY", async () => {
  const missing = fixture({ expectedReference: null });
  assert.equal((await missing.api.classifyUniversalInvoice(missing.file)).status, "DISPATCH_IDENTITY_UNVERIFIED");
  const failed = fixture({ queryFailure: "dispatch_guide_lines" });
  await assert.rejects(failed.api.commitUniversalInvoice(failed.file), /verificar/u);
  assert.equal(failed.writes.length, 0);
});

test("las consultas se restringen al proyecto autorizado y la selección no habilita otro proyecto", async () => {
  const f = fixture();
  const result = await f.api.classifyUniversalInvoice(f.file, { projectId: "foreign-project" });
  assert.equal(result.dispatchId, null); assert.equal(f.reads.length, 0);
  const denied = fixture({ authorized: false });
  assert.equal((await denied.api.classifyUniversalInvoice(denied.file)).status, "ERROR");
  assert.equal(denied.reads.length, 0);
  const scoped = fixture(); await scoped.api.classifyUniversalInvoice(scoped.file);
  for (const read of scoped.reads.filter(read => ["dispatch_guides", "dispatch_guide_lines", "project_product_prices", "dispatches"].includes(read.table))) {
    assert.ok(read.filters.some(([op, key, value]) => op === "eq" && key === "project_id" && value === "project-ado"));
  }
});

test("la paginación no pierde productos al superar el límite de respuesta de Supabase", async () => {
  const calls = [];
  const result = await queries.readInvoiceIdentityRows(async (from, to) => {
    calls.push([from, to]);
    return { data: Array.from({ length: from === 0 ? 500 : 3 }, (_, i) => ({ id: from + i })), error: null };
  });
  assert.equal(result.length, 503); assert.deepEqual(calls, [[0, 499], [500, 999]]);
});

test("el procesador común también bloquea la carga individual del concreto equivocado", async () => {
  const f = fixture({ lines: [wrongProduct] });
  const result = f.processor.processExtractedInvoice(f.raw, { expectedType: "PRODUCT", companyCode: "PRO-ADO", orderNumber: "47",
    supplierName: f.raw.supplier_legal_name, supplierTaxId: f.raw.supplier_tax_id, billingLegalName: f.raw.billing_legal_name,
    billingTaxId: f.raw.billing_tax_id, projectAddress: f.raw.shipping_address, accountingPeriod: "2026-10-01", projectTimezone: "America/Guatemala",
    expectedQuantity: 8, expectedUnitCode: "M3", expectedQuantitySource: "REAL_VOLUME", realVolume: 8,
    expectedProducts: [{ code: product.code, reference: "CONF5001" }], productInvoicePca: null, productInvoiceIdentityValid: false });
  assert.equal(result.status, "error"); assert.match(result.details.join(" "), /código y la referencia/u);
});
