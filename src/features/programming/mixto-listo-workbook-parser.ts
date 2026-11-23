import ExcelJS from "exceljs";
import type { Cell, CellValue, Row, Worksheet } from "exceljs";

import type { BulkProgrammingPreviewRow } from "./types.ts";
import { DELIVERY_MODES, type DeliveryMode } from "./invoice-policy.ts";
import {
  validateMixtoProjectReference,
  MIXTO_PROJECT_REFERENCE_MISSING_ERROR,
} from "./project-reference.ts";

export const MIXTO_WORKBOOK_ERROR =
  "El archivo no corresponde al formato de Solicitud de Concreto de Mixto Listo.";
export const MIXTO_APPROVED_WORKBOOK_ERROR =
  "El Excel debe venir aprobado por Mixto Listo con DÍA PROGRAMADO o FECHA PROGRAMADA, y HORA PROGRAMADA.";

const { Workbook } = ExcelJS;

export type MixtoWorkbookProject = {
  id?: string;
  label?: string;
  billingLegalName: string;
  address: string;
  additionalAddresses?: readonly string[];
  candidateProjects?: Array<{
    id: string;
    label: string;
    address: string;
    additionalAddresses?: readonly string[];
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
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value.toISOString() : "";
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

function calendarDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
    ? `${year}-${pad(month)}-${pad(day)}`
    : "";
}

function formulaResult(value: CellValue): CellValue {
  return value && typeof value === "object" && "result" in value ? value.result : value;
}

function textDate(value: string, monthFirst: boolean) {
  const text = value.normalize("NFKC").replace(/\s*([/.\-])\s*/gu, "$1");
  const iso = text.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/u);
  if (iso) return monthFirst ? "" : calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const match = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})$/u);
  if (!match) return "";
  const year = Number(match[3]) + (match[3].length === 2 ? 2000 : 0);
  return calendarDate(year, Number(match[monthFirst ? 1 : 2]), Number(match[monthFirst ? 2 : 1]));
}

export function parseMixtoDate(value: CellValue, date1904 = false) {
  value = formulaResult(value);
  if (!(value instanceof Date) && typeof value !== "number") return textDate(cellText(value), false);
  const date = value instanceof Date ? value : new Date(
    Date.UTC(1899, 11, 30) + (Math.floor(value) + (date1904 ? 1462 : 0)) * 86_400_000,
  );
  return Number.isFinite(date.valueOf()) && date.getUTCFullYear() >= 1000 && date.getUTCFullYear() <= 9999
    ? date.toISOString().slice(0, 10)
    : "";
}

function approvedDate(value: CellValue, requestedDate: string, date1904: boolean) {
  const source = formulaResult(value);
  const date = parseMixtoDate(source, date1904);
  const typedDate = source instanceof Date || typeof source === "number";
  const [year, month, day] = date.split("-").map(Number);
  const alternate = typedDate ? calendarDate(year, day, month) : textDate(cellText(source), true);
  if (alternate && alternate !== date && alternate === requestedDate) {
    return { date: alternate, warning: "Se intercambiaron día y mes porque coinciden con la fecha solicitada. Verifica la fecha antes de cargar." };
  }
  if (date && !typedDate && alternate && alternate !== date && date !== requestedDate) {
    return { date, warning: `El Excel admite otra lectura (${alternate}). Verifica el día y el mes.` };
  }
  return { date: date || alternate, warning: "" };
}

export function parseMixtoTime(value: CellValue) {
  value = formulaResult(value);
  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}` : "";
  }
  if (typeof value === "number") {
    if (value < 0 || value >= 1 || !Number.isFinite(value)) return "";
    const minutes = Math.min(Math.round(value * 24 * 60), 1439);
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }
  const raw = cellText(value).normalize("NFKC").trim();
  const hourSuffix = /\s*(?:h|hrs?|horas?)\.?$/iu;
  const text = raw.replace(hourSuffix, "");
  if (hourSuffix.test(raw) && /^\d{1,2}$/u.test(text)) {
    const hour = Number(text);
    return hour < 24 ? `${pad(hour)}:00` : "";
  }
  const match = text.match(/^(\d{1,2})(?:\s*[:.h]\s*)?(\d{2})(?::[0-5]\d)?(?:\s*([ap])\.?\s*m\.?)?$/iu);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem && (hour < 1 || hour > 12)) return "";
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return "";
  return `${pad(hour)}:${pad(minute)}`;
}

type ColumnKey =
  | "requestDate" | "requestTime" | "concreteType" | "quantity"
  | "element" | "interval" | "programmedDate" | "programmedTime"
  | "orderNumber" | "additions" | DeliveryMode;

const REQUIRED_HEADERS = [
  "requestDate", "requestTime", "concreteType", "quantity", "element",
  "programmedDate", "programmedTime", "orderNumber", "additions",
] satisfies ColumnKey[];
const FOLLOWING_SECTION_LABELS = new Set([
  "requiere servicio de laboratorio",
  "muestras de laboratorio",
  "informacion del rendimiento del antisol",
  "datos adicionales",
  "observaciones adicionales",
]);

function identifyHeader(value: string): ColumnKey | null {
  if (value === "concreto directo") return "DIRECT";
  if (value === "bomba") return "PUMP";
  if (value === "pluma") return "BOOM";
  if (value === "colocacion") return "PLACEMENT";
  if (value === "dia programado" || value === "fecha programada") return "programmedDate";
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

function populatedCell(row: Row, columns: readonly number[] = []) {
  for (const column of columns) {
    const cell = row.getCell(column);
    if (cellText(cell.value).trim()) return cell;
  }
}

function hasProgrammingData(row: Row, columns: ReadonlyMap<ColumnKey, number[]>) {
  return REQUIRED_HEADERS.some((key) => {
    const text = cellText(populatedCell(row, columns.get(key))?.value ?? null).trim();
    return Boolean(text) && identifyHeader(normalized(text)) !== key;
  });
}

function startsFollowingSection(row: Row) {
  let found = false;
  row.eachCell((cell) => {
    found ||= FOLLOWING_SECTION_LABELS.has(normalized(cellText(cell.value)));
  });
  return found;
}

function findHeaders(rows: readonly Row[]) {
  const columns = new Map<ColumnKey, number[]>();
  let inCastingSection = false;
  for (const [index, row] of rows.entries()) {
    if (!inCastingSection) {
      const labels: string[] = [];
      row.eachCell((cell) => labels.push(cellText(cell.value)));
      inCastingSection = normalized(labels.join(" ")).includes("datos para la fundicion");
      if (!inCastingSection) continue;
    }

    const hasRequiredHeaders = REQUIRED_HEADERS.every((key) => columns.has(key));
    if (hasRequiredHeaders && hasProgrammingData(row, columns)) {
      return { firstDataIndex: index, columns };
    }
    if (startsFollowingSection(row)) break;
    if (!hasRequiredHeaders) {
      const dateColumns = columns.get("programmedDate") ?? columns.get("requestDate");
      const dateCell = populatedCell(row, dateColumns);
      if (dateCell && parseMixtoDate(dateCell.value)) return null;
    }

    const headersInRow = new Map<ColumnKey, { anchor: string; columns: number[] }>();
    row.eachCell((cell, column) => {
      const key = identifyHeader(normalized(cellText(cell.value)));
      if (!key) return;
      const anchor = cell.master.address;
      const heading = headersInRow.get(key);
      if (!heading) headersInRow.set(key, { anchor, columns: [column] });
      else if (heading.anchor === anchor) heading.columns.push(column);
    });
    for (const [key, heading] of headersInRow) columns.set(key, heading.columns);
  }
  return REQUIRED_HEADERS.every((key) => columns.has(key))
    ? { firstDataIndex: rows.length, columns }
    : null;
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
    projectAdditionalAddresses: project.additionalAddresses,
    workbookAddress: extractProjectAddress(sheet),
    billingLegalName: project.billingLegalName,
    invoiceRecipient: extractInvoiceRecipient(sheet),
    candidateProjects: project.candidateProjects,
  });
  const workbookRows: Row[] = [];
  sheet.eachRow((row) => workbookRows.push(row));
  const headers = findHeaders(workbookRows);
  if (!headers) throw new Error(MIXTO_APPROVED_WORKBOOK_ERROR);

  const rows: BulkProgrammingPreviewRow[] = [];
  const date1904 = workbook.properties.date1904;
  for (const row of workbookRows.slice(headers.firstDataIndex)) {
    const rowNumber = row.number;
    const cellFor = (key: ColumnKey) => populatedCell(row, headers.columns.get(key));
    const value = (key: ColumnKey) => cellFor(key)?.value ?? null;

    const requestedDate = parseMixtoDate(value("requestDate"), date1904);
    const dateValue = value("programmedDate");
    const timeValue = value("programmedTime");
    const { date, warning: dateWarning } = approvedDate(dateValue, requestedDate, date1904);
    const time = parseMixtoTime(timeValue);
    if (!date && !time && startsFollowingSection(row)) break;
    if (!hasProgrammingData(row, headers.columns)) continue;

    const orderCell = cellFor("orderNumber");
    const orderNumber = orderCell ? cellDisplayText(orderCell).trim() : "";
    const concreteType = cellText(value("concreteType"));
    const quantity = Number(cellText(value("quantity")).replace(",", "."));
    const placementElement = cellText(value("element"));
    const additions = cellText(value("additions"));
    const truckInterval = cellText(value("interval"));
    const deliveryModes = DELIVERY_MODES.filter((mode) => {
      const mark = cellText(value(mode)).trim();
      if (!mark) return false;
      if (!/^[xX×✕✖]$/.test(mark)) {
        throw new Error(rowError(rowNumber, "la modalidad debe marcarse con X o quedar vacía"));
      }
      return true;
    });

    if (!orderNumber) throw new Error(rowError(rowNumber, "Pedido No. es obligatorio"));
    if (!concreteType) throw new Error(rowError(rowNumber, "Tipo de concreto es obligatorio"));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(rowError(rowNumber, "Volumen (m3) debe ser mayor que cero"));
    }
    if (!placementElement) throw new Error(rowError(rowNumber, "Elemento a fundir es obligatorio"));

    rows.push({
      sourceRow: rowNumber,
      scheduledAt: `${date}T${time}`,
      workbookDate: typeof formulaResult(dateValue) === "number" || formulaResult(dateValue) instanceof Date
        ? parseMixtoDate(dateValue, date1904) : cellText(dateValue),
      workbookTime: typeof formulaResult(timeValue) === "number" || formulaResult(timeValue) instanceof Date
        ? time || cellText(timeValue) : cellText(timeValue),
      requestedDate,
      dateWarning,
      orderNumber,
      concreteType,
      deliveryModes,
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
  return {
    rows,
    warnings: [
      ...reference.warnings,
      ...(rows.some((row) => !row.deliveryModes.length)
        ? ["Hay filas sin modalidad marcada. Se exigirán facturas de producto y servicio; no se asumirá concreto directo."]
        : []),
    ],
  };
}
