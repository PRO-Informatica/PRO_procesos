import { Workbook, type Worksheet } from "exceljs";
import type { NextRequest } from "next/server";

import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { reportArchiveItems, sanitizeArchiveSegment } from "@/features/reports/export-utils";
import { archiveIdChunks, getReportEvidence, readArchiveRows } from "@/features/reports/archive-queries";
import { createReportZip, ReportArchiveTooLargeError } from "@/features/reports/zip-archive";
import { reportZipResponse } from "@/features/reports/zip-response";
import { parseGuideReportFilters } from "@/features/reports/filters";
import { getGuideReport, getUniversalReportScopes } from "@/features/reports/queries";
import type { GuideReportData, ProgrammingReportItem, ReportInvoice } from "@/features/reports/types";
import {
  REPORT_TABLE_HEADER_ROW,
  setupReportSheet,
  type ReportWorkbookHeader,
} from "@/features/reports/workbook-header";
import { formatStatusLabel } from "@/lib/status-labels";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const COLORS = { ink: "FF17191F", muted: "FF667085", border: "FFE4E7EC", white: "FFFFFFFF", surface: "FFF7F8FA", red: "FFED1B2F", green: "FF15803D", greenSoft: "FFDCFCE7" } as const;

type Column = { header: string; key: string; width: number; kind?: "date" | "datetime" | "quantity" | "money" | "integer" };

const REPORT_COLUMNS: Column[] = [
  { header: "Empresa", key: "companyName", width: 24 },
  { header: "Razón social de facturación *", key: "projectBillingLegalName", width: 34 },
  { header: "Proyecto", key: "projectName", width: 22 },
  { header: "Programación", key: "programmingCode", width: 18 },
  { header: "Estado programación", key: "programmingStatus", width: 22 },
  { header: "Fecha programación", key: "scheduledAt", width: 21, kind: "datetime" },
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
  { header: "Validado por", key: "dispatchValidatedBy", width: 27 },
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
  { header: "Empresa", key: "companyName", width: 24 },
  { header: "Razón social de facturación *", key: "projectBillingLegalName", width: 34 },
  { header: "Proyecto", key: "projectName", width: 22 },
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

function applyColumnFormats(sheet: Worksheet, columns: Column[]) {
  for (const column of columns) {
    if (column.kind === "date") sheet.getColumn(column.key).numFmt = "dd/mm/yyyy";
    if (column.kind === "datetime") sheet.getColumn(column.key).numFmt = "dd/mm/yyyy hh:mm";
    if (column.kind === "quantity") sheet.getColumn(column.key).numFmt = "#,##0.000";
    if (column.kind === "money") sheet.getColumn(column.key).numFmt = '"Q" #,##0.00';
    if (column.kind === "integer") sheet.getColumn(column.key).numFmt = "0";
  }
}

function addStyledRow(sheet: Worksheet, values: Record<string, unknown>) {
  const row = sheet.addRow(values);
  row.height = 31;
  row.alignment = { vertical: "middle", wrapText: true };
  if ((row.number - REPORT_TABLE_HEADER_ROW) % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.surface } };
  row.eachCell((cell) => { cell.border = { bottom: { style: "thin", color: { argb: COLORS.border } } }; });
  return row;
}

function invoiceRow(programming: ProgrammingReportItem, dispatch: ProgrammingReportItem["dispatches"][number], invoice: ReportInvoice) {
  return {
    companyName: programming.companyName,
    projectBillingLegalName: programming.projectBillingLegalName ?? "No configurada",
    projectName: programming.projectName,
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

async function buildWorkbook(
  report: GuideReportData,
  companyName: string,
  header: ReportWorkbookHeader,
) {
  const workbook = new Workbook();
  workbook.creator = "PRO Procesos";
  workbook.company = companyName;
  workbook.created = new Date();
  workbook.title = `Reporte de programaciones, despachos y facturas · ${header.projectTitle}`;
  workbook.subject = `${companyName} · ${header.period}`;

  const reportSheet = workbook.addWorksheet("Reporte", { properties: { tabColor: { argb: COLORS.red } } });
  const productSheet = workbook.addWorksheet("Facturas Producto");
  const serviceSheet = workbook.addWorksheet("Facturas Servicio");
  setupReportSheet(reportSheet, REPORT_COLUMNS, header);
  setupReportSheet(productSheet, INVOICE_COLUMNS, header);
  setupReportSheet(serviceSheet, INVOICE_COLUMNS, header);
  reportSheet.getRow(REPORT_TABLE_HEADER_ROW).getCell("dispatchValidatedBy").fill = {
    type: "pattern", pattern: "solid", fgColor: { argb: COLORS.green },
  };
  applyColumnFormats(reportSheet, REPORT_COLUMNS);
  applyColumnFormats(productSheet, INVOICE_COLUMNS);
  applyColumnFormats(serviceSheet, INVOICE_COLUMNS);

  for (const programming of report.programming) {
    const dispatches = programming.dispatches.length ? programming.dispatches : [null];
    for (const dispatch of dispatches) {
      const reportRow = addStyledRow(reportSheet, {
        companyName: programming.companyName,
        projectBillingLegalName: programming.projectBillingLegalName ?? "No configurada",
        projectName: programming.projectName,
        programmingCode: programming.code,
        programmingStatus: formatStatusLabel(programming.status),
        scheduledAt: excelDate(programming.scheduledAt),
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
        dispatchValidatedBy: dispatch?.completedByName ?? "",
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
      reportRow.getCell("dispatchValidatedBy").fill = {
        type: "pattern", pattern: "solid", fgColor: { argb: COLORS.greenSoft },
      };
      if (dispatch?.productInvoice) addStyledRow(productSheet, invoiceRow(programming, dispatch, dispatch.productInvoice));
      if (dispatch?.serviceInvoice) addStyledRow(serviceSheet, invoiceRow(programming, dispatch, dispatch.serviceInvoice));
    }
  }
  return workbook;
}

async function buildZip(report: GuideReportData, includeProjectFolders: boolean) {
  const client = await createClient();
  const admin = createAdminClient();
  const evidence = await getReportEvidence(client, report.rows);
  const items = reportArchiveItems(report, evidence);
  const documentIds = [...new Set(items.map((item) => item.documentId))];
  const versions = [];
  for (const ids of archiveIdChunks(documentIds)) {
    versions.push(...await readArchiveRows((from, to) => client.from("document_versions")
      .select("document_id, file_name, mime_type, file_size, storage_bucket, storage_path")
      .in("document_id", ids).eq("upload_status", "UPLOADED").eq("is_current", true)
      .order("document_id").range(from, to)));
  }
  return createReportZip(items, versions, {
    includeProjectFolders,
    download: async (version) => {
      const downloaded = await admin.storage.from(version.storage_bucket).download(version.storage_path);
      if (downloaded.error || !downloaded.data) throw new Error("No fue posible descargar uno de los adjuntos del reporte.");
      return downloaded.data.arrayBuffer();
    },
  });
}

export async function GET(request: NextRequest) {
  const profile = await requireActiveProfile();

  try {
    const universal = request.nextUrl.searchParams.get("scope") === "universal";
    const context = universal ? null : await getProjectContext(profile.id);
    const projects = universal
      ? (await getUniversalReportScopes(profile.id)).map(({ project }) => project)
      : context?.status === "ready" && context.activeProject && context.permissions.includes("dispatch.view")
        ? context.isCompanyAdmin
          ? context.projects.filter((project) => project.companyId === context.activeProject?.companyId)
          : [context.activeProject]
        : [];
    if (!projects.length) {
      return Response.json({ message: `No tienes acceso a Reportería${universal ? " Universal" : ""}.` }, { status: 403 });
    }

    const filters = parseGuideReportFilters(request.nextUrl.searchParams);
    const report = await getGuideReport(projects.map(({ id, name, code, billingLegalName, companyName, timezone }) => ({ id, name, code, billingLegalName, companyName, timezone })), filters);
    const selectedProject = filters.projectId ? projects.find((project) => project.id === filters.projectId) : null;
    const reportProject = selectedProject ?? (projects.length === 1 ? projects[0] : null);
    const projectLabel = reportProject?.name ?? `${universal ? "Reportería Universal" : "Todos los proyectos"} (${projects.length})`;
    const safeProject = sanitizeArchiveSegment(projectLabel, "Proyectos");
    const format = request.nextUrl.searchParams.get("format") === "zip" ? "zip" : "xlsx";

    if (format === "zip") {
      const { zip, fileCount } = await buildZip(report, universal || projects.length > 1);
      if (!fileCount) return Response.json({ message: "El resultado filtrado no contiene facturas ni evidencias con archivos disponibles." }, { status: 404 });
      return reportZipResponse(zip, `Reporte_${safeProject}_${filters.dateFrom}_${filters.dateTo}.zip`);
    }

    const companyNames = [...new Set(projects.map((project) => project.companyName))];
    const exportedProjects = reportProject ? [reportProject] : projects;
    const billingLegalNameList = exportedProjects
      .map((project) => `${project.name} - ${project.billingLegalName ?? "No configurada"}`)
      .join("\n");
    const billingTaxIdList = exportedProjects
      .map((project) => `${project.name} - ${project.billingTaxId ?? "No configurado"}`)
      .join("\n");
    const workbook = await buildWorkbook(report, companyNames.length === 1 ? companyNames[0] : "Proyectos autorizados", {
      projectTitle: reportProject
        ? `${reportProject.name} · ${reportProject.code}`
        : projectLabel,
      billingLegalName:
        reportProject?.billingLegalName ??
        (reportProject ? "No configurada" : billingLegalNameList),
      billingTaxId:
        reportProject?.billingTaxId ??
        (reportProject ? "No configurado" : billingTaxIdList),
      period: `${displayDate(filters.dateFrom)} a ${displayDate(filters.dateTo)}`,
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="Reporte_${safeProject}_${filters.dateFrom}_${filters.dateTo}.xlsx"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReportArchiveTooLargeError) return Response.json({ message: error.message }, { status: 413 });
    console.error("Report export failed", error);
    return Response.json({ message: "No fue posible generar la exportación." }, { status: 500 });
  }
}
