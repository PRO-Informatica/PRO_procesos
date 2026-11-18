import ExcelJS from "exceljs";
import { buildConcreteControl, CONCRETE_STRENGTHS, controlLinePricing, controlNumber, controlRound, groupControlLines } from "./concrete-control.ts";
import { radarLocalDate, type RadarDispatch, type RadarLine } from "./radar.ts";

const HEADER_ROW = 5;
const FIRST_ROW = HEADER_ROW + 1;
const PENDING = "Pendiente";
const MONEY = '"Q "#,##0.00';
const PRICE = '"Q "#,##0.00##';
const VOLUME = '#,##0.00##';
const IDENTIFIER_COLUMNS = new Set(["order", "productInvoice", "serviceInvoice"]);

type ControlColumn = {
  key: string;
  header: string;
  width: number;
  numFmt?: string;
  totalDecimals?: number;
};

function volume(key: string, header: string): ControlColumn {
  return { key, header, width: 18, numFmt: VOLUME, totalDecimals: 4 };
}

function money(key: string, header: string): ControlColumn {
  return { key, header, width: 19, numFmt: MONEY, totalDecimals: 2 };
}

function distinctText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].join("\n");
}

function additionalLineDetails(lines: RadarLine[]) {
  const groups = groupControlLines(lines, (line) => {
    const { currency, unitPrice } = controlLinePricing(line);
    return JSON.stringify([line.type, line.reference, line.code, line.description, line.unit, currency, unitPrice]);
  });
  return [...groups.values()].map((group) => {
    const first = group[0];
    const { currency, unitPrice } = controlLinePricing(first);
    const label = first.description || first.reference || first.code || (first.type === "SERVICE" ? "Servicio" : "Producto");
    const quantity = controlRound(group.reduce((sum, line) => sum + line.quantity, 0));
    const subtotals = group.map((line) => controlLinePricing(line).subtotalInCurrency);
    const subtotal = subtotals.some((value) => value === null) ? null : controlRound(subtotals.reduce<number>((sum, value) => sum + (value ?? 0), 0), 2);
    const price = unitPrice ?? (quantity && subtotal !== null ? subtotal / quantity : null);
    const unit = /^m[3³]$/iu.test(first.unit) ? "m³" : first.unit;
    const displayMoney = (value: number | null, decimals: number) => value === null ? PENDING : `${currency ?? "Moneda pendiente"} ${controlNumber(value, decimals)}`;
    return `${label} · ${controlNumber(quantity, 3)} ${unit} · Unitario ${displayMoney(price, 4)} · Subtotal ${displayMoney(subtotal, 2)}`;
  }).join("\n");
}

export function buildConcreteControlWorkbook(dispatches: RadarDispatch[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PRO Procesos";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const entries = dispatches.map((dispatch) => ({ dispatch, control: buildConcreteControl(dispatch) }));
  const observed = entries.flatMap(({ control }) => [...control.strengths.keys()]);
  const strengths: (number | null)[] = [...new Set([...CONCRETE_STRENGTHS, ...observed.filter((psi) => psi !== null)])].sort((a, b) => a - b);
  if (observed.includes(null)) strengths.push(null);

  const columns: ControlColumn[] = [
    { key: "programming", header: "Programación", width: 18 },
    { key: "dispatch", header: "Despacho", width: 18 },
    { key: "project", header: "Proyecto", width: 24 },
    { key: "order", header: "Pedido", width: 15 },
    { key: "date", header: "Fecha programada", width: 16 },
    ...strengths.flatMap((psi) => {
      const label = psi === null ? "Sin PSI identificado" : `${psi} PSI`;
      return [
        volume(`volume-${psi}`, `${label} (m³)`),
        { key: `price-${psi}`, header: `Costo ${label} (Q/m³)`, width: 17, numFmt: PRICE },
        money(`amount-${psi}`, `Subtotal ${label} (Q)`),
      ];
    }),
    volume("concreteVolume", "Volumen despachado de concreto (m³)"),
    money("concrete", "Subtotal concreto (Q)"),
    money("otherProduct", "Otros productos (Q)"),
    money("product", "Subtotal producto (Q)"),
    { key: "productInvoice", header: "Factura producto", width: 21 },
    volume("pumpingVolume", "Volumen bomba + colocación (m³)"),
    money("pumping", "Subtotal bomba + colocación (Q)"),
    money("surcharge", "Recargo (Q)"),
    money("finishing", "Alisado (Q)"),
    money("otherService", "Otros servicios (Q)"),
    money("service", "Subtotal servicio (Q)"),
    { key: "serviceInvoice", header: "Factura servicio", width: 21 },
    volume("consumedVolume", "Total concreto consumido (m³)"),
    money("total", "Total (Q)"),
    { key: "laboratory", header: "Laboratorio", width: 16 },
    { key: "element", header: "Elemento a fundir", width: 27 },
    { key: "observations", header: "Observaciones", width: 50 },
    { key: "details", header: "Detalle de servicios y otros productos", width: 65 },
  ];
  const sheet = workbook.addWorksheet("Sistema de control", { views: [{ state: "frozen", ySplit: HEADER_ROW, xSplit: 2, showGridLines: false }] });
  sheet.columns = columns.map(({ key, width }) => ({ key, width }));
  const headings = [
    "SISTEMA DE CONTROL",
    `${entries.length} despacho(s) · Una fila por despacho y su programación`,
    "El costo por PSI se pondera por volumen si hay varios precios. Consumo = (volumen concreto + volumen bomba/colocación) / 2.",
  ];
  headings.forEach((value, index) => {
    const number = index + 2;
    sheet.mergeCells(number, 1, number, 14);
    const cell = sheet.getCell(number, 1);
    cell.value = value;
    cell.font = { name: "Arial", size: index === 0 ? 14 : 10, bold: index === 0 };
    cell.alignment = { vertical: "middle", wrapText: true };
    sheet.getRow(number).height = index === 0 ? 30 : 22;
  });

  const header = sheet.getRow(HEADER_ROW);
  header.height = 52;
  header.values = columns.map((column) => column.header);
  header.eachCell((cell) => {
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF185E7A" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  entries.forEach(({ dispatch, control }, index) => {
    const row = sheet.getRow(FIRST_ROW + index);
    const write = (key: string, value: ExcelJS.CellValue) => { row.getCell(key).value = value; };
    const metric = (key: string, value: number | null) => write(key, control.hasLines ? value ?? PENDING : PENDING);
    const ref = (key: string) => row.getCell(key).address;
    const calculated = (key: string, keys: string[], value: number | null, decimals: number, divisor = 1) => {
      const refs = keys.map(ref).join(",");
      write(key, {
        formula: `IF(COUNT(${refs})=${keys.length},ROUND(SUM(${refs})/${divisor},${decimals}),"${PENDING}")`,
        result: control.hasLines ? value ?? PENDING : PENDING,
      });
    };

    write("programming", dispatch.programmingCode);
    write("dispatch", dispatch.code);
    write("project", dispatch.projectName);
    write("order", dispatch.orderNumber || "Sin registrar");
    write("date", new Date(`${radarLocalDate(dispatch.scheduledAt, dispatch.timezone)}T00:00:00Z`));
    for (const psi of strengths) {
      const strength = control.strengths.get(psi);
      metric(`volume-${psi}`, strength?.quantity ?? 0);
      write(`price-${psi}`, strength ? strength.unitPrice ?? (strength.amount.pending ? PENDING : null) : null);
      metric(`amount-${psi}`, strength ? strength.amount.value : 0);
    }
    metric("concreteVolume", control.concreteVolume);
    metric("concrete", control.concrete.value);
    metric("otherProduct", control.otherProduct.value);
    calculated("product", ["concrete", "otherProduct"], control.product.value, 2);
    write("productInvoice", dispatch.summary.productInvoice?.number || PENDING);
    metric("pumpingVolume", control.pumpingVolume);
    metric("pumping", control.pumping.value);
    metric("surcharge", control.surcharge.value);
    metric("finishing", control.finishing.value);
    metric("otherService", control.otherService.value);
    calculated("service", ["pumping", "surcharge", "finishing", "otherService"], control.service.value, 2);
    write("serviceInvoice", dispatch.summary.serviceInvoice?.number || PENDING);
    calculated("consumedVolume", ["concreteVolume", "pumpingVolume"], control.consumedVolume, 4, 2);
    calculated("total", ["product", "service"], control.total.value, 2);

    const laboratory = dispatch.guides.some((guide) => guide.laboratory === true);
    const laboratoryNotApplied = dispatch.guides.length > 0 && dispatch.guides.every((guide) => guide.laboratory === false);
    write("laboratory", laboratory ? "Sí" : laboratoryNotApplied ? "No" : "Sin registrar");
    write("element", distinctText(dispatch.guides.map((guide) => guide.castingElement)) || null);
    write("observations", distinctText(dispatch.guides.map((guide) => guide.castingElementObservations)) || null);
    write("details", control.hasLines ? additionalLineDetails(control.additionalLines) || null : control.warnings[0]);
    if (control.warnings.length) {
      row.getCell("observations").note = control.warnings.join("\n");
    }

    let lines = 1;
    for (const { key, width, numFmt } of columns) {
      const cell = row.getCell(key);
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { vertical: "middle", horizontal: numFmt ? "right" : "left", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: "FFD4D8DE" } } };
      if (laboratory) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE066" } };
      else if (index % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F3F8" } };
      if (numFmt) cell.numFmt = numFmt;
      if (IDENTIFIER_COLUMNS.has(key)) {
        cell.numFmt = "@";
        cell.alignment = { ...cell.alignment, horizontal: "center" };
      }
      if (typeof cell.value === "string") {
        const wrapped = cell.value.split("\n").reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / (width - 3))), 0);
        lines = Math.max(lines, wrapped);
      }
    }
    row.getCell("date").numFmt = "dd/mm/yyyy";
    row.height = Math.min(409, Math.max(28, lines * 14 + 6));
  });

  const lastDataRow = FIRST_ROW + entries.length - 1;
  const lastColumn = sheet.getColumn(columns.length).letter;
  sheet.autoFilter = { from: `A${HEADER_ROW}`, to: `${lastColumn}${lastDataRow}` };
  const total = sheet.getRow(lastDataRow + 1);
  total.height = 28;
  total.getCell("programming").value = entries.length ? "TOTAL GENERAL" : "Sin despachos";
  const dispatchesWithLines = entries.filter(({ control }) => control.hasLines).length;
  if (dispatchesWithLines < entries.length) {
    total.getCell("programming").note = "El total general suma los despachos con líneas registradas.";
  }
  for (const { key, numFmt, totalDecimals } of columns) {
    const cell = total.getCell(key);
    if (totalDecimals !== undefined && dispatchesWithLines) {
      const letter = sheet.getColumn(key).letter;
      const range = `${letter}${FIRST_ROW}:${letter}${lastDataRow}`;
      const values = entries.map((_, index) => {
        const entryCell = sheet.getRow(FIRST_ROW + index).getCell(key);
        return entryCell.result ?? entryCell.value;
      });
      const numbers = values.filter((value) => typeof value === "number");
      cell.value = {
        formula: `IF(COUNT(${range})=${dispatchesWithLines},ROUND(SUM(${range}),${totalDecimals}),"${PENDING}")`,
        result: numbers.length === dispatchesWithLines ? controlRound(numbers.reduce((sum, value) => sum + value, 0), totalDecimals) : PENDING,
      };
    } else if (totalDecimals !== undefined && entries.length) cell.value = PENDING;
    cell.font = { name: "Arial", size: 10, bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4EAF3" } };
    cell.alignment = { vertical: "middle", horizontal: numFmt ? "right" : "left" };
    cell.border = { top: { style: "thin", color: { argb: "FF185E7A" } } };
    if (numFmt) cell.numFmt = numFmt;
  }
  sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`, printArea: `A1:${lastColumn}${total.number}`, margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 } };
  return workbook;
}
