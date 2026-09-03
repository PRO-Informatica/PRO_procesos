import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Workbook, type Cell, type Row, type Worksheet } from "exceljs";
import type { NextRequest } from "next/server";

import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { parseGuideReportFilters } from "@/features/reports/filters";
import { getGuideReport } from "@/features/reports/queries";
import type { GuideReportData } from "@/features/reports/types";
import { formatStatusLabel } from "@/lib/status-labels";

export const runtime = "nodejs";

const COLORS = {
  ink: "FF17191F",
  muted: "FF667085",
  border: "FFE4E7EC",
  white: "FFFFFFFF",
  surface: "FFF7F8FA",
  red: "FFED1B2F",
  redSoft: "FFFFEAEC",
  green: "FF027A48",
  greenSoft: "FFECFDF3",
  amber: "FFB54708",
  amberSoft: "FFFFFAEB",
  blue: "FF175CD3",
  blueSoft: "FFEFF4FF",
  graySoft: "FFF2F4F7",
} as const;

const TABLE_HEADER_ROW = 9;
const FIRST_DATA_ROW = TABLE_HEADER_ROW + 1;
const LAST_COLUMN = "AA";

const COLUMNS = [
  ["Programación", "programmingCode", 18],
  ["Fecha programada", "scheduledAt", 21],
  ["Proyecto", "projectName", 24],
  ["Proveedor", "supplierName", 26],
  ["Estado de Programación", "programmingStatus", 22],
  ["Cantidad programada", "programmedQuantity", 20],
  ["UM", "unitCode", 10],
  ["Programación creada por", "programmingCreatedBy", 26],
  ["Despacho", "dispatchCode", 18],
  ["Número de guía", "guideNumber", 24],
  ["Fecha de guía", "guideDate", 15],
  ["Pedido", "orderNumber", 16],
  ["Lote", "batchCode", 20],
  ["Cantidad documentada", "documentedQuantity", 20],
  ["Cantidad recibida", "receivedQuantity", 18],
  ["Resultado físico", "physicalResult", 20],
  ["Estado del Despacho", "dispatchStatus", 22],
  ["Despacho registrado por", "registeredByName", 26],
  ["Fecha de registro", "createdAt", 21],
  ["Incidencias", "incidentCount", 12],
  ["Documentos", "documentCount", 12],
  ["Estado del Pedido", "orderStatus", 21],
  ["Estado de conciliación", "reconciliationStatus", 23],
  ["Cantidad facturada PRODUCT", "productInvoicedQuantity", 25],
  ["Diferencia", "difference", 15],
  ["Cantidad de facturas", "invoiceCount", 19],
  ["Requirió refacturación", "requiredReinvoicing", 22],
] as const;

function localDateTime(value: string | null, timezone: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function solidFill(argb: string) {
  return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } };
}

function applyThinBorder(row: Row) {
  row.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: COLORS.border } } };
  });
}

function applyStatusStyle(cell: Cell, value: unknown) {
  const label = String(value ?? "").toLocaleUpperCase("es-GT");
  let color: string = COLORS.muted;
  let background: string = COLORS.graySoft;

  if (/CONCILIADO|COMPLETADO|COMPLETO|CONFIRMADO|MATCHED/u.test(label)) {
    color = COLORS.green;
    background = COLORS.greenSoft;
  } else if (/REFACTUR|DIFERENCIA|CORRECCI|RECHAZ|CANCEL/u.test(label)) {
    color = COLORS.red;
    background = COLORS.redSoft;
  } else if (/PENDIENTE|REVISI[ÓO]N|EJECUCI[ÓO]N|PARCIAL/u.test(label)) {
    color = COLORS.amber;
    background = COLORS.amberSoft;
  } else if (/LOTE|REGISTRADO|VALIDACI[ÓO]N/u.test(label)) {
    color = COLORS.blue;
    background = COLORS.blueSoft;
  }

  cell.font = { bold: true, color: { argb: color }, size: 10 };
  cell.fill = solidFill(background);
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
}

function addKpi(
  sheet: Worksheet,
  range: string,
  label: string,
  value: number,
  color: string,
) {
  const [labelRange, valueRange] = range.split("|");
  sheet.mergeCells(labelRange);
  sheet.mergeCells(valueRange);
  const labelCell = sheet.getCell(labelRange.split(":")[0]);
  const valueCell = sheet.getCell(valueRange.split(":")[0]);
  labelCell.value = label;
  valueCell.value = value;
  labelCell.font = { bold: true, size: 9, color: { argb: COLORS.muted } };
  valueCell.font = { bold: true, size: 18, color: { argb: color } };
  for (const rowNumber of [6, 7]) {
    const [start, end] = rowNumber === 6 ? labelRange.split(":") : valueRange.split(":");
    const row = sheet.getRow(rowNumber);
    for (let column = sheet.getCell(start).col; column <= sheet.getCell(end).col; column += 1) {
      const cell = row.getCell(column);
      cell.fill = solidFill(COLORS.white);
      cell.border = {
        top: { style: "thin", color: { argb: COLORS.border } },
        bottom: { style: "thin", color: { argb: COLORS.border } },
        left: column === sheet.getCell(start).col
          ? { style: "thin", color: { argb: COLORS.border } }
          : undefined,
        right: column === sheet.getCell(end).col
          ? { style: "thin", color: { argb: COLORS.border } }
          : undefined,
      };
      cell.alignment = { vertical: "middle", horizontal: "left" };
    }
  }
}

async function addReportBranding(
  workbook: Workbook,
  sheet: Worksheet,
  companyName: string,
  projectLabel: string,
  dateFrom: string,
  dateTo: string,
  timezone: string,
  report: GuideReportData,
) {
  for (let row = 1; row <= 4; row += 1) {
    for (let column = 1; column <= COLUMNS.length; column += 1) {
      sheet.getRow(row).getCell(column).fill = solidFill(COLORS.ink);
    }
  }

  try {
    const logo = await readFile(join(process.cwd(), "public", "pro-logo.png"));
    const logoId = workbook.addImage({
      base64: `data:image/png;base64,${logo.toString("base64")}`,
      extension: "png",
    });
    sheet.addImage(logoId, {
      tl: { col: 0.35, row: 0.45 },
      ext: { width: 132, height: 66 },
      editAs: "oneCell",
    });
  } catch {
    sheet.mergeCells("A1:C2");
    const fallbackLogo = sheet.getCell("A1");
    fallbackLogo.value = "PRO";
    fallbackLogo.font = { bold: true, italic: true, size: 26, color: { argb: COLORS.white } };
    fallbackLogo.alignment = { vertical: "middle", horizontal: "center" };
  }

  sheet.mergeCells("D1:AA2");
  const title = sheet.getCell("D1");
  title.value = "REPORTE DE PROGRAMACIONES Y DESPACHOS";
  title.font = { bold: true, size: 20, color: { argb: COLORS.white } };
  title.alignment = { vertical: "middle", horizontal: "left" };

  sheet.mergeCells("D3:J3");
  sheet.mergeCells("K3:Q3");
  sheet.mergeCells("R3:AA3");
  sheet.getCell("D3").value = `Empresa: ${companyName}`;
  sheet.getCell("K3").value = `Proyecto: ${projectLabel}`;
  sheet.getCell("R3").value = `Período: ${displayDate(dateFrom)} — ${displayDate(dateTo)}`;

  sheet.mergeCells("D4:AA4");
  sheet.getCell("D4").value = `Generado: ${localDateTime(new Date().toISOString(), timezone)} · Zona horaria: ${timezone}`;
  for (const address of ["D3", "K3", "R3", "D4"]) {
    const cell = sheet.getCell(address);
    cell.font = {
      size: address === "D4" ? 9 : 10,
      color: { argb: address === "D4" ? "FFBFC5D2" : COLORS.white },
      bold: address !== "D4",
    };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  }

  const matchedOrders = new Set(
    report.rows
      .filter((row) => row.reconciliationStatus === "MATCHED")
      .map((row) => `${row.projectId}:${row.batchId ?? ""}:${row.orderNumber ?? ""}`),
  ).size;
  const reinvoicingOrders = new Set(
    report.rows
      .filter((row) => row.reinvoicingRequired)
      .map((row) => `${row.projectId}:${row.batchId ?? ""}:${row.orderNumber ?? ""}`),
  ).size;

  addKpi(sheet, "A6:F6|A7:F7", "PROGRAMACIONES", report.programming.length, COLORS.ink);
  addKpi(sheet, "G6:L6|G7:L7", "DESPACHOS", report.rows.length, COLORS.blue);
  addKpi(sheet, "M6:R6|M7:R7", "PEDIDOS CONCILIADOS", matchedOrders, COLORS.green);
  addKpi(sheet, "S6:AA6|S7:AA7", "PEDIDOS CON REFACTURACIÓN", reinvoicingOrders, COLORS.red);
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
  const report = await getGuideReport(
    projects.map(({ id, name, timezone }) => ({ id, name, timezone })),
    filters,
  );
  const selectedProject = filters.projectId
    ? projects.find((project) => project.id === filters.projectId)
    : null;
  const projectLabel = selectedProject?.name
    ?? (projects.length === 1 ? projects[0]?.name : `Todos los proyectos (${projects.length})`)
    ?? context.activeProject.name;

  const workbook = new Workbook();
  workbook.creator = "PRO Procesos";
  workbook.company = context.activeProject.companyName;
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.title = `Reporte de programaciones y despachos · ${projectLabel}`;
  workbook.subject = `${context.activeProject.companyName} · ${displayDate(filters.dateFrom)} a ${displayDate(filters.dateTo)}`;

  const sheet = workbook.addWorksheet("Reporte", {
    properties: { tabColor: { argb: COLORS.red }, defaultRowHeight: 19 },
    views: [{
      state: "frozen",
      ySplit: TABLE_HEADER_ROW,
      showGridLines: false,
      topLeftCell: `A${FIRST_DATA_ROW}`,
    }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    },
  });
  sheet.columns = COLUMNS.map(([, key, width]) => ({ key, width }));
  sheet.getRow(1).height = 30;
  sheet.getRow(2).height = 30;
  sheet.getRow(3).height = 23;
  sheet.getRow(4).height = 20;
  sheet.getRow(5).height = 10;
  sheet.getRow(6).height = 22;
  sheet.getRow(7).height = 32;
  sheet.getRow(8).height = 10;

  await addReportBranding(
    workbook,
    sheet,
    context.activeProject.companyName,
    projectLabel,
    filters.dateFrom,
    filters.dateTo,
    context.activeProject.timezone,
    report,
  );

  const tableHeader = sheet.getRow(TABLE_HEADER_ROW);
  tableHeader.values = COLUMNS.map(([header]) => header);
  tableHeader.font = { bold: true, size: 10, color: { argb: COLORS.white } };
  tableHeader.fill = solidFill(COLORS.red);
  tableHeader.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  tableHeader.height = 38;
  tableHeader.eachCell((cell) => {
    cell.border = {
      right: { style: "thin", color: { argb: "FFFF8791" } },
      bottom: { style: "thin", color: { argb: COLORS.red } },
    };
  });
  sheet.autoFilter = { from: `A${TABLE_HEADER_ROW}`, to: `${LAST_COLUMN}${TABLE_HEADER_ROW}` };

  for (const programming of report.programming) {
    const dispatches = programming.dispatches.length ? programming.dispatches : [null];
    for (const dispatch of dispatches) {
      const row = sheet.addRow({
        programmingCode: programming.code,
        scheduledAt: localDateTime(programming.scheduledAt, programming.timezone),
        projectName: programming.projectName,
        supplierName: programming.supplierName,
        programmingStatus: formatStatusLabel(programming.status),
        programmedQuantity: programming.confirmedQuantity ?? programming.requestedQuantity,
        unitCode: programming.unitCode,
        programmingCreatedBy: programming.createdByName,
        dispatchCode: dispatch ? `DSP-${dispatch.dispatchId.slice(0, 8).toUpperCase()}` : "Sin despacho",
        guideNumber: dispatch?.guideNumber ?? "Sin guía",
        guideDate: dispatch?.guideDate ?? "",
        orderNumber: dispatch?.orderNumber ?? "",
        batchCode: dispatch?.batchCode ?? "",
        documentedQuantity: dispatch?.documentedQuantity ?? 0,
        receivedQuantity: dispatch?.receivedQuantity ?? 0,
        physicalResult: dispatch ? formatStatusLabel(dispatch.physicalResult) : "Sin resultado",
        dispatchStatus: dispatch ? formatStatusLabel(dispatch.dispatchStatus) : "Sin despacho",
        registeredByName: dispatch?.registeredByName ?? "",
        createdAt: dispatch ? localDateTime(dispatch.createdAt, dispatch.timezone) : "",
        incidentCount: dispatch?.incidentCount ?? 0,
        documentCount: dispatch?.documentCount ?? 0,
        orderStatus: dispatch ? formatStatusLabel(dispatch.orderStatus) : "Sin Pedido",
        reconciliationStatus: dispatch ? formatStatusLabel(dispatch.reconciliationStatus) : "Sin evaluar",
        productInvoicedQuantity: dispatch?.productInvoicedQuantity ?? 0,
        difference: dispatch?.difference ?? 0,
        invoiceCount: dispatch?.invoiceCount ?? 0,
        requiredReinvoicing: dispatch?.reinvoicingRequired
          ? "Sí"
          : dispatch?.reconciliationStatus === "MATCHED" ? "No" : "Pendiente",
      });
      row.height = 34;
      row.alignment = { vertical: "middle", wrapText: true };
      if (row.number % 2 === 0) row.fill = solidFill(COLORS.surface);
      applyThinBorder(row);

      for (const column of [6, 14, 15, 20, 21, 24, 25, 26]) {
        row.getCell(column).alignment = { vertical: "middle", horizontal: "right", wrapText: true };
      }
      for (const column of [5, 16, 17, 22, 23, 27]) {
        applyStatusStyle(row.getCell(column), row.getCell(column).value);
      }
      if (Number(row.getCell(20).value) > 0) {
        row.getCell(20).font = { bold: true, color: { argb: COLORS.red } };
      }
      const difference = Number(row.getCell(25).value ?? 0);
      row.getCell(25).font = {
        bold: true,
        color: { argb: difference === 0 ? COLORS.green : COLORS.red },
      };
    }
  }

  for (const key of [
    "programmedQuantity",
    "documentedQuantity",
    "receivedQuantity",
    "productInvoicedQuantity",
    "difference",
  ]) {
    sheet.getColumn(key).numFmt = "#,##0.000";
  }
  sheet.getColumn("incidentCount").numFmt = "0";
  sheet.getColumn("documentCount").numFmt = "0";
  sheet.getColumn("invoiceCount").numFmt = "0";
  sheet.pageSetup.printTitlesRow = `${TABLE_HEADER_ROW}:${TABLE_HEADER_ROW}`;
  sheet.headerFooter.oddFooter = "&LPRO Procesos&CReporte confidencial&RPágina &P de &N";

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `reporte-programaciones_${filters.dateFrom}_${filters.dateTo}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=\"${filename}\"`,
      "Cache-Control": "private, no-store",
    },
  });
}
