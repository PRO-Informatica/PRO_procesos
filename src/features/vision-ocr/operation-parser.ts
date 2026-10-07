import type { GoogleVisionResponse } from "./vision-ocr.ts";
import {
  cleanDetectedValue,
  extractVisionLayoutWords,
  groupOcrLines,
  normalizeOcrText,
  ocrLineIncludesLabel,
  ocrLineText,
  ocrValueAfterLabel,
  readOcrLabeledValue,
  wordsInOcrRegion,
  type VisionLayoutWord,
} from "./guide-parser.ts";

export type ParsedMixtoOperation = {
  templateType: "MIXTO_OPERATION";
  date: string | null;
  orderedBy: string | null;
  orderNumber: string | null;
  equipmentNumber: string | null;
  concreteType: string | null;
  estimatedVolume: string | null;
  realVolume: string | null;
  curedByMixto: boolean | null;
  warnings: string[];
};

export type ParsedPanexusOperation = {
  templateType: "PANEXUS_OPERATION";
  date: string | null;
  code: string | null;
  pumpingStartTime: string | null;
  pumpingEndTime: string | null;
  equipmentNumber: string | null;
  concreteType: string | null;
  estimatedVolume: string | null;
  realVolume: string | null;
  observations: string | null;
  warnings: string[];
};

function regionLines(words: VisionLayoutWord[], xStart: number, xEnd: number, yStart: number, yEnd: number) {
  return groupOcrLines(wordsInOcrRegion(words, xStart, xEnd, yStart, yEnd));
}

function regionText(
  words: VisionLayoutWord[],
  bounds: [number, number, number, number],
  excluded: string[] = [],
) {
  const excludedTokens = new Set(excluded.flatMap((value) => normalizeOcrText(value).split(" ")));
  const selected = wordsInOcrRegion(words, ...bounds).filter((word) => !excludedTokens.has(normalizeOcrText(word.text)));
  const text = groupOcrLines(selected).map(ocrLineText).join(" ");
  return cleanDetectedValue(text);
}

function labeledRegionValue(
  words: VisionLayoutWord[],
  bounds: [number, number, number, number],
  label: string,
  stopLabels: string[] = [],
  maximumLines = 2,
) {
  return readOcrLabeledValue(regionLines(words, ...bounds), label, stopLabels, maximumLines);
}

function compactNumber(value: string | null) {
  if (!value) return null;
  const match = value.match(/\d+(?:[.,:]\d+)?/u)?.[0];
  return match?.replace(/\s+/gu, "") ?? null;
}

const MONTHS = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
] as const;

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function normalizeMonth(value: string | null) {
  if (!value) return null;
  const numeric = value.match(/\b(?:0?[1-9]|1[0-2])\b/u)?.[0];
  if (numeric) return numeric.padStart(2, "0");
  const candidate = normalizeOcrText(value).replace(/[^A-Z]/gu, "");
  if (!candidate) return null;
  const match = MONTHS
    .map((month, index) => ({ month, index, distance: editDistance(candidate, month) }))
    .sort((left, right) => left.distance - right.distance)[0];
  const tolerance = Math.max(2, Math.floor(match.month.length * 0.35));
  return match.distance <= tolerance ? String(match.index + 1).padStart(2, "0") : null;
}

function normalizeYear(value: string | null) {
  const digits = value?.match(/\d{2,4}/u)?.[0];
  if (!digits) return null;
  return digits.length === 2 ? `20${digits}` : digits;
}

function normalizeDay(value: string | null) {
  const digits = value?.match(/\b(?:[1-9]|[12]\d|3[01])\b/u)?.[0];
  return digits?.padStart(2, "0") ?? null;
}

function parseOperationDate(words: VisionLayoutWord[], rawText = "") {
  const controlStart = rawText.search(/PEDIDO\s*\/?\s*CONTROL\s+OPERACI[OÓ]N/iu);
  const dateHeader = controlStart >= 0 ? rawText.slice(controlStart, controlStart + 1200) : rawText.slice(0, 1200);
  const numericDate = dateHeader.match(/\b([0-3]?\d)[/-]([01]?\d)(?:[/-](\d{2,4}))?\b/u);
  let day = numericDate ? normalizeDay(numericDate[1]) : null;
  let month = numericDate ? normalizeMonth(numericDate[2]) : null;
  let year = numericDate?.[3] ? normalizeYear(numericDate[3]) : null;

  day ??= normalizeDay(dateHeader.match(/GUATEMALA\s*,?\s*(\d{1,2})/iu)?.[1] ?? null);
  month ??= normalizeMonth(dateHeader.match(/\bMES\b\s*\n?\s*([^\n]+)/iu)?.[1] ?? null);
  const valuesAfterDayLabel = dateHeader.match(/\bDIA\b[^\n]*\n((?:[^\n]*\n?){1,3})/iu)?.[1]
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => /\p{L}/u.test(value)) ?? [];
  if (!month) {
    month = valuesAfterDayLabel.map(normalizeMonth).find((value) => value !== null) ?? null;
  }
  year ??= normalizeYear(dateHeader.match(/\bA[NÑ]O\b\s*\n?\s*(\d{2,4})/iu)?.[1] ?? null);

  day ??= normalizeDay(regionText(words, [0.40, 0.60, 0.06, 0.155], ["GUATEMALA", "DIA"]));
  month ??= normalizeMonth(regionText(words, [0.57, 0.84, 0.06, 0.155], ["MES"]));
  year ??= normalizeYear(regionText(words, [0.82, 0.99, 0.06, 0.155], ["ANO"]));

  return day && month && year ? `${day}/${month}/${year}` : null;
}

function missingWarnings(fields: Array<[unknown, string]>) {
  const missing = fields.filter(([value]) => value === null || value === "").map(([, label]) => label);
  return missing.length ? [`No se identificó con seguridad: ${missing.join(", ")}.`] : [];
}

function parseOperationNumber(
  words: VisionLayoutWord[],
  templateType: "MIXTO_OPERATION" | "PANEXUS_OPERATION",
  rawText = "",
) {
  const rawNumber = rawText.match(/(?:^|\n)No\s*:\s*(\d+)/u)?.[1];
  if (rawNumber) return rawNumber;
  const lines = regionLines(words, 0.02, 0.75, 0.24, 0.58);
  const equipmentLine = lines.find((line) => ocrLineIncludesLabel(line, "EQUIPO") && ocrLineIncludesLabel(line, "NO"));
  const labeled = compactNumber(equipmentLine ? cleanDetectedValue(ocrValueAfterLabel(equipmentLine, "NO")) : null);
  if (labeled) return labeled;
  return compactNumber(regionText(
    words,
    templateType === "PANEXUS_OPERATION" ? [0.36, 0.55, 0.29, 0.38] : [0.35, 0.55, 0.36, 0.46],
    ["NO", "CANT", "VIBRADORES"],
  ));
}

function parseConcreteType(
  words: VisionLayoutWord[],
  templateType: "MIXTO_OPERATION" | "PANEXUS_OPERATION",
  rawText = "",
) {
  const rawValue = cleanDetectedValue(rawText.match(/(?:TIPO|TPO)\s+DE\s+CONCRETO\s*:?[ \t]*([^\n]+)/iu)?.[1] ?? "");
  if (rawValue) return rawValue;
  const lines = regionLines(words, 0.45, 0.99, 0.24, 0.58);
  const labeled = readOcrLabeledValue(lines, "TIPO DE CONCRETO", ["VOLUMEN", "ML DE CORTE"], 1)
    ?? readOcrLabeledValue(lines, "TPO DE CONCRETO", ["VOLUMEN", "ML DE CORTE"], 1);
  if (labeled) return labeled;
  return regionText(
    words,
    templateType === "PANEXUS_OPERATION" ? [0.62, 0.99, 0.32, 0.43] : [0.62, 0.99, 0.38, 0.49],
    ["TIPO", "TPO", "DE", "CONCRETO", "ML", "CORTE"],
  );
}

function parseEstimatedVolume(words: VisionLayoutWord[]) {
  return compactNumber(readOcrLabeledValue(regionLines(words, 0.02, 0.52, 0.30, 0.62), "VOLUMEN ESTIMADO", ["CURADO"], 1));
}

function parseRealVolume(words: VisionLayoutWord[]) {
  return compactNumber(readOcrLabeledValue(regionLines(words, 0.40, 0.78, 0.30, 0.62), "VOLUMEN REAL", ["CURADO", "ARMADO"], 1));
}

export function parseMixtoOperationWords(
  words: VisionLayoutWord[],
  curedByMixto: boolean | null,
  rawText = "",
): ParsedMixtoOperation {
  const date = parseOperationDate(words, rawText);
  const orderedBy = labeledRegionValue(words, [0.02, 0.78, 0.13, 0.22], "PEDIDO POR", ["OBRA"], 2)
    ?.replace(/\s+R\.?\s*C\.?\s*#.*$/iu, "")
    .trim() || null;
  const orderNumber = compactNumber(labeledRegionValue(words, [0.66, 0.99, 0.17, 0.31], "PEDIDO NO", ["NIT"], 2));
  const equipmentNumber = parseOperationNumber(words, "MIXTO_OPERATION", rawText);
  const concreteType = parseConcreteType(words, "MIXTO_OPERATION", rawText);
  const estimatedVolume = parseEstimatedVolume(words);
  const realVolume = parseRealVolume(words);
  const warnings = missingWarnings([
    [date, "fecha"],
    [orderedBy, "pedido por"],
    [orderNumber, "número de pedido"],
    [equipmentNumber, "No. de equipo"],
    [concreteType, "tipo de concreto"],
    [estimatedVolume, "volumen estimado"],
    [realVolume, "volumen real"],
    [curedByMixto, "casilla curado por Mixto Listo"],
  ]);
  warnings.push("Los valores manuscritos deben compararse con la fotografía antes de utilizarlos.");
  return {
    templateType: "MIXTO_OPERATION",
    date,
    orderedBy,
    orderNumber,
    equipmentNumber,
    concreteType,
    estimatedVolume,
    realVolume,
    curedByMixto,
    warnings,
  };
}

export function parsePanexusOperationWords(words: VisionLayoutWord[], rawText = ""): ParsedPanexusOperation {
  const date = parseOperationDate(words, rawText);
  const code = compactNumber(labeledRegionValue(words, [0.67, 0.99, 0.10, 0.25], "CODIGO", ["NO FACTURA", "NIT"], 2));
  const pumpingStartLines = regionLines(words, 0.02, 0.47, 0.20, 0.45);
  const pumpingStartTime = cleanDetectedValue(rawText.match(/HORA\s+DE\s+INICIO(?:\s+DE)?\s+BOMBEO\s*:?[ \t]*([^\n]+)/iu)?.[1] ?? "")
    ?? readOcrLabeledValue(pumpingStartLines, "HORA DE INICIO BOMBEO", ["EQUIPO"], 1)
    ?? readOcrLabeledValue(pumpingStartLines, "HORA DE INICIO DE BOMBEO", ["EQUIPO"], 1);
  const pumpingEndTime = readOcrLabeledValue(regionLines(words, 0.43, 0.99, 0.20, 0.45), "HORA FINALIZACION BOMBEO", ["CANT VIBRADORES"], 1);
  const equipmentNumber = parseOperationNumber(words, "PANEXUS_OPERATION", rawText);
  const concreteType = parseConcreteType(words, "PANEXUS_OPERATION", rawText);
  const estimatedVolume = parseEstimatedVolume(words);
  const realVolume = parseRealVolume(words);
  const observations = readOcrLabeledValue(
    regionLines(words, 0.015, 0.99, 0.55, 0.88),
    "OBSERVACIONES",
    ["RECIBI CONFORME"],
    10,
  );
  const warnings = missingWarnings([
    [date, "fecha"],
    [code, "código"],
    [pumpingStartTime, "hora de inicio de bombeo"],
    [pumpingEndTime, "hora de finalización de bombeo"],
    [equipmentNumber, "No. de equipo"],
    [concreteType, "tipo de concreto"],
    [estimatedVolume, "volumen estimado"],
    [realVolume, "volumen real"],
    [observations, "observaciones"],
  ]);
  warnings.push("La escritura manual se conserva según el OCR y requiere revisión visual.");
  return {
    templateType: "PANEXUS_OPERATION",
    date,
    code,
    pumpingStartTime,
    pumpingEndTime,
    equipmentNumber,
    concreteType,
    estimatedVolume,
    realVolume,
    observations,
    warnings,
  };
}

export function parseMixtoOperation(response: GoogleVisionResponse, curedByMixto: boolean | null) {
  return parseMixtoOperationWords(
    extractVisionLayoutWords(response),
    curedByMixto,
    response.responses?.[0]?.fullTextAnnotation?.text ?? "",
  );
}

export function parsePanexusOperation(response: GoogleVisionResponse) {
  return parsePanexusOperationWords(
    extractVisionLayoutWords(response),
    response.responses?.[0]?.fullTextAnnotation?.text ?? "",
  );
}
