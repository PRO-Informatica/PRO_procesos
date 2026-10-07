import type { GoogleVisionResponse } from "./vision-ocr";

export type VisionLayoutWord = {
  text: string;
  xStart: number;
  xEnd: number;
  yStart: number;
  yEnd: number;
};

export type DispatchGuideItem = {
  quantity: string;
  unit: string;
  productCode: string;
  description: string;
};

export type ParsedDispatchGuide = {
  customerName: string | null;
  projectName: string | null;
  workAddress: string | null;
  dispatchGuideNumber: string | null;
  orderNumber: string | null;
  items: DispatchGuideItem[];
  warnings: string[];
};

export type OcrLine = {
  words: VisionLayoutWord[];
  yCenter: number;
};

export function normalizeOcrText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^A-Z0-9]+/giu, " ")
    .trim()
    .toUpperCase();
}

export function ocrLineText(line: OcrLine) {
  return line.words.map((word) => word.text).join(" ").replace(/\s+/gu, " ").trim();
}

export function groupOcrLines(words: VisionLayoutWord[]) {
  const sorted = [...words].sort((left, right) => {
    const leftY = (left.yStart + left.yEnd) / 2;
    const rightY = (right.yStart + right.yEnd) / 2;
    return leftY - rightY || left.xStart - right.xStart;
  });
  const lines: OcrLine[] = [];

  for (const word of sorted) {
    const yCenter = (word.yStart + word.yEnd) / 2;
    const closest = lines
      .map((line, index) => ({ index, distance: Math.abs(line.yCenter - yCenter) }))
      .filter(({ distance }) => distance <= 0.014)
      .sort((left, right) => left.distance - right.distance)[0];

    if (!closest) {
      lines.push({ words: [word], yCenter });
      continue;
    }

    const line = lines[closest.index];
    line.words.push(word);
    line.yCenter = line.words.reduce((total, current) => total + ((current.yStart + current.yEnd) / 2), 0) / line.words.length;
  }

  return lines
    .map((line) => ({ ...line, words: [...line.words].sort((left, right) => left.xStart - right.xStart) }))
    .sort((left, right) => left.yCenter - right.yCenter);
}

export function wordsInOcrRegion(words: VisionLayoutWord[], xStart: number, xEnd: number, yStart: number, yEnd: number) {
  return words.filter((word) => {
    const xCenter = (word.xStart + word.xEnd) / 2;
    const yCenter = (word.yStart + word.yEnd) / 2;
    return xCenter >= xStart && xCenter <= xEnd && yCenter >= yStart && yCenter <= yEnd;
  });
}

export function ocrLineIncludesLabel(line: OcrLine, label: string) {
  const labelParts = normalizeOcrText(label).split(" ");
  const normalizedWords = line.words.map((word) => normalizeOcrText(word.text)).filter(Boolean);
  return normalizedWords.some((_, start) => (
    labelParts.every((part, offset) => normalizedWords[start + offset] === part)
  ));
}

export function ocrValueAfterLabel(line: OcrLine, label: string) {
  const labelParts = normalizeOcrText(label).split(" ");
  const normalizedWords = line.words.map((word) => normalizeOcrText(word.text));
  let matched = 0;

  for (let index = 0; index < normalizedWords.length; index += 1) {
    if (normalizedWords[index] === labelParts[matched]) {
      matched += 1;
      if (matched === labelParts.length) {
        return line.words.slice(index + 1).map((word) => word.text).join(" ").trim();
      }
    } else {
      matched = normalizedWords[index] === labelParts[0] ? 1 : 0;
    }
  }
  return "";
}

export function cleanDetectedValue(value: string) {
  const cleaned = value.replace(/^[\s:;,.|/\\-]+/u, "").replace(/\s+/gu, " ").trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : null;
}

export function readOcrLabeledValue(lines: OcrLine[], label: string, stopLabels: string[], maximumLines: number) {
  const start = lines.findIndex((line) => ocrLineIncludesLabel(line, label));
  if (start < 0) return null;

  const values: string[] = [];
  const sameLineValue = cleanDetectedValue(ocrValueAfterLabel(lines[start], label));
  if (sameLineValue) values.push(sameLineValue);

  for (let index = start + 1; index < lines.length && values.length < maximumLines; index += 1) {
    if (stopLabels.some((stopLabel) => ocrLineIncludesLabel(lines[index], stopLabel))) break;
    const rawValue = ocrLineIncludesLabel(lines[index], label)
      ? ocrValueAfterLabel(lines[index], label)
      : ocrLineText(lines[index]);
    const value = cleanDetectedValue(rawValue);
    if (value) values.push(value);
  }

  return values.join(" ").replace(/\s+/gu, " ").trim() || null;
}

export function firstOcrNumber(value: string | null, minimumDigits = 1) {
  if (!value) return null;
  const candidates = value.match(/\d[\d\s.-]*/gu) ?? [];
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/gu, "");
    if (digits.length >= minimumDigits) return digits;
  }
  return null;
}

function findHeaderWord(words: VisionLayoutWord[], label: string) {
  const normalizedLabel = normalizeOcrText(label);
  return words.find((word) => normalizeOcrText(word.text) === normalizedLabel);
}

type TableCell = { text: string; yCenter: number };

function tableCells(words: VisionLayoutWord[], xStart: number, xEnd: number): TableCell[] {
  return groupOcrLines(words.filter((word) => {
    const xCenter = (word.xStart + word.xEnd) / 2;
    return xCenter >= xStart && xCenter < xEnd;
  })).map((line) => ({ text: ocrLineText(line), yCenter: line.yCenter }));
}

function nearestCell(cells: TableCell[], yCenter: number, maximumDistance = 0.018) {
  const match = cells
    .map((cell) => ({ cell, distance: Math.abs(cell.yCenter - yCenter) }))
    .filter(({ distance }) => distance <= maximumDistance)
    .sort((left, right) => left.distance - right.distance)[0];
  return match?.cell.text.trim() ?? "";
}

function parseItems(words: VisionLayoutWord[]) {
  const tableWords = wordsInOcrRegion(words, 0.025, 0.79, 0.30, 0.79);
  const quantityHeader = findHeaderWord(tableWords, "CANTIDAD");
  const unitHeader = findHeaderWord(tableWords, "UM");
  const codeHeader = findHeaderWord(tableWords, "CODIGO");
  const descriptionHeader = findHeaderWord(tableWords, "DESCRIPCION");
  if (!quantityHeader || !unitHeader || !codeHeader || !descriptionHeader) return [];

  const centers = [quantityHeader, unitHeader, codeHeader, descriptionHeader]
    .map((word) => (word.xStart + word.xEnd) / 2);
  const boundaries = [
    (centers[0] + centers[1]) / 2,
    (centers[1] + centers[2]) / 2,
    (centers[2] + centers[3]) / 2,
  ];
  const headerBottom = Math.max(quantityHeader.yEnd, unitHeader.yEnd, codeHeader.yEnd, descriptionHeader.yEnd);
  const footer = words
    .filter((word) => ["PILOTO", "OBSERVACIONES"].includes(normalizeOcrText(word.text)))
    .map((word) => word.yStart)
    .sort((left, right) => left - right)[0] ?? 0.79;
  const content = tableWords.filter((word) => {
    const yCenter = (word.yStart + word.yEnd) / 2;
    return yCenter > headerBottom + 0.006 && yCenter < footer - 0.006;
  });

  const quantityStart = Math.max(0.04, quantityHeader.xStart - 0.02);
  const quantityCells = tableCells(content, quantityStart, boundaries[0])
    .map((cell) => ({ ...cell, text: cell.text.replace(/\s/gu, "") }))
    .filter((cell) => /^\d+(?:[.,]\d+)?$/u.test(cell.text));
  const unitCells = tableCells(content, boundaries[0], boundaries[1]);
  const codeCells = tableCells(content, boundaries[1], boundaries[2]);
  const descriptionCells = tableCells(content, boundaries[2], 0.79);

  return quantityCells.map((quantity) => ({
    quantity: quantity.text,
    unit: nearestCell(unitCells, quantity.yCenter),
    productCode: nearestCell(codeCells, quantity.yCenter).replace(/\s+/gu, ""),
    description: nearestCell(descriptionCells, quantity.yCenter).replace(/\s+/gu, " "),
  }));
}

export function extractVisionLayoutWords(response: GoogleVisionResponse): VisionLayoutWord[] {
  const pages = response.responses?.[0]?.fullTextAnnotation?.pages ?? [];
  return pages.flatMap((page) => {
    const width = page.width || 1;
    const height = page.height || 1;
    return (page.blocks ?? []).flatMap((block) => (block.paragraphs ?? []).flatMap((paragraph) => (
      (paragraph.words ?? []).flatMap((word) => {
        const text = (word.symbols ?? []).map((symbol) => symbol.text ?? "").join("").trim();
        const vertices = word.boundingBox?.vertices ?? [];
        const xs = vertices.map((vertex) => vertex.x ?? 0);
        const ys = vertices.map((vertex) => vertex.y ?? 0);
        if (!text || !xs.length || !ys.length) return [];
        return [{
          text,
          xStart: Math.min(...xs) / width,
          xEnd: Math.max(...xs) / width,
          yStart: Math.min(...ys) / height,
          yEnd: Math.max(...ys) / height,
        }];
      })
    )));
  });
}

export function parseDispatchGuideWords(words: VisionLayoutWord[]): ParsedDispatchGuide {
  const customerLines = groupOcrLines(wordsInOcrRegion(words, 0.025, 0.43, 0.12, 0.34));
  const addressLines = groupOcrLines(wordsInOcrRegion(words, 0.40, 0.80, 0.12, 0.34));
  const guideLines = groupOcrLines(wordsInOcrRegion(words, 0.70, 0.99, 0.01, 0.19));
  const orderLines = groupOcrLines(wordsInOcrRegion(words, 0.76, 0.99, 0.15, 0.35));

  const customerName = readOcrLabeledValue(customerLines, "NOMBRE DEL CLIENTE", ["PROYECTO"], 2);
  const projectName = readOcrLabeledValue(customerLines, "PROYECTO", [], 2);
  const workAddress = readOcrLabeledValue(addressLines, "DIRECCION DE OBRA", [], 3);
  const dispatchGuideNumber = firstOcrNumber(readOcrLabeledValue(guideLines, "GUIA DE DESPACHO", [], 3), 5);
  const orderNumber = firstOcrNumber(readOcrLabeledValue(orderLines, "NO PEDIDO", [], 2));
  const items = parseItems(words);

  const missing = [
    [customerName, "nombre del cliente"],
    [projectName, "proyecto"],
    [workAddress, "dirección de obra"],
    [dispatchGuideNumber, "número de guía"],
    [orderNumber, "número de pedido"],
  ].filter(([value]) => !value).map(([, label]) => label);
  const warnings: string[] = [];
  if (missing.length) warnings.push(`No se identificó con seguridad: ${missing.join(", ")}.`);
  if (!items.length) warnings.push("No se identificaron filas de producto con seguridad.");

  return {
    customerName,
    projectName,
    workAddress,
    dispatchGuideNumber,
    orderNumber,
    items,
    warnings,
  };
}

export function parseDispatchGuide(response: GoogleVisionResponse) {
  return parseDispatchGuideWords(extractVisionLayoutWords(response));
}
