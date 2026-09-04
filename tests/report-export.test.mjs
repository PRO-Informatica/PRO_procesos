import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  reportArchiveItems,
  reportArchivePath,
  sanitizeArchiveSegment,
} from "../src/features/reports/export-utils.ts";

const route = await readFile(new URL("../src/app/(dashboard)/reports/export/route.ts", import.meta.url), "utf8");
const query = await readFile(new URL("../src/features/reports/queries.ts", import.meta.url), "utf8");

function invoice(id, type, number = "123") {
  return {
    id,
    type,
    number,
    date: "2026-09-02",
    status: "REGISTERED",
    subtotal: 100,
    total: 112,
    currency: "GTQ",
    orderNumber: "21",
    pcaOriginal: "PCA-001-0021",
    invoicedQuantity: type === "PRODUCT" ? 10 : null,
    unitCode: type === "PRODUCT" ? "M3" : null,
    documentId: `doc-${id}`,
    fileName: `${id}.pdf`,
    extractionStatus: "CONFIRMED",
    supplierLegalName: "MEZCLADORA, S.A.",
    supplierTaxId: "123",
    billingLegalName: "CLIENTE, S.A.",
    billingTaxId: "456",
  };
}

function report(productInvoice, serviceInvoice, projectId = "project-a") {
  const dispatch = {
    projectId,
    dispatchId: "dispatch-a",
    dispatchCode: "DSP-DISPATCH",
    orderNumber: "21",
    productInvoice,
    serviceInvoice,
  };
  return { rows: [dispatch], programming: [], filters: { projects: [], suppliers: [], users: [], batches: [] } };
}

test("Excel y ZIP reutilizan exactamente el mismo reporte filtrado", () => {
  assert.match(route, /parseGuideReportFilters\(request\.nextUrl\.searchParams\)/u);
  assert.match(route, /const report = await getGuideReport\(/u);
  assert.match(route, /buildWorkbook\(report,/u);
  assert.match(route, /buildZip\(report\)/u);
});

test("el ZIP incluye Producto y Servicio del pedido", () => {
  const items = reportArchiveItems(report(invoice("product", "PRODUCT"), invoice("service", "SERVICE")));
  assert.deepEqual(items.map((item) => item.invoice.type), ["PRODUCT", "SERVICE"]);
});

test("el ZIP admite solo Producto o solo Servicio", () => {
  assert.deepEqual(reportArchiveItems(report(invoice("product", "PRODUCT"), null)).map((item) => item.invoice.type), ["PRODUCT"]);
  assert.deepEqual(reportArchiveItems(report(null, invoice("service", "SERVICE"))).map((item) => item.invoice.type), ["SERVICE"]);
});

test("un pedido sin facturas no crea archivos", () => {
  assert.equal(reportArchiveItems(report(null, null)).length, 0);
});

test("la factura vigente proviene de los identificadores canónicos de conciliación", () => {
  assert.match(query, /current_product_invoice_id/u);
  assert.match(query, /current_service_invoice_id/u);
  assert.match(query, /invoiceById\.get\(reconciliation\.current_product_invoice_id\)/u);
  assert.doesNotMatch(query, /replaces_invoice_id/u);
});

test("los nombres del ZIP se sanitizan y las colisiones reciben sufijo", () => {
  assert.equal(sanitizeArchiveSegment('21/central:*?"<>|'), "21-central");
  const used = new Set();
  const item = reportArchiveItems(report(invoice("product", "PRODUCT", "A/1"), null))[0];
  assert.equal(reportArchivePath(item, used), "Pedido_21/Factura_Producto_A-1.pdf");
  assert.equal(reportArchivePath(item, used), "Pedido_21/Factura_Producto_A-1_2.pdf");
});

test("la consulta restringe datos y documentos a proyectos permitidos", () => {
  assert.match(query, /\.in\("project_id", projectIds\)/u);
  assert.match(query, /invoice_documents[\s\S]*\.in\("project_id", projectIds\)/u);
});
