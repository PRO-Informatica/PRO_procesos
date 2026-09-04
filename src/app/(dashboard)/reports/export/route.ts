import { Workbook, type Worksheet } from "exceljs";
import JSZip from "jszip";
import type { NextRequest } from "next/server";

import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { reportArchiveItems, reportArchivePath, sanitizeArchiveSegment } from "@/features/reports/export-utils";
import { parseGuideReportFilters } from "@/features/reports/filters";
import { getGuideReport } from "@/features/reports/queries";
import type { GuideReportData, ProgrammingReportItem, ReportInvoice } from "@/features/reports/types";
import { formatStatusLabel } from "@/lib/status-labels";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const COLORS = { ink: "FF17191F", muted: "FF667085", border: "FFE4E7EC", white: "FFFFFFFF", surface: "FFF7F8FA", red: "FFED1B2F" } as const;

type Column = { header: string; key: string; width: number; kind?: "date" | "datetime" | "quantity" | "money" | "integer" };

const REPORT_COLUMNS: Column[] = [
  { header: "Programación", key: "programmingCode", width: 18 },
  { header: "Estado programación", key: "programmingStatus", width: 22 },
  { header: "Fecha programación", key: "scheduledAt", width: 21, kind: "datetime" },
  { header: "Proyecto", key: "projectName", width: 22 },
  { header: "Proveedor", key: "supplierName", width: 26 },
  { header: "Cantidad programada", key: "programmedQuantity", width: 20, kind: "quantity" },
  { header: "UM programada", key: "programmedUnit", width: 14 },
  { header: "Programación creada por", key: "programmingCreatedBy", width: 25 },
  { header: "Despacho", key: "dispatchCode", width: 18 },
  { header: "Estado despacho", key: "dispatchStatus", width: 20 },
  { header: "Resultado", key: "dispatchResult", width: 18 },
  { header: "Pedido", key: "orderNumber", width: 16 },
  { header: "Lote", key: "batchCode", width: 19 },
  { header: "Volumen real", key: "realVolume", width: 16, kind: "quantity" },
  { header: "UM real", key: "realUnit", width: 11 },
  { header: "Cantidad según guías", key: "documentedQuantity", width: 20, kind: "quantity" },
  { header: "Guías", key: "guideCount", width: 10, kind: "integer" },
  { header: "Incidencias", key: "incidentCount", width: 12, kind: "integer" },
  { header: "Documentos operativos", key: "documentCount", width: 20, kind: "integer" },
  { header: "Despacho registrado por", key: "dispatchCreatedBy", width: 25 },
  { header: "Fecha registro despacho", key: "dispatchCreatedAt", width: 21, kind: "datetime" },
  { header: "Estado conciliación", key: "reconciliationStatus", width: 23 },
  { header: "Diferencia", key: "difference", width: 15, kind: "quantity" },
  { header: "Facturas vigentes", key: "invoiceCount", width: 16, kind: "integer" },
  { header: "Requirió refacturación", key: "reinvoicing", width: 21 },
  { header: "Factura producto", key: "productInvoiceNumber", width: 20 },
  { header: "Fecha factura producto", key: "productInvoiceDate", width: 19, kind: "date" },
  { header: "Cantidad producto", key: "productQuantity", width: 18, kind: "quantity" },
  { header: "Total producto", key: "productTotal", width: 17, kind: "money" },
  { header: "Factura servicio", key: "serviceInvoiceNumber", width: 20 },
  { header: "Fecha factura servicio", key: "serviceInvoiceDate", width: 19, kind: "date" },
  { header: "Total servicio", key: "serviceTotal", width: 17, kind: "money" },
];

const INVOICE_COLUMNS: Column[] = [
  { header: "Programación", key: "programmingCode", width: 18 },
  { header: "Despacho", key: "dispatchCode", width: 18 },
  { header: "Pedido despacho", key: "dispatchOrder", width: 18 },
  { header: "Lote", key: "batchCode", width: 20 },
  { header: "No. factura", key: "number", width: 20 },
  { header: "Fecha", key: "date", width: 14, kind: "date" },
  { header: "PCA", key: "pca", width: 22 },
  { header: "Pedido detectado", key: "invoiceOrder", width: 18 },
  { header: "Emisor", key: "supplierLegalName", width: 30 },
  { header: "NIT emisor", key: "supplierTaxId", width: 17 },
  { header: "Receptor", key: "billingLegalName", width: 30 },
  { header: "NIT receptor", key: "billingTaxId", width: 17 },
  { header: "Cantidad facturada", key: "quantity", width: 20, kind: "quantity" },
  { header: "UM", key: "unit", width: 10 },
  { header: "Subtotal", key: "subtotal", width: 17, kind: "money" },
  { header: "Total", key: "total", width: 17, kind: "money" },
  { header: "Moneda", key: "currency", width: 11 },
  { header: "Estado factura", key: "status", width: 18 },
  { header: "Estado extracción", key: "extractionStatus", width: 20 },
  { header: "Documento", key: "fileName", width: 38 },
];

function excelDate(value: string | null | undefined) {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function setupSheet(sheet: Worksheet, columns: Column[]) {
  sheet.columns = columns.map(({ header, key, width }) => ({ header, key, width }));
  sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  const header = sheet.getRow(1);
  header.height = 34;
  header.font = { bold: true, size: 10, color: { argb: COLORS.white } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.red } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.eachCell((cell) => { cell.border = { right: { style: "thin", color: { argb: "FFFF8791" } } }; });
  sheet.autoFilter = { from: "A1", to: { row: 1, column: columns.length } };
  for (const column of columns) {
    if (column.kind === "date") sheet.getColumn(column.key).numFmt = "dd/mm/yyyy";
    if (column.kind === "datetime") sheet.getColumn(column.key).numFmt = "dd/mm/yyyy hh:mm";
    if (column.kind === "quantity") sheet.getColumn(column.key).numFmt = "#,##0.000";
    if (column.kind === "money") sheet.getColumn(column.key).numFmt = "#,##0.00";
    if (column.kind === "integer") sheet.getColumn(column.key).numFmt = "0";
  }
}

function addStyledRow(sheet: Worksheet, values: Record<string, unknown>) {
  const row = sheet.addRow(values);
  row.height = 31;
  row.alignment = { vertical: "middle", wrapText: true };
  if (row.number % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.surface } };
  row.eachCell((cell) => { cell.border = { bottom: { style: "thin", color: { argb: COLORS.border } } }; });
}

function invoiceRow(programming: ProgrammingReportItem, dispatch: ProgrammingReportItem["dispatches"][number], invoice: ReportInvoice) {
  return {
    programmingCode: programming.code,
    dispatchCode: dispatch.dispatchCode,
    dispatchOrder: dispatch.orderNumber ?? "",
    batchCode: dispatch.batchCode ?? "",
    number: invoice.number,
    date: excelDate(invoice.date),
    pca: invoice.pcaOriginal ?? "",
    invoiceOrder: invoice.orderNumber ?? "",
    supplierLegalName: invoice.supplierLegalName ?? dispatch.supplierName,
    supplierTaxId: invoice.supplierTaxId ?? "",
    billingLegalName: invoice.billingLegalName ?? "",
    billingTaxId: invoice.billingTaxId ?? "",
    quantity: invoice.invoicedQuantity,
    unit: invoice.unitCode ?? "",
    subtotal: invoice.subtotal,
    total: invoice.total,
    currency: invoice.currency,
    status: formatStatusLabel(invoice.status),
    extractionStatus: formatStatusLabel(invoice.extractionStatus, "Sin extracción"),
    fileName: invoice.fileName ?? "",
  };
}

async function buildWorkbook(report: GuideReportData, companyName: string, projectLabel: string, dateFrom: string, dateTo: string) {
  const workbook = new Workbook();
  workbook.creator = "PRO Procesos";
  workbook.company = companyName;
  workbook.created = new Date();
  workbook.title = `Reporte de programaciones, despachos y facturas · ${projectLabel}`;
  workbook.subject = `${companyName} · ${displayDate(dateFrom)} a ${displayDate(dateTo)}`;

  const reportSheet = workbook.addWorksheet("Reporte", { properties: { tabColor: { argb: COLORS.red } } });
  const productSheet = workbook.addWorksheet("Facturas Producto");
  const serviceSheet = workbook.addWorksheet("Facturas Servicio");
  setupSheet(reportSheet, REPORT_COLUMNS);
  setupSheet(productSheet, INVOICE_COLUMNS);
  setupSheet(serviceSheet, INVOICE_COLUMNS);

  for (const programming of report.programming) {
    const dispatches = programming.dispatches.length ? programming.dispatches : [null];
    for (const dispatch of dispatches) {
      addStyledRow(reportSheet, {
        programmingCode: programming.code,
        programmingStatus: formatStatusLabel(programming.status),
        scheduledAt: excelDate(programming.scheduledAt),
        projectName: programming.projectName,
        supplierName: programming.supplierName,
        programmedQuantity: programming.confirmedQuantity ?? programming.requestedQuantity,
        programmedUnit: programming.unitCode,
        programmingCreatedBy: programming.createdByName,
        dispatchCode: dispatch?.dispatchCode ?? "Sin despacho",
        dispatchStatus: dispatch ? formatStatusLabel(dispatch.dispatchStatus) : "Sin despacho",
        dispatchResult: dispatch ? formatStatusLabel(dispatch.physicalResult) : "",
        orderNumber: dispatch?.orderNumber ?? "",
        batchCode: dispatch?.batchCode ?? "",
        realVolume: dispatch?.receivedQuantity ?? null,
        realUnit: dispatch?.unitCode ?? "",
        documentedQuantity: dispatch?.documentedQuantity ?? null,
        guideCount: dispatch?.guideCount ?? 0,
        incidentCount: dispatch?.incidentCount ?? 0,
        documentCount: dispatch?.documentCount ?? 0,
        dispatchCreatedBy: dispatch?.registeredByName ?? "",
        dispatchCreatedAt: excelDate(dispatch?.createdAt),
        reconciliationStatus: dispatch ? formatStatusLabel(dispatch.reconciliationStatus) : "Pendiente de despacho",
        difference: dispatch?.difference ?? null,
        invoiceCount: dispatch?.invoiceCount ?? 0,
        reinvoicing: dispatch ? (dispatch.reinvoicingRequired ? "Sí" : "No") : "",
        productInvoiceNumber: dispatch?.productInvoice?.number ?? "",
        productInvoiceDate: excelDate(dispatch?.productInvoice?.date),
        productQuantity: dispatch?.productInvoice?.invoicedQuantity ?? null,
        productTotal: dispatch?.productInvoice?.total ?? null,
        serviceInvoiceNumber: dispatch?.serviceInvoice?.number ?? "",
        serviceInvoiceDate: excelDate(dispatch?.serviceInvoice?.date),
        serviceTotal: dispatch?.serviceInvoice?.total ?? null,
      });
      if (dispatch?.productInvoice) addStyledRow(productSheet, invoiceRow(programming, dispatch, dispatch.productInvoice));
      if (dispatch?.serviceInvoice) addStyledRow(serviceSheet, invoiceRow(programming, dispatch, dispatch.serviceInvoice));
    }
  }
  return workbook;
}

async function buildZip(report: GuideReportData) {
  const admin = createAdminClient();
  const items = reportArchiveItems(report);
  const documentIds = [...new Set(items.map((item) => item.invoice.documentId).filter((id): id is string => Boolean(id)))];
  if (!documentIds.length) return { zip: new JSZip(), fileCount: 0 };
  const versions = await admin.from("document_versions").select("document_id, storage_bucket, storage_path").in("document_id", documentIds).eq("upload_status", "UPLOADED").eq("is_current", true);
  if (versions.error) throw new Error("No fue posible preparar los documentos del reporte.");
  const versionByDocument = new Map((versions.data ?? []).map((version) => [version.document_id, version]));
  const zip = new JSZip();
  const usedPaths = new Set<string>();
  let fileCount = 0;
  for (const item of items) {
    const documentId = item.invoice.documentId;
    const version = documentId ? versionByDocument.get(documentId) : null;
    if (!version) continue;
    const downloaded = await admin.storage.from(version.storage_bucket).download(version.storage_path);
    if (downloaded.error || !downloaded.data) throw new Error("No fue posible descargar uno de los PDF del reporte.");
    zip.file(reportArchivePath(item, usedPaths), await downloaded.data.arrayBuffer());
    fileCount += 1;
  }
  return { zip, fileCount };
}

export async function GET(request: NextRequest) {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status !== "ready" || !context.activeProject || !context.permissions.includes("dispatch.view")) {
    return Response.json({ message: "No tienes acceso a Reportería." }, { status: 403 });
  }

  try {
    const filters = parseGuideReportFilters(request.nextUrl.searchParams);
    const projects = context.isCompanyAdmin ? context.projects.filter((project) => project.companyId === context.activeProject?.companyId) : [context.activeProject];
    const report = await getGuideReport(projects.map(({ id, name, timezone }) => ({ id, name, timezone })), filters);
    const selectedProject = filters.projectId ? projects.find((project) => project.id === filters.projectId) : null;
    const projectLabel = selectedProject?.name ?? (projects.length === 1 ? projects[0]?.name : `Todos los proyectos (${projects.length})`) ?? context.activeProject.name;
    const safeProject = sanitizeArchiveSegment(projectLabel, "Proyectos");
    const format = request.nextUrl.searchParams.get("format") === "zip" ? "zip" : "xlsx";

    if (format === "zip") {
      const { zip, fileCount } = await buildZip(report);
      if (!fileCount) return Response.json({ message: "El resultado filtrado no contiene facturas con PDF disponible." }, { status: 404 });
      const buffer = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
      return new Response(buffer, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="Reporte_${safeProject}_${filters.dateFrom}_${filters.dateTo}.zip"`, "Cache-Control": "private, no-store" } });
    }

    const workbook = await buildWorkbook(report, context.activeProject.companyName, projectLabel, filters.dateFrom, filters.dateTo);
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="Reporte_${safeProject}_${filters.dateFrom}_${filters.dateTo}.xlsx"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Report export failed", error);
    return Response.json({ message: "No fue posible generar la exportación." }, { status: 500 });
  }
}
