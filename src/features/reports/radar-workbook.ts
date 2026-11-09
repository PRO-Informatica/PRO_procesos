import ExcelJS from "exceljs";
import { radarDate, radarLocalDate, radarTime, type RadarDispatch, type RadarGuide } from "./radar.ts";

const COLUMNS = [
  { header: "No. de boleta / guía", key: "guide", width: 21 },
  { header: "Camión", key: "truck", width: 14 },
  { header: "Cantidad (m3)", key: "quantity", width: 16 },
  { header: "Concreto / Servicio", key: "concrete", width: 24 },
  { header: "Temperatura (°C)", key: "temperature", width: 19 },
  { header: "De carga", key: "loading", width: 15 },
  { header: "Llega a obra", key: "arrival", width: 23 },
  { header: "Sale de obra", key: "departure", width: 23 },
  { header: "Slump (Plg)", key: "slump", width: 16 },
  { header: 'LABORATORIO\n(4 CILINDROS POR MUESTRA 6X12")', key: "laboratory", width: 38 },
];
const DOCUMENT_TYPES: Record<string, string> = { DISPATCH_GUIDE: "Guía de despacho", MIXTO_OPERATION: "Control operación · Mixto Listo", PANEXUS_OPERATION: "Control operación · Panexus" };
const FIRST_GUIDE_ROW = 8;
const border: ExcelJS.Border = { style: "thin", color: { argb: "FF343434" } };

function clockCell(cell: ExcelJS.Cell, value: string | null, guide: RadarGuide, timezone: string) {
  const time = radarTime(value, timezone);
  if (!value || time === "—") return;
  if (/^\d{2}:\d{2}(?::\d{2})?$/u.test(value)) {
    const [hours, minutes] = time.split(":").map(Number);
    cell.value = (hours * 60 + minutes) / 1440;
    cell.numFmt = "hh:mm";
  } else {
    const date = radarLocalDate(value, timezone);
    cell.value = new Date(`${date}T${time}:00Z`);
    cell.numFmt = date === guide.date ? "hh:mm" : 'hh:mm" · "dd/mm/yyyy';
  }
}

export function buildRadarWorkbook(dispatches: RadarDispatch[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PRO Procesos";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const usedNames = new Set<string>();
  for (const dispatch of dispatches) {
    const base = dispatch.code.replace(/[\\/*?:[\]']/gu, "-").slice(0, 27) || "Despacho";
    let name = base;
    for (let suffix = 2; usedNames.has(name.toLowerCase()); suffix++) name = `${base}-${suffix}`;
    usedNames.add(name.toLowerCase());
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 7, xSplit: 2, showGridLines: false }] });
    sheet.columns = COLUMNS.map(({ key, width }) => ({ key, width }));
    for (let row = 1; row <= 5; row++) sheet.mergeCells(row, 1, row, COLUMNS.length);
    sheet.getCell("A1").value = `Radar de fundición · ${dispatch.code}`;
    sheet.getCell("A1").font = { name: "Arial", bold: true, size: 16 };
    sheet.getRow(1).height = 27;
    sheet.getCell("A2").value = `Proyecto: ${dispatch.projectName} · Proveedor: ${dispatch.supplierName}`;
    sheet.getCell("A3").value = `Programación: ${dispatch.programmingCode} · Pedido: ${dispatch.orderNumber || "Sin registrar"} · Fecha del despacho: ${radarDate(radarLocalDate(dispatch.scheduledAt, dispatch.timezone))}`;
    sheet.getCell("A4").value = `Elemento a fundir: ${dispatch.summary.castingElementLabel}. Amarillo: guía con laboratorio aplicado. Horarios en ${dispatch.timezone}; se indica la fecha si cambia de día.`;
    sheet.getCell("A5").value = "Temperatura, slump y detalle de muestreo: celdas vacías cuando no están registrados.";
    for (let row = 2; row <= 5; row++) {
      sheet.getRow(row).height = row === 4 ? 30 : 24;
      sheet.getCell(row, 1).alignment = { wrapText: true, vertical: "middle" };
    }
    sheet.mergeCells("F6:H6");
    sheet.getCell("F6").value = "Horarios";
    COLUMNS.forEach((column, index) => {
      const col = index + 1;
      if (col < 6 || col > 8) {
        sheet.mergeCells(6, col, 7, col);
        sheet.getCell(6, col).value = column.header;
      } else sheet.getCell(7, col).value = column.header;
    });
    sheet.getRow(6).height = 24;
    sheet.getRow(7).height = 28;
    for (let row = 6; row <= 7; row++) for (let col = 1; col <= COLUMNS.length; col++) {
      const cell = sheet.getCell(row, col);
      cell.font = { name: "Arial", size: 10, bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col === 10 ? "FFA9D18E" : "FFE7E6E6" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { top: border, bottom: border, left: border, right: border };
    }
    const detailEnd = FIRST_GUIDE_ROW + Math.max(dispatch.guides.length, 15) - 1;
    for (let rowNumber = FIRST_GUIDE_ROW; rowNumber <= detailEnd; rowNumber++) {
      const guide = dispatch.guides[rowNumber - FIRST_GUIDE_ROW];
      const row = sheet.getRow(rowNumber);
      row.height = guide ? Math.max(24, 14 * Math.max(Math.ceil(guide.number.length / 19), Math.ceil(guide.truck.length / 12), Math.ceil(guide.concrete.length / 22), Math.ceil(guide.laboratoryNotes.length / 35), Math.ceil(guide.slump.length / 14))) : 22;
      if (guide) {
        row.getCell("guide").value = guide.number;
        row.getCell("truck").value = guide.truck || "Sin registrar";
        row.getCell("quantity").value = guide.concreteQuantity;
        row.getCell("concrete").value = guide.concrete;
        row.getCell("temperature").value = guide.temperature;
        row.getCell("slump").value = guide.slump || null;
        row.getCell("laboratory").value = guide.laboratoryNotes || (guide.laboratory === null ? "Sin registrar" : guide.laboratory ? "Sí" : null);
        clockCell(row.getCell("loading"), guide.loadingTime, guide, dispatch.timezone);
        clockCell(row.getCell("arrival"), guide.arrivalAt, guide, dispatch.timezone);
        clockCell(row.getCell("departure"), guide.departureAt, guide, dispatch.timezone);
      }
      for (let col = 1; col <= COLUMNS.length; col++) {
        const cell = row.getCell(col);
        cell.font = { name: "Arial", size: 10, bold: col === 10 && guide?.laboratory === true };
        cell.alignment = { horizontal: [3, 5].includes(col) ? "right" : "center", vertical: "middle", wrapText: true };
        cell.border = { top: border, bottom: border, left: border, right: border };
        if (guide?.laboratory) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE066" } };
      }
      row.getCell("quantity").numFmt = "0.00##";
      row.getCell("temperature").numFmt = "0.0#";
    }
    if (!dispatch.guides.length) sheet.getCell("A8").value = "Sin guías registradas";
    const totalRow = detailEnd + 1;
    sheet.mergeCells(`A${totalRow}:B${totalRow}`);
    sheet.getCell(totalRow, 1).value = "TOTAL";
    sheet.getCell(totalRow, 3).value = { formula: `SUM(C${FIRST_GUIDE_ROW}:C${detailEnd})`, result: Math.round(dispatch.guides.reduce((sum, guide) => sum + guide.concreteQuantity, 0) * 10000) / 10000 };
    sheet.getCell(totalRow, 3).numFmt = "0.00##";
    sheet.getRow(totalRow).height = 26;
    for (let col = 1; col <= COLUMNS.length; col++) {
      const cell = sheet.getCell(totalRow, col);
      cell.font = { name: "Arial", size: 10, bold: true };
      cell.alignment = { vertical: "middle", horizontal: col === 3 ? "right" : "center" };
      cell.border = { top: border, bottom: border, left: border, right: border };
    }
    // Keep the existing detailed fields below the compact report, on the same sheet.
    let next = totalRow + 3;
    for (const guide of dispatch.guides) {
      sheet.mergeCells(next, 1, next, 10);
      const heading = sheet.getCell(next, 1);
      heading.value = `Guía ${guide.number} · ${radarDate(guide.date)} · ${guide.castingElement}`;
      heading.font = { name: "Arial", size: 10, bold: true };
      heading.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
      sheet.getRow(next++).height = 24;
      const details = [
        ["Documento / Pedido", `${DOCUMENT_TYPES[guide.documentType] ?? "Guía de despacho"} · ${guide.orderNumber || dispatch.orderNumber || "Sin registrar"}`],
        ["Cliente", guide.customerName], ["Proyecto leído", guide.projectName], ["Dirección de obra", guide.workAddress],
        ["Planta", guide.plant], ["Piloto", guide.pilot], ["Operador", guide.operator], ["Observaciones", guide.observations],
        ["Productos / Servicios", guide.lines.map((line) => `${line.type === "SERVICE" ? "Servicio" : "Producto"} · ${line.quantity} ${line.unit} · ${line.code} · ${line.reference || line.description}`).join("\n")],
      ];
      for (const [label, value] of details) {
        if (!value) continue;
        sheet.mergeCells(next, 1, next, 2);
        sheet.mergeCells(next, 3, next, 10);
        sheet.getCell(next, 1).value = label;
        sheet.getCell(next, 1).font = { name: "Arial", size: 10, bold: true };
        sheet.getCell(next, 3).value = value;
        sheet.getCell(next, 3).font = { name: "Arial", size: 10 };
        sheet.getCell(next, 3).alignment = { wrapText: true, vertical: "middle" };
        sheet.getRow(next++).height = Math.max(22, value.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 130)), 0) * 15);
      }
      next++;
    }
    sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:7", printArea: `A1:J${sheet.rowCount}`, margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 } };
  }
  return workbook;
}
