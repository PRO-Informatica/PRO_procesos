import ExcelJS from "exceljs";
import type { Cell, CellValue, Worksheet } from "exceljs";

import type { BulkProgrammingPreviewRow } from "./types.ts";
import {
  validateMixtoProjectReference,
  MIXTO_PROJECT_REFERENCE_MISSING_ERROR,
} from "./project-reference.ts";

export const MIXTO_WORKBOOK_ERROR =
  "El archivo no corresponde al formato de Solicitud de Concreto de Mixto Listo.";
export const MIXTO_APPROVED_WORKBOOK_ERROR =
  "El Excel debe venir aprobado por Mixto Listo con DÍA PROGRAMADO y HORA PROGRAMADA.";

const { Workbook } = ExcelJS;

export type MixtoWorkbookProject = {
  id?: string;
  label?: string;
  billingLegalName: string;
  address: string;
  candidateProjects?: Array<{
    id: string;
    label: string;
    address: string;
    billingLegalName: string | null;
  }>;
};

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
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

function cellDisplayText(cell: Cell) {
  if (
    typeof cell.value === "number" &&
    Number.isSafeInteger(cell.value) &&
    cell.value >= 0 &&
    /^0+$/.test(cell.numFmt)
  ) {
    return String(cell.value).padStart(cell.numFmt.length, "0");
  }
  const displayed = cell.text.trim();
  return displayed || cellText(cell.value);
}

export function isApprovedProgrammingDayAllowed(
  scheduledAt: string,
  projectToday: string,
) {
  const scheduledDate = scheduledAt.match(/^(\d{4}-\d{2}-\d{2})T/)?.[1];
  return Boolean(
    scheduledDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(projectToday) &&
    scheduledDate >= projectToday
  );
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
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
}

export function parseMixtoDate(value: CellValue) {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === "number") date = excelSerialDate(value);
  else {
    const match = cellText(value).match(/^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/);
    if (match) {
      const first = Number(match[1]);
      const second = Number(match[2]);
      const third = Number(match[3]);
      const year = match[1].length === 4 ? first : third < 100 ? 2000 + third : third;
      const month = second;
      const day = match[1].length === 4 ? third : first;
      date = new Date(Date.UTC(year, month - 1, day));
      if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() + 1 !== month ||
        date.getUTCDate() !== day
      ) date = null;
    }
  }
  if (!date || !Number.isFinite(date.valueOf())) return "";
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function parseMixtoTime(value: CellValue) {
  if (value instanceof Date) {
    return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  }
  if (typeof value === "number") {
    const minutes = Math.round((value - Math.floor(value)) * 24 * 60);
    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  }
  const match = cellText(value).match(/^(\d{1,2}):?(\d{2})(?:\s*([ap])\.?\s*m\.?)?$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return "";
  return `${pad(hour)}:${pad(minute)}`;
}

type ColumnKey =
  | "requestDate" | "requestTime" | "concreteType" | "quantity"
  | "element" | "interval" | "programmedDate" | "programmedTime"
  | "orderNumber" | "additions";

function identifyHeader(value: string): ColumnKey | null {
  if (value === "dia programado") return "programmedDate";
  if (value === "hora programada") return "programmedTime";
  if (value === "pedido no") return "orderNumber";
  if (value === "fecha de fundicion") return "requestDate";
  if (value === "hora") return "requestTime";
  if (value === "tipo de concreto") return "concreteType";
  if (value === "volumen m3" || value === "volumen") return "quantity";
  if (value === "elemento a fundir") return "element";
  if (value === "tiempo entre camiones") return "interval";
  if (value === "adicionales al concreto") return "additions";
  return null;
}

function findHeaders(sheet: Worksheet) {
  const required = [
    "requestDate", "requestTime", "concreteType", "quantity", "element",
    "programmedDate", "programmedTime", "orderNumber", "additions",
  ] satisfies ColumnKey[];
  for (let rowNumber = 1; rowNumber < sheet.rowCount; rowNumber += 1) {
    const columns = new Map<ColumnKey, number>();
    for (const candidateRow of [rowNumber, rowNumber + 1]) {
      const row = sheet.getRow(candidateRow);
      for (let column = 1; column <= Math.max(row.cellCount, 20); column += 1) {
        const key = identifyHeader(normalized(cellText(row.getCell(column).value)));
        if (key) columns.set(key, column);
      }
    }
    if (required.every((key) => columns.has(key))) {
      return { lastRow: rowNumber + 1, columns };
    }
  }
  return null;
}

function extractInvoiceRecipient(sheet: Worksheet) {
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let column = 1; column <= Math.max(row.cellCount, 1); column += 1) {
      const label = cellText(row.getCell(column).value);
      if (!normalized(label).includes("nombre destinatario de factura")) continue;
      for (let candidateColumn = column + 1; candidateColumn <= row.cellCount; candidateColumn += 1) {
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

function extractProjectAddress(sheet: Worksheet) {
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let column = 1; column <= Math.max(row.cellCount, 1); column += 1) {
      const label = cellText(row.getCell(column).value);
      if (!normalized(label).includes("direccion exacta de obra")) continue;
      for (let candidateColumn = column + 1; candidateColumn <= row.cellCount; candidateColumn += 1) {
        const candidate = cellText(row.getCell(candidateColumn).value);
        if (candidate && normalized(candidate) !== normalized(label)) return candidate.trim();
      }
    }
  }
  return "";
}

function rowError(rowNumber: number, field: string) {
  return `Fila Excel ${rowNumber}: ${field}.`;
}

export async function extractMixtoProgrammingWorkbookBuffer(
  contents: Buffer,
  project: MixtoWorkbookProject,
) {
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(contents as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new Error(MIXTO_WORKBOOK_ERROR);
  }

  const sheet = workbook.worksheets.find((candidate) => {
    const content = sheetText(candidate);
    return normalized(candidate.name).includes("solicitud") &&
      content.includes("atencionalcliente mixtolisto com") &&
      content.includes("datos para la fundicion");
  });
  if (!sheet) throw new Error(MIXTO_WORKBOOK_ERROR);

  const reference = validateMixtoProjectReference({
    projectId: project.id,
    projectLabel: project.label,
    projectAddress: project.address,
    workbookAddress: extractProjectAddress(sheet),
    billingLegalName: project.billingLegalName,
    invoiceRecipient: extractInvoiceRecipient(sheet),
    candidateProjects: project.candidateProjects,
  });
  const headers = findHeaders(sheet);
  if (!headers) throw new Error(MIXTO_APPROVED_WORKBOOK_ERROR);

  const rows: BulkProgrammingPreviewRow[] = [];
  let consecutiveEmpty = 0;
  for (let rowNumber = headers.lastRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const value = (key: ColumnKey) => row.getCell(headers.columns.get(key)!).value;
    const relevant = [
      "requestDate", "requestTime", "concreteType", "quantity", "element",
      "programmedDate", "programmedTime", "orderNumber", "additions",
    ] satisfies ColumnKey[];
    const rawValues = relevant.map((key) => cellText(value(key)));
    if (rawValues.every((entry) => !entry.trim())) {
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= 3 && rows.length) break;
      continue;
    }
    if (rawValues.some((entry) => identifyHeader(normalized(entry)))) continue;
    consecutiveEmpty = 0;

    const date = parseMixtoDate(value("programmedDate"));
    const time = parseMixtoTime(value("programmedTime"));
    const orderNumber = cellDisplayText(
      row.getCell(headers.columns.get("orderNumber")!),
    ).trim();
    const concreteType = cellText(value("concreteType"));
    const quantity = Number(cellText(value("quantity")).replace(",", "."));
    const placementElement = cellText(value("element"));
    const additions = cellText(value("additions"));
    const truckInterval = headers.columns.has("interval") ? cellText(value("interval")) : "";

    if (!date) throw new Error(rowError(rowNumber, "DÍA PROGRAMADO faltante o inválido"));
    if (!time) throw new Error(rowError(rowNumber, "HORA PROGRAMADA faltante o inválida"));
    if (!orderNumber) throw new Error(rowError(rowNumber, "Pedido No. es obligatorio"));
    if (!concreteType) throw new Error(rowError(rowNumber, "Tipo de concreto es obligatorio"));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(rowError(rowNumber, "Volumen (m3) debe ser mayor que cero"));
    }
    if (!placementElement) throw new Error(rowError(rowNumber, "Elemento a fundir es obligatorio"));

    rows.push({
      sourceRow: rowNumber,
      scheduledAt: `${date}T${time}`,
      orderNumber,
      concreteType,
      quantity: String(quantity),
      unitCode: "M3",
      placementElement,
      additions,
      truckInterval,
      supplierId: "",
      notes: [
        `Elemento a fundir: ${placementElement}`,
        additions && `Adicionales al concreto: ${additions}`,
        truckInterval && `Tiempo entre camiones: ${truckInterval}`,
      ].filter(Boolean).join("\n"),
      errors: [],
    });
  }
  if (!rows.length) throw new Error(MIXTO_WORKBOOK_ERROR);
  return { rows, warnings: reference.warnings };
}
