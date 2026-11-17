import ExcelJS from "exceljs";
import { buildConcreteControl, concreteControlTotals, CONCRETE_STRENGTHS, controlLineCategory, controlRound, type ConcreteControlRow } from "./concrete-control.ts";
import { radarDate, type RadarDispatch } from "./radar.ts";

const HEADER_ROW = 5;
const FIRST_ROW = HEADER_ROW + 1;
const HEADERS = ["Despacho", "Pedido", "No. de guía", "Fecha", "Camión", ...CONCRETE_STRENGTHS.flatMap((psi) => [`Resistencia ${psi} PSI (m³)`, `Costo ${psi} PSI (Q/m³)`]), "Otros PSI / sin identificar (m³)", "Costo otros (Q/m³)", "Total volumen Concreto (m³)", "Subtotal concreto (Q)", "Factura Concreto", "Volumen Bomba + Colocación (m³)", "Subtotal Bomba + Colocación (Q)", "Factura Bombeo", "Total concreto consumido (m³)", "Recargo (Q)", "Alisado (Q)", "Otros productos / servicios (Q)", "Total (Q)", "Laboratorio", "Elemento a fundir", "Observaciones"];
const COL = { concreteVolume: 18, concrete: 19, productInvoice: 20, pumpingVolume: 21, pumping: 22, serviceInvoice: 23, consumedVolume: 24, surcharge: 25, finishing: 26, other: 27, total: 28, laboratory: 29, element: 30, observations: 31 } as const;
const STRENGTH_COLUMNS = [6, 8, 10, 12, 14, 16];
const COST_COLUMNS = [7, 9, 11, 13, 15, 17];
const AMOUNT_COLUMNS: number[] = [COL.concrete, COL.pumping, COL.surcharge, COL.finishing, COL.other, COL.total];
const VOLUME_COLUMNS = [...STRENGTH_COLUMNS, COL.concreteVolume, COL.pumpingVolume, COL.consumedVolume];
const MONEY = '"Q "#,##0.00;[Red]("Q "#,##0.00);"Q "0.00';
const VOLUME = '#,##0.00##';
const LABELS = { concrete: "Concreto", pumping: "Bomba / colocación", surcharge: "Recargo", finishing: "Alisado", other: "Otros productos / servicios" };

function formulaCell(cell: ExcelJS.Cell, formula: string, value: number | null) { cell.value = { formula, result: value ?? "Pendiente" }; }

export function buildConcreteControlWorkbook(dispatches: RadarDispatch[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PRO Procesos";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet("Control de concreto", { views: [{ state: "frozen", ySplit: HEADER_ROW, xSplit: 5, showGridLines: false }] });
  sheet.properties.defaultRowHeight = 24;
  sheet.columns = HEADERS.map((_, index) => ({ width: index === COL.observations - 1 ? 66 : index === 1 || index === 3 || index === 4 ? 14 : index === COL.element - 1 ? 26 : 22 }));
  const entries = dispatches.flatMap<{ dispatch: RadarDispatch; control: ConcreteControlRow | null }>((dispatch) => {
    const { rows } = buildConcreteControl(dispatch);
    return rows.length ? rows.map((control) => ({ dispatch, control })) : [{ dispatch, control: null }];
  });
  const controls = entries.flatMap(({ control }) => control ? [control] : []);
  const totals = concreteControlTotals(controls);
  const heading = [
    [2, "CONTROL DE CONCRETO"],
    [3, `${dispatches.length} despacho(s) · ${controls.length} guía(s) · Proyecto(s): ${[...new Set(dispatches.map((dispatch) => dispatch.projectName))].join(", ")}`],
    [4, "Consumo = (volumen concreto + volumen bomba/colocación) / 2. Costos históricos de guías en GTQ. Las facturas son referencias del despacho, sin prorrateo."],
  ] as const;
  for (const [number, value] of heading) {
    sheet.mergeCells(number, 1, number, HEADERS.length);
    const cell = sheet.getCell(number, 1);
    cell.value = value;
    cell.font = { name: "Arial", size: number === 2 ? 14 : 10, bold: number === 2 };
    cell.alignment = { vertical: "middle", wrapText: true };
    sheet.getRow(number).height = number === 2 ? 30 : 24;
  }
  const header = sheet.getRow(HEADER_ROW);
  header.values = HEADERS;
  header.height = 48;
  header.eachCell((cell) => {
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF185E7A" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  entries.forEach(({ dispatch, control }, index) => {
    const row = sheet.getRow(FIRST_ROW + index);
    row.getCell(1).value = dispatch.code;
    row.getCell(2).value = dispatch.orderNumber || "Sin registrar";
    row.getCell(COL.productInvoice).value = dispatch.summary.productInvoice?.number || "Pendiente";
    row.getCell(COL.serviceInvoice).value = dispatch.summary.serviceInvoice?.number || "Pendiente";
    if (control) {
      const guide = control.guide;
      row.getCell(3).value = guide.number;
      row.getCell(4).value = /^\d{4}-\d{2}-\d{2}$/u.test(guide.date) ? new Date(`${guide.date}T12:00:00Z`) : guide.date;
      row.getCell(4).numFmt = "dd/mm/yyyy";
      row.getCell(5).value = guide.truck || "Sin registrar";
      CONCRETE_STRENGTHS.forEach((psi, strengthIndex) => {
        const strength = control.strengths.find((value) => value.label === `${psi} PSI`)!;
        row.getCell(6 + strengthIndex * 2).value = strength.quantity;
        row.getCell(7 + strengthIndex * 2).value = strength.quantity ? strength.amount.value === null ? "Pendiente" : strength.amount.value / strength.quantity : null;
      });
      const otherStrengths = control.strengths.filter((value) => !CONCRETE_STRENGTHS.some((psi) => value.label === `${psi} PSI`));
      const otherQuantity = controlRound(otherStrengths.reduce((sum, value) => sum + value.quantity, 0));
      row.getCell(16).value = otherQuantity;
      row.getCell(17).value = otherQuantity ? otherStrengths.some((value) => value.amount.value === null) ? "Pendiente" : otherStrengths.reduce((sum, value) => sum + value.amount.known, 0) / otherQuantity : null;
      const r = row.number;
      formulaCell(row.getCell(COL.concreteVolume), `SUM(F${r},H${r},J${r},L${r},N${r},P${r})`, control.concreteVolume);
      row.getCell(COL.pumpingVolume).value = control.pumpingVolume ?? "Pendiente";
      for (const key of ["concrete", "pumping", "surcharge", "finishing", "other"] as const) row.getCell(COL[key]).value = control[key].value ?? "Pendiente";
      formulaCell(row.getCell(COL.total), `IF(COUNT(S${r},V${r},Y${r}:AA${r})=5,SUM(S${r},V${r},Y${r}:AA${r}),"Pendiente")`, control.total.value);
      formulaCell(row.getCell(COL.consumedVolume), `IF(COUNT(R${r},U${r})=2,(R${r}+U${r})/2,"Pendiente")`, control.consumedVolume);
      row.getCell(COL.laboratory).value = guide.laboratory === null ? "Sin registrar" : guide.laboratory ? "Sí" : "No";
      row.getCell(COL.element).value = guide.castingElement;
      const observations = row.getCell(COL.observations);
      observations.value = guide.castingElementObservations || "";
      if (control.warnings.length) observations.note = `Avisos del reporte:\n${control.warnings.join("\n")}`;
    } else row.getCell(3).value = "Sin guías registradas";
    row.height = Math.max(30, String(row.getCell(COL.observations).value || "").split("\n").reduce((sum, text) => sum + Math.max(1, Math.ceil(text.length / 62)), 0) * 15);
    for (let col = 1; col <= HEADERS.length; col++) {
      const cell = row.getCell(col);
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { vertical: "middle", horizontal: VOLUME_COLUMNS.includes(col) || COST_COLUMNS.includes(col) || AMOUNT_COLUMNS.includes(col) ? "right" : "left", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: "FFD4D8DE" } } };
      if (control?.guide.laboratory) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE066" } };
      else if (index % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F3F8" } };
      if (VOLUME_COLUMNS.includes(col)) cell.numFmt = VOLUME;
      if (COST_COLUMNS.includes(col) || AMOUNT_COLUMNS.includes(col)) cell.numFmt = MONEY;
    }
  });
  if (!entries.length) sheet.getCell(`A${FIRST_ROW}`).value = "Sin despachos seleccionados";
  const end = FIRST_ROW + Math.max(entries.length, 1) - 1;
  const total = sheet.getRow(end + 1);
  total.getCell(1).value = "TOTAL GENERAL";
  for (const col of [...VOLUME_COLUMNS, ...AMOUNT_COLUMNS]) {
    const letter = sheet.getColumn(col).letter;
    const knownValues: Record<number, number | null> = { [COL.concreteVolume]: totals.concreteVolume, [COL.concrete]: totals.concrete.value, [COL.pumpingVolume]: totals.pumpingVolume, [COL.pumping]: totals.pumping.value, [COL.surcharge]: totals.surcharge.value, [COL.finishing]: totals.finishing.value, [COL.other]: totals.other.value, [COL.total]: totals.total.value, [COL.consumedVolume]: totals.consumedVolume };
    const value = knownValues[col] !== undefined ? knownValues[col] : controlRound(entries.reduce((sum, _, index) => sum + Number(sheet.getCell(FIRST_ROW + index, col).value), 0));
    formulaCell(total.getCell(col), `IF(COUNT(${letter}${FIRST_ROW}:${letter}${end})=${controls.length},SUM(${letter}${FIRST_ROW}:${letter}${end}),"Pendiente")`, value);
    total.getCell(col).numFmt = AMOUNT_COLUMNS.includes(col) ? MONEY : VOLUME;
  }
  for (let col = 1; col <= HEADERS.length; col++) {
    const cell = total.getCell(col);
    cell.font = { name: "Arial", size: 10, bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4EAF3" } };
    cell.alignment = { vertical: "middle", horizontal: col > 5 && col < COL.laboratory ? "right" : "left" };
    cell.border = { top: { style: "thin", color: { argb: "FF185E7A" } } };
  }
  sheet.autoFilter = { from: `A${HEADER_ROW}`, to: `AE${end}` };
  let next = end + 4;
  entries.forEach(({ dispatch, control }, index) => {
    if (!control) return;
    sheet.mergeCells(next, 1, next, 10);
    sheet.getCell(next, 1).value = `${dispatch.code} · Detalle de guía ${control.guide.number} · ${radarDate(control.guide.date)}`;
    sheet.getCell(next++, 1).font = { name: "Arial", size: 10, bold: true };
    const detailHeader = sheet.getRow(next++);
    detailHeader.values = ["Tipo", "Código", "Referencia", "Descripción", "Cantidad", "UM", "Precio unitario", "Moneda", "Subtotal", "Categoría"];
    detailHeader.height = 30;
    detailHeader.eachCell((cell) => { cell.font = { name: "Arial", bold: true, size: 10 }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } }; cell.alignment = { wrapText: true, vertical: "middle" }; });
    const detailStart = next;
    for (const line of control.guide.lines) {
      const row = sheet.getRow(next++);
      row.values = [line.type === "SERVICE" ? "Servicio" : "Producto", line.code, line.reference, line.description, line.quantity, line.unit, line.unitPrice ?? "Pendiente", line.currency?.trim().toUpperCase() || "Sin registrar", line.quantity === 0 ? 0 : line.estimatedSubtotal ?? (typeof line.unitPrice === "number" ? controlRound(line.quantity * line.unitPrice, 2) : "Pendiente"), LABELS[controlLineCategory(line)]];
      row.getCell(5).numFmt = VOLUME;
      row.getCell(7).numFmt = '#,##0.00##';
      row.getCell(9).numFmt = '#,##0.00';
      row.height = Math.max(30, Math.ceil(line.description.length / 20) * 14);
      row.eachCell((cell, col) => { cell.font = { name: "Arial", size: 10 }; cell.alignment = { wrapText: true, vertical: "middle", horizontal: [5, 7, 9].includes(col) ? "right" : "left" }; });
    }
    for (const category of ["concrete", "pumping", "surcharge", "finishing", "other"] as const) {
      const indices = control.guide.lines.flatMap((line, lineIndex) => line.quantity !== 0 && controlLineCategory(line) === category ? [lineIndex] : []);
      if (!indices.length) continue;
      const cells = indices.map((lineIndex) => `I${detailStart + lineIndex}`);
      const currencies = indices.map((lineIndex) => `H${detailStart + lineIndex}="GTQ"`);
      formulaCell(sheet.getCell(FIRST_ROW + index, COL[category]), `IF(AND(COUNT(${cells.join(",")})=${indices.length},${currencies.join(",")}),SUM(${cells.join(",")}),"Pendiente")`, control[category].value);
    }
    next += 2;
  });
  sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`, printArea: `A1:AE${sheet.rowCount}`, margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 } };
  return workbook;
}
