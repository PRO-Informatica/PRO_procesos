import "server-only";

import { Workbook, type CellValue, type Worksheet } from "exceljs";

import type { BulkProgrammingPreviewRow } from "./types";
import {
  assertMixtoProjectReference,
  MIXTO_PROJECT_REFERENCE_MISSING_ERROR,
} from "./project-reference";

export const MIXTO_WORKBOOK_ERROR =
  "El archivo no corresponde al formato de Solicitud de Concreto de Mixto Listo.";

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellText(value.result as CellValue);
  }
  return String(value).trim();
}

function sheetText(sheet: Worksheet) {
  const values: string[] = [];
  sheet.eachRow((row) => {
    row.eachCell({ includeEmpty: false }, (cell) => values.push(cellText(cell.value)));
  });
  return normalized(values.join(" "));
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function excelSerialDate(value: number) {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.floor(value) * 86_400_000);
}

function parseDate(value: CellValue) {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === "number") date = excelSerialDate(value);
  else {
    const text = cellText(value);
    const match = text.match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})$/);
    if (match) {
      const first = Number(match[1]);
      const second = Number(match[2]);
      const third = Number(match[3]);
      const year = match[1].length === 4 ? first : third;
      const month = second;
      const day = match[1].length === 4 ? third : first;
      date = new Date(Date.UTC(year, month - 1, day));
    }
  }
  if (!date || !Number.isFinite(date.valueOf())) return "";
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function parseTime(value: CellValue) {
  if (value instanceof Date) {
    return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  }
  if (typeof value === "number") {
    const minutes = Math.round((value - Math.floor(value)) * 24 * 60);
    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  }
  const match = cellText(value).match(/^(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s*m\.?)?$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return "";
  return `${pad(hour)}:${pad(minute)}`;
}

function findHeaderRow(sheet: Worksheet) {
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const labels = Array.from({ length: Math.max(row.cellCount, 12) }, (_, index) =>
      normalized(cellText(row.getCell(index + 1).value)),
    );
    if (
      labels.some((value) => value.includes("fecha de fundicion")) &&
      labels.some((value) => value === "hora") &&
      labels.some((value) => value.includes("tipo de concreto")) &&
      labels.some((value) => value.includes("volumen"))
    ) return rowNumber;
  }
  return null;
}

function headerColumns(sheet: Worksheet, rowNumber: number) {
  const result = new Map<string, number>();
  const row = sheet.getRow(rowNumber);
  row.eachCell({ includeEmpty: false }, (cell, column) => {
    const value = normalized(cellText(cell.value));
    if (value.includes("fecha de fundicion")) result.set("date", column);
    else if (value === "hora") result.set("time", column);
    else if (value.includes("tipo de concreto")) result.set("type", column);
    else if (value.includes("volumen")) result.set("quantity", column);
    else if (value.includes("elemento a fundir")) result.set("element", column);
    else if (value.includes("tiempo entre camiones")) result.set("interval", column);
  });
  return result;
}

function extractInvoiceRecipient(sheet: Worksheet) {
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let column = 1; column <= Math.max(row.cellCount, 1); column += 1) {
      const label = cellText(row.getCell(column).value);
      if (!normalized(label).includes("nombre destinatario de factura")) continue;

      for (
        let candidateColumn = column + 1;
        candidateColumn <= row.cellCount;
        candidateColumn += 1
      ) {
        const candidate = cellText(row.getCell(candidateColumn).value);
        if (!candidate || normalized(candidate) === normalized(label)) continue;
        if (candidate.trim().startsWith("*")) break;
        return candidate.trim();
      }
      throw new Error(MIXTO_PROJECT_REFERENCE_MISSING_ERROR);
    }
  }
  throw new Error(MIXTO_PROJECT_REFERENCE_MISSING_ERROR);
}

export async function extractMixtoProgrammingWorkbook(
  file: File,
  projectCode: string,
) {
  if (
    file.size <= 0 ||
    file.size > MAX_WORKBOOK_BYTES ||
    !file.name.toLowerCase().endsWith(".xlsx")
  ) throw new Error(MIXTO_WORKBOOK_ERROR);

  const workbook = new Workbook();
  try {
    const contents = Buffer.from(await file.arrayBuffer()) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0];
    await workbook.xlsx.load(contents);
  } catch {
    throw new Error(MIXTO_WORKBOOK_ERROR);
  }

  const sheet = workbook.worksheets.find(
    (candidate) => normalized(candidate.name) === "solicitud de concreto",
  );
  if (!sheet) throw new Error(MIXTO_WORKBOOK_ERROR);
  const content = sheetText(sheet);
  if (
    !content.includes("atencionalcliente@mixtolisto.com") ||
    !content.includes("datos para la fundicion")
  ) throw new Error(MIXTO_WORKBOOK_ERROR);

  const invoiceRecipient = extractInvoiceRecipient(sheet);
  assertMixtoProjectReference(projectCode, invoiceRecipient);

  const headerRow = findHeaderRow(sheet);
  if (!headerRow) throw new Error(MIXTO_WORKBOOK_ERROR);
  const columns = headerColumns(sheet, headerRow);
  if (["date", "time", "type", "quantity", "element", "interval"].some(
    (key) => !columns.has(key),
  )) throw new Error(MIXTO_WORKBOOK_ERROR);

  const rows: BulkProgrammingPreviewRow[] = [];
  let consecutiveEmpty = 0;
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const value = (key: string) => row.getCell(columns.get(key)!).value;
    const rawValues = ["date", "time", "type", "quantity", "element", "interval"]
      .map((key) => cellText(value(key)));
    if (rawValues.every((entry) => !entry.trim())) {
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= 3 && rows.length) break;
      continue;
    }
    if (
      normalized(rawValues[0]).includes("fecha de fundicion") &&
      normalized(rawValues[2]).includes("tipo de concreto")
    ) {
      continue;
    }
    consecutiveEmpty = 0;
    const date = parseDate(value("date"));
    const time = parseTime(value("time"));
    const quantity = Number(cellText(value("quantity")).replace(",", "."));
    const concreteType = cellText(value("type"));
    const placementElement = cellText(value("element"));
    const truckInterval = cellText(value("interval"));
    const errors: string[] = [];
    if (!date) errors.push("Fecha inválida");
    if (!time) errors.push("Hora inválida");
    if (!Number.isFinite(quantity) || quantity <= 0) errors.push("Volumen inválido");
    if (!concreteType) errors.push("Falta tipo de concreto");
    if (!placementElement) errors.push("Falta elemento a fundir");

    rows.push({
      sourceRow: rowNumber,
      scheduledAt: date && time ? `${date}T${time}` : "",
      concreteType,
      quantity: Number.isFinite(quantity) ? String(quantity) : "",
      unitCode: "M3",
      placementElement,
      truckInterval,
      supplierId: "",
      notes: [
        concreteType && `Tipo de concreto: ${concreteType}`,
        placementElement && `Elemento a fundir: ${placementElement}`,
        truckInterval && `Tiempo entre camiones: ${truckInterval}`,
      ].filter(Boolean).join("\n"),
      errors,
    });
  }
  if (!rows.length) throw new Error(MIXTO_WORKBOOK_ERROR);
  return rows;
}
