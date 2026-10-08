import ExcelJS from "exceljs";
import type { Cell, CellValue, Worksheet } from "exceljs";
import JSZip from "jszip";

import type {
  PriceCatalogKind,
  PriceCatalogPreview,
  PriceCatalogPreviewRow,
} from "./types.ts";

const { Workbook } = ExcelJS;

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CATALOG_ROWS = 10_000;

export const PRICE_CATALOG_FILE_ERROR =
  "Selecciona un archivo Excel .xlsx válido de hasta 10 MiB.";

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-zA-Z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function isFormula(value: CellValue) {
  return Boolean(
    value &&
      typeof value === "object" &&
      "formula" in value,
  );
}

function valueText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim();
    }
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return valueText(value.result as CellValue);
  }
  return String(value).trim();
}

function identifierText(cell: Cell) {
  if (
    typeof cell.value === "number" &&
    Number.isSafeInteger(cell.value) &&
    cell.value >= 0 &&
    /^0+$/u.test(cell.numFmt)
  ) {
    return String(cell.value).padStart(cell.numFmt.length, "0");
  }
  return cell.text.trim() || valueText(cell.value);
}

function parsePrice(cell: Cell) {
  const rawValue = isFormula(cell.value)
    ? (cell.value as { result?: CellValue }).result
    : cell.value;
  if (typeof rawValue === "number") {
    if (!Number.isFinite(rawValue) || rawValue < 0) return null;
    const rounded = Number(rawValue.toFixed(4));
    if (Math.abs(rawValue - rounded) > 1e-9) return null;
    const decimal = rounded.toFixed(4).replace(/\.?0+$/u, "");
    return /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u.test(decimal)
      ? decimal
      : null;
  }

  let text = valueText(rawValue)
    .replace(/[Q$\s]/gu, "")
    .trim();
  if (text.includes(",") && text.includes(".")) text = text.replace(/,/gu, "");
  else if (text.includes(",")) text = text.replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/u.test(text)) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric >= 0 ? text : null;
}

function hasZipSignature(bytes: Buffer) {
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

async function normalizeWorkbookXml(bytes: Buffer) {
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  if (
    !archive.file("[Content_Types].xml") ||
    !archive.file("xl/workbook.xml") ||
    archive.file(/(^|\/)vbaProject\.bin$/iu).length > 0 ||
    archive.file(/^xl\/macrosheets\//iu).length > 0
  ) {
    throw new Error(PRICE_CATALOG_FILE_ERROR);
  }

  const xmlFiles = Object.values(archive.files).filter(
    (entry) => !entry.dir && entry.name.startsWith("xl/") && entry.name.endsWith(".xml"),
  );
  await Promise.all(
    xmlFiles.map(async (entry) => {
      let xml = await entry.async("text");
      // Some spreadsheet generators emit very wide decorative tables whose
      // prefixed XML is not understood by ExcelJS. Tables are irrelevant for
      // this row-oriented import, so remove only their worksheet references.
      if (entry.name.startsWith("xl/worksheets/")) {
        xml = xml.replace(/<x:tableParts[\s\S]*?<\/x:tableParts>/gu, "");
      }
      if (!/<\/?x:/u.test(xml)) return;
      archive.file(
        entry.name,
        xml
          .replace(/xmlns:x="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/gu,
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
          .replace(/<(\/?)x:/gu, "<$1"),
      );
    }),
  );
  return Buffer.from(await archive.generateAsync({ type: "uint8array" }));
}

function findHeaderColumns(sheet: Worksheet, kind: PriceCatalogKind) {
  const required = kind === "PRODUCT"
    ? ["codigo", "referencia", "precio"]
    : ["codigo", "precio"];

  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 10); rowNumber += 1) {
    const columns = new Map<string, number>();
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const header = normalizeHeader(valueText(cell.value));
      if (required.includes(header) && !columns.has(header)) columns.set(header, columnNumber);
    });
    if (required.every((header) => columns.has(header))) {
      return { rowNumber, columns };
    }
  }
  return null;
}

function addDuplicateErrors(rows: PriceCatalogPreviewRow[], kind: PriceCatalogKind) {
  const grouped = new Map<string, PriceCatalogPreviewRow[]>();
  for (const row of rows) {
    if (!row.code || (kind === "PRODUCT" && !row.reference)) continue;
    const key = kind === "PRODUCT" ? `${row.code}\u0000${row.reference}` : row.code;
    const matches = grouped.get(key) ?? [];
    matches.push(row);
    grouped.set(key, matches);
  }
  for (const matches of grouped.values()) {
    if (matches.length < 2) continue;
    for (const row of matches) {
      row.errors.push(
        kind === "PRODUCT"
          ? "La combinación de código y referencia está duplicada."
          : "El código está duplicado.",
      );
    }
  }
}

function parseRows(
  sheet: Worksheet,
  kind: PriceCatalogKind,
  header: NonNullable<ReturnType<typeof findHeaderColumns>>,
) {
  const rows: PriceCatalogPreviewRow[] = [];
  let consecutiveEmptyRows = 0;
  for (
    let rowNumber = header.rowNumber + 1;
    rowNumber <= sheet.rowCount && rows.length <= MAX_CATALOG_ROWS;
    rowNumber += 1
  ) {
    const row = sheet.getRow(rowNumber);
    const codeCell = row.getCell(header.columns.get("codigo")!);
    const referenceCell = kind === "PRODUCT"
      ? row.getCell(header.columns.get("referencia")!)
      : null;
    const priceCell = row.getCell(header.columns.get("precio")!);
    const code = identifierText(codeCell).trim();
    const reference = referenceCell ? identifierText(referenceCell).trim() : null;
    const rawPrice = valueText(priceCell.value);

    if (!code && !reference && !rawPrice) {
      consecutiveEmptyRows += 1;
      if (consecutiveEmptyRows >= 20 && rows.length > 0) break;
      continue;
    }
    consecutiveEmptyRows = 0;

    const errors: string[] = [];
    if (!code) errors.push("El código es obligatorio.");
    else if (code.length > 120 || /[\u0000-\u001f\u007f]/u.test(code)) {
      errors.push("El código no es válido.");
    }
    if (
      typeof codeCell.value === "number" &&
      (!Number.isSafeInteger(codeCell.value) || codeCell.value < 0)
    ) {
      errors.push("El código numérico debe ser un entero seguro o estar guardado como texto.");
    }
    if (isFormula(codeCell.value)) errors.push("El código no puede ser una fórmula.");

    if (kind === "PRODUCT") {
      if (!reference) errors.push("La referencia es obligatoria.");
      else if (reference.length > 160 || /[\u0000-\u001f\u007f]/u.test(reference)) {
        errors.push("La referencia no es válida.");
      }
      if (referenceCell && isFormula(referenceCell.value)) {
        errors.push("La referencia no puede ser una fórmula.");
      }
    }

    const price = parsePrice(priceCell);
    if (price === null) {
      errors.push(
        isFormula(priceCell.value)
          ? "La fórmula del precio no tiene un resultado numérico válido."
          : "El precio debe ser un número finito mayor o igual a cero, con hasta 4 decimales.",
      );
    }

    rows.push({
      rowNumber,
      code,
      reference,
      price: price ?? rawPrice,
      errors,
    });
  }

  if (rows.length > MAX_CATALOG_ROWS) {
    throw new Error(`El catálogo no puede exceder ${MAX_CATALOG_ROWS.toLocaleString("es-GT")} registros.`);
  }
  addDuplicateErrors(rows, kind);
  return rows;
}

export async function parseProjectPriceCatalog(
  file: File,
  catalogKind: PriceCatalogKind,
): Promise<PriceCatalogPreview> {
  const extensionValid = file.name.toLowerCase().endsWith(".xlsx");
  const mimeValid = !file.type || file.type === XLSX_MIME;
  if (
    !extensionValid ||
    !mimeValid ||
    file.size === 0 ||
    file.size > MAX_FILE_BYTES ||
    /[\r\n\\/]/u.test(file.name)
  ) {
    throw new Error(PRICE_CATALOG_FILE_ERROR);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!hasZipSignature(bytes)) throw new Error(PRICE_CATALOG_FILE_ERROR);

  const workbook = new Workbook();
  try {
    const normalizedBytes = await normalizeWorkbookXml(bytes);
    await workbook.xlsx.load(
      normalizedBytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch (error) {
    if (error instanceof Error && error.message === PRICE_CATALOG_FILE_ERROR) throw error;
    throw new Error(PRICE_CATALOG_FILE_ERROR);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("El Excel no contiene una hoja de cálculo.");
  const header = findHeaderColumns(sheet, catalogKind);
  if (!header) {
    throw new Error(
      catalogKind === "PRODUCT"
        ? "El Excel debe incluir las columnas codigo, referencia y precio."
        : "El Excel debe incluir las columnas codigo y precio.",
    );
  }

  const rows = parseRows(sheet, catalogKind, header);
  if (rows.length === 0) throw new Error("El Excel no contiene registros para importar.");
  const errorCount = rows.filter((row) => row.errors.length > 0).length;
  return {
    fileName: file.name,
    catalogKind,
    rows,
    totalCount: rows.length,
    validCount: rows.length - errorCount,
    errorCount,
  };
}
