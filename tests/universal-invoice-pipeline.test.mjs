import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { addressesMatch, normalizeAddressIdentity } from "../src/lib/address-identity.ts";
import { classifyInvoiceLines } from "../src/features/invoices/invoice-classification.ts";
import { buildFiscalDocumentKey } from "../src/features/invoices/invoice-identity.ts";
import { parseMixtoListoInvoiceText } from "../src/features/batches/mixto-listo-parser.ts";

const service = await readFile(new URL("../src/features/invoices/universal/service.ts", import.meta.url), "utf8");
const classifyRoute = await readFile(new URL("../src/app/api/invoices/universal/classify/route.ts", import.meta.url), "utf8");
const commitRoute = await readFile(new URL("../src/app/api/invoices/universal/commit/route.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/090_universal_invoice_pipeline.sql", import.meta.url), "utf8");
const companyAdminPurchasingMigration = await readFile(
  new URL("../supabase/migrations/091_company_admin_inherits_purchasing_permissions.sql", import.meta.url),
  "utf8",
);

test("normaliza dirección de manera exacta sin perder números ni orden", () => {
  const expected = "9 CALLE 5A-62, ZONA 9, QUETZALTENANGO CIUDAD GUATEMALA";
  assert.equal(normalizeAddressIdentity(expected), "9 CALLE 5A 62 ZONA 9 QUETZALTENANGO CIUDAD GUATEMALA");
  assert.equal(addressesMatch(expected, "9 calle 5a 62 zona 9; Quetzaltenango Ciudad Guatemala"), true);
  assert.equal(addressesMatch(expected, "9 CALLE 5A-63 ZONA 9 QUETZALTENANGO CIUDAD GUATEMALA"), false);
  assert.equal(addressesMatch(expected, "ZONA 9 9 CALLE 5A-62 QUETZALTENANGO CIUDAD GUATEMALA"), false);
});

test("extrae dirección, autorización y serie de la factura digital", () => {
  const parsed = parseMixtoListoInvoiceText(`
MEZCLADORA, S.A.
NIT: 32709-3
Número Autorización: 8309A353-A5A5-489D-AF8A-1ED45B53DC3E
Serie: 8309A353
Número: 2779072669
FECHA 02 09 2026
NOMBRE O RAZÓN SOCIAL: INMOBILIARIA LOS ANTURIOS, S.A.
NIT: 111871344
Dirección de Envío: 9 CALLE 5A-62, ZONA 9, QUETZALTENANGO CIUDAD GUATEMALA
CANTIDAD MEDIDA CÓDIGO DESCRIPCIÓN
159 M3 1001 CONCRETO 4000 PSI 187340.16
OBSERVACIONES: PCA-01092026-0021
TOTAL: GTQ 187340.16
`);
  assert.equal(parsed.shipping_address, "9 CALLE 5A-62, ZONA 9, QUETZALTENANGO CIUDAD GUATEMALA");
  assert.equal(parsed.authorization_number, "8309A353-A5A5-489D-AF8A-1ED45B53DC3E");
  assert.equal(parsed.series, "8309A353");
});

test("ignora el rótulo de establecimiento intercalado antes de la autorización FEL", () => {
  const parsed = parseMixtoListoInvoiceText(`
MEZCLADORA, S.A.
NIT: 32709-3
Número Autorización:
ESTABLECIMIENTO COMERCIAL
9BED5E59-8FE7-4101-9D74-1ED45B510D23
MIXTO LISTO
Serie: 9BED5E59
Número: 2414297345
`);

  assert.equal(parsed.authorization_number, "9BED5E59-8FE7-4101-9D74-1ED45B510D23");
  assert.notEqual(parsed.authorization_number, "ESTABLECIMIENTO");
});

test("clasificación central conserva UNKNOWN", () => {
  assert.equal(classifyInvoiceLines([{ code: "1001", description: "CONCRETO 4000 PSI" }]), "PRODUCT");
  assert.equal(classifyInvoiceLines([{ code: "SERV0250", description: "BOMBEO" }]), "SERVICE");
  assert.equal(classifyInvoiceLines([{ code: "ABC", description: "CONCEPTO NO SOPORTADO" }]), "UNKNOWN");
});

test("identidad fiscal prioriza NIT + autorización y tiene fallback estable", () => {
  assert.equal(buildFiscalDocumentKey({ issuerTaxId: "32709-3", authorizationNumber: "AA-BB", series: "S1", invoiceNumber: "10" }), "327093:AUTH:AABB");
  assert.equal(buildFiscalDocumentKey({ issuerTaxId: "32709-3", authorizationNumber: null, series: "S1", invoiceNumber: "10" }), "327093:SERIES:S1:NUMBER:10");
  assert.equal(buildFiscalDocumentKey({ issuerTaxId: null, authorizationNumber: "AA", series: null, invoiceNumber: "10" }), null);
});

test("Universal limita proyectos, no selecciona coincidencias ambiguas y exige lote abierto", () => {
  assert.match(service, /REQUIRED_PERMISSIONS\.every/u);
  assert.match(service, /addressesMatch\(project\.address, raw\.shipping_address\)/u);
  assert.match(service, /PROJECT_AMBIGUOUS/u);
  assert.match(service, /DISPATCH_AMBIGUOUS/u);
  assert.match(service, /NO_ACTIVE_BATCH/u);
  assert.match(service, /\.eq\("status", "OPEN"\)/u);
  assert.match(service, /detectedType === "PRODUCT"/u);
});

test("los endpoints mutables verifican mismo origen", () => {
  assert.match(classifyRoute, /hasValidSameOrigin/u);
  assert.match(commitRoute, /hasValidSameOrigin/u);
});

test("calcula el hash antes de entregar el ArrayBuffer al extractor PDF", () => {
  const classifyStart = service.indexOf("async function classifyInternal");
  const classifyEnd = service.indexOf("const detectedType", classifyStart);
  const classifySetup = service.slice(classifyStart, classifyEnd);
  const hashPosition = classifySetup.indexOf('createHash("sha256")');
  const extractionPosition = classifySetup.indexOf("extractMixtoListoInvoicePdf(buffer)");

  assert.ok(hashPosition >= 0, "classifyInternal debe calcular el SHA-256");
  assert.ok(extractionPosition >= 0, "classifyInternal debe extraer el PDF");
  assert.ok(
    hashPosition < extractionPosition,
    "el hash debe calcularse antes de que unpdf pueda transferir y separar el ArrayBuffer",
  );
});

test("la identidad fiscal histórica se retrocompleta y se revisa antes de aceptar duplicados", () => {
  assert.match(migration, /with latest_extraction as/u);
  assert.match(migration, /DUPLICATE_FISCAL_IDENTITY_PREFLIGHT_REQUIRED/u);
  assert.match(migration, /create unique index invoices_fiscal_document_key_uq/u);
  assert.match(service, /\.is\("fiscal_document_key", null\)/u);
  assert.match(service, /registro fiscal histórico/u);
});

test("COMPANY_ADMIN incluye todas las capacidades asignadas a PURCHASING", () => {
  assert.match(companyAdminPurchasingMigration, /role\.code = 'COMPANY_ADMIN'/u);
  assert.match(companyAdminPurchasingMigration, /role\.code = 'PURCHASING'/u);
  assert.match(companyAdminPurchasingMigration, /select v_company_admin_role_id, assignment\.permission_id/u);
  assert.match(companyAdminPurchasingMigration, /where assignment\.role_id = v_purchasing_role_id/u);
  assert.match(companyAdminPurchasingMigration, /except[\s\S]*where assignment\.role_id = v_company_admin_role_id/u);
  assert.doesNotMatch(companyAdminPurchasingMigration, /delete from public\.role_permissions/u);
});
