import { Workbook } from "exceljs";
import type { NextRequest } from "next/server";

import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { parseGuideReportFilters } from "@/features/reports/filters";
import { getGuideReport } from "@/features/reports/queries";
import { formatStatusLabel } from "@/lib/status-labels";

export const runtime = "nodejs";

function localDateTime(value: string | null, timezone: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export async function GET(request: NextRequest) {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status !== "ready" || !context.activeProject || !context.permissions.includes("dispatch.view")) {
    return Response.json({ message: "No tienes acceso a Reportería." }, { status: 403 });
  }
  const filters = parseGuideReportFilters(request.nextUrl.searchParams);
  const projects = context.isCompanyAdmin
    ? context.projects.filter((project) => project.companyId === context.activeProject?.companyId)
    : [context.activeProject];
  const report = await getGuideReport(projects.map(({ id, name, timezone }) => ({ id, name, timezone })), filters);

  const workbook = new Workbook();
  workbook.creator = "PRO Procesos";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Guías", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    ["Programación", "programmingCode", 18], ["Fecha programada", "scheduledAt", 21], ["Proyecto", "projectName", 24], ["Proveedor", "supplierName", 26],
    ["Estado de Programación", "programmingStatus", 22], ["Cantidad programada", "programmedQuantity", 20], ["UM", "unitCode", 10], ["Programación creada por", "programmingCreatedBy", 26],
    ["Despacho", "dispatchCode", 18], ["Número de guía", "guideNumber", 24], ["Fecha de guía", "guideDate", 15], ["Pedido", "orderNumber", 16], ["Lote", "batchCode", 20],
    ["Cantidad documentada", "documentedQuantity", 20], ["Cantidad recibida", "receivedQuantity", 18], ["Resultado físico", "physicalResult", 20], ["Estado del Despacho", "dispatchStatus", 22],
    ["Despacho registrado por", "registeredByName", 26], ["Fecha de registro", "createdAt", 21], ["Incidencias", "incidentCount", 12], ["Documentos", "documentCount", 12],
    ["Estado del Pedido", "orderStatus", 21], ["Estado de conciliación", "reconciliationStatus", 23], ["Cantidad facturada PRODUCT", "productInvoicedQuantity", 25],
    ["Diferencia", "difference", 15], ["Cantidad de facturas", "invoiceCount", 19], ["Requirió refacturación", "requiredReinvoicing", 22],
  ].map(([header, key, width]) => ({ header, key, width })) as { header: string; key: string; width: number }[];

  for (const programming of report.programming) {
    const dispatches = programming.dispatches.length ? programming.dispatches : [null];
    for (const row of dispatches) sheet.addRow({
      programmingCode: programming.code,
      scheduledAt: localDateTime(programming.scheduledAt, programming.timezone),
      projectName: programming.projectName,
      supplierName: programming.supplierName,
      programmingStatus: formatStatusLabel(programming.status),
      programmedQuantity: programming.confirmedQuantity ?? programming.requestedQuantity,
      unitCode: programming.unitCode,
      programmingCreatedBy: programming.createdByName,
      dispatchCode: row ? `DSP-${row.dispatchId.slice(0, 8).toUpperCase()}` : "Sin despacho",
      guideNumber: row?.guideNumber ?? "Sin guía",
      guideDate: row?.guideDate ?? "",
      orderNumber: row?.orderNumber ?? "",
      batchCode: row?.batchCode ?? "",
      documentedQuantity: row?.documentedQuantity ?? 0,
      receivedQuantity: row?.receivedQuantity ?? 0,
      physicalResult: row ? formatStatusLabel(row.physicalResult) : "Sin resultado",
      dispatchStatus: row ? formatStatusLabel(row.dispatchStatus) : "Sin despacho",
      registeredByName: row?.registeredByName ?? "",
      createdAt: row ? localDateTime(row.createdAt, row.timezone) : "",
      incidentCount: row?.incidentCount ?? 0,
      documentCount: row?.documentCount ?? 0,
      orderStatus: row ? formatStatusLabel(row.orderStatus) : "Sin Pedido",
      reconciliationStatus: row ? formatStatusLabel(row.reconciliationStatus) : "Sin evaluar",
      productInvoicedQuantity: row?.productInvoicedQuantity ?? 0,
      difference: row?.difference ?? 0,
      invoiceCount: row?.invoiceCount ?? 0,
      requiredReinvoicing: row?.reinvoicingRequired ? "Sí" : row?.reconciliationStatus === "MATCHED" ? "No" : "Pendiente",
    });
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE61E2A" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  sheet.autoFilter = { from: "A1", to: "AA1" };
  for (const key of ["programmedQuantity", "documentedQuantity", "receivedQuantity", "productInvoicedQuantity", "difference"]) {
    sheet.getColumn(key).numFmt = "#,##0.000";
  }
  sheet.eachRow((row, number) => {
    if (number > 1) {
      row.alignment = { vertical: "top", wrapText: true };
      if (number % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F8FA" } };
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `reporte-programaciones_${filters.dateFrom}_${filters.dateTo}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
