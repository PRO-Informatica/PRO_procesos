import { orientedGuideWords } from "./complete-guide-parser.ts";
import { CONTROL_HEADINGS } from "./control-template.ts";
import { normalizeOcrText } from "./guide-parser.ts";
import { emptyGuideDetails, normalizeGuideDate, normalizeGuideTime, type GuideOcrDraft } from "./guide-draft.ts";
import type { GoogleVisionResponse } from "./vision-ocr.ts";

type Word = ReturnType<typeof orientedGuideWords>[number];
const cx = (word: Word) => word.x + word.w / 2;
const cy = (word: Word) => word.y + word.h / 2;
const MONTHS = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const ALIASES = {
  heading: [...CONTROL_HEADINGS],
  serial: ["NUMERO DE CONTROL", "NUMERO CONTROL", "NO DE CONTROL", "NO CONTROL", "NUMERO DE DOCUMENTO", "NO DOCUMENTO", "NUMERO DE GUIA", "NO GUIA"],
  order: ["NUMERO DE PEDIDO", "NO DE PEDIDO", "NO PEDIDO", "PEDIDO NO", "NUMERO PEDIDO", "CODIGO DE PEDIDO", "CODIGO PEDIDO"],
  orderCode: ["CODIGO"],
  date: ["FECHA DE EMISION", "FECHA"], day: ["DIA"], month: ["MES"], year: ["ANO"],
  real: ["VOLUMEN REAL", "VOLUMEN EJECUTADO", "VOLUMEN BOMBEADO"],
  estimated: ["VOLUMEN PROGRAMADO", "VOLUMEN ESTIMADO"],
  truck: ["NUMERO DE CAMION", "NO DE CAMION", "NO CAMION", "CAMION NO", "CAMION"],
  arrival: ["LLEGADA DEL CAMION", "LLEGADA DE CAMION", "LLEGADA A OBRA", "LLEGADA OBRA", "LLEGA A OBRA", "LLEGA OBRA"],
  departure: ["SALIDA DEL CAMION", "SALIDA DE CAMION", "SALIDA DE OBRA", "SALE DE OBRA", "SALE OBRA"],
  pumpingStart: ["HORA DE INICIO DE BOMBEO", "HORA DE INICIO BOMBEO", "HORA INICIO DE BOMBEO", "HORA INICIO BOMBEO"],
  pumpingEnd: ["HORA DE FINALIZACION DE BOMBEO", "HORA FINALIZACION DE BOMBEO", "HORA DE FINALIZACION BOMBEO", "HORA FINALIZACION BOMBEO", "HORA FIN BOMBEO", "HORA DE FIN BOMBEO"],
  equipment: ["NUMERO DEL EQUIPO", "NUMERO DE EQUIPO", "EQUIPO NO", "NO EQUIPO"],
  concrete: ["TIPO DE CONCRETO", "TPO DE CONCRETO"],
  observations: ["OBSERVACIONES IMPORTANTES", "OBSERVACIONES", "OBSERVACION"],
  signature: ["RECIBI CONFORME", "RECIBE CONFORME", "FIRMA OBRA", "FIRMA Y SELLO", "ORIGINAL CLIENTE", "BLANCO ORIGINAL"],
  // Neighboring boxes delimit values even when they are not form fields.
  customer: ["NOMBRE DEL CLIENTE", "PEDIDO POR"], address: ["DIRECCION DE OBRA", "DIRECCION OBRA"],
  project: ["OBRA"], invoice: ["NO FACTURA", "NUMERO DE FACTURA", "FACTURAR A", "NIT"],
  equipmentKind: ["EQUIPO"], scheduledTime: ["HORA PROGRAMADA"], tubes: ["NO TUBOS", "NUMERO DE TUBOS"],
  casting: ["TIPO DE FUNDICION", "ELEMENTO A FUNDIR"], level: ["NIVEL"],
  falseFreight: ["FLETE FALSO"], curing: ["APLICACION DE ANTISOL", "CURADO POR"],
  area: ["AREA EN M2", "AREA EN METROS CUADRADOS"], group: ["JEFE DE GRUPO", "GRUPO DE TRABAJO"],
  people: ["NUMERO DE PERSONAS", "CANT VIBRADORES"], pipe: ["ARMADO DE TUBERIA", "TUBERIA DEJADA EN OBRA", "ML DE CORTE"],
  commercialCode: ["CODIGO PRODUCTO", "CODIGO DE PRODUCTO", "CODIGO SERVICIO", "CODIGO DE SERVICIO"],
};

function lines(words: Word[]) {
  const rows: Word[][] = [];
  for (const word of [...words].sort((a, b) => cy(a) - cy(b))) {
    const row = rows.find((row) => Math.abs(cy(row[0]) - cy(word)) < Math.max(.006, Math.min(row[0].h, word.h) * .7));
    if (row) row.push(word); else rows.push([word]);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}
const lineText = (words: Word[]) => words.map((word) => word.text).join(" ").replace(/\s+([,.;:])/gu, "$1").trim();
const text = (words: Word[]) => lines(words).map(lineText).join("\n");
function findControlLabels(words: Word[], aliases: Record<string, readonly string[]>) {
  // Match consecutive text on a row, not supplier-specific box positions or
  // fixed gaps between printed words. Vision can split or combine OCR words.
  return lines(words).flatMap((row) => {
    const tokens = row.flatMap((word) => normalizeOcrText(word.text.replace(/N[º°]/giu, "NO")).split(" ").filter(Boolean).map((text) => ({ text, word })));
    return tokens.flatMap((_, index) => Object.entries(aliases).flatMap(([name, options]) => {
      const option = [...options].sort((a, b) => b.length - a.length).find((alias) => alias.split(" ").every((part, offset) => tokens[index + offset]?.text === part));
      if (!option) return [];
      const matched = [...new Set(tokens.slice(index, index + option.split(" ").length).map((item) => item.word))];
      return [{ name, words: matched, x: matched[0].x, y: Math.min(...matched.map((word) => word.y)),
        right: Math.max(...matched.map((word) => word.x + word.w)), bottom: Math.max(...matched.map((word) => word.y + word.h)) }];
    }));
  });
}

export function readServicesControlFields(words: Word[], rawText = "") {
  const found = findControlLabels(words, ALIASES);
  // Some controls print EQUIPO: Bomba | No.: 43. The contextual No. belongs
  // to that equipment only, never to the order or truck.
  for (const serial of findControlLabels(words, { equipment: ["NO"] })) {
    if (found.some((item) => item.name === "equipmentKind" && item.right < serial.x
      && Math.abs(item.y - serial.y) < .02)) found.push(serial);
  }
  // Longer labels must win over their contained aliases (e.g. No. de camión).
  const headings = found.filter((item) => item.name === "heading");
  const labels = found.filter((label) => !found.some((other) => other.words.length > label.words.length
    && label.words.every((word) => other.words.includes(word))))
    // In "Control de pedido No. 03794", Pedido No. is part of the title and
    // its folio, not the customer's order field further down the form.
    .filter((label) => label.name !== "order" || !headings.some((heading) => label.words.some((word) => heading.words.includes(word))));
  const label = (name: keyof typeof ALIASES) => labels.filter((item) => item.name === name).sort((a, b) => a.y - b.y || b.words.length - a.words.length)[0];
  const confidence: GuideOcrDraft["confidence"] = {};
  const score = (key: string, values: Word[]) => { confidence[key] = values.length ? Math.min(...values.map((word) => word.confidence ?? 0)) : null; };
  const fieldRegions = (name: keyof typeof ALIASES) => {
    const target = label(name);
    if (!target) return [];
    const sameRow = (word: Word) => Math.abs(cy(word) - (target.y + target.bottom) / 2) < Math.max(.012, (target.bottom - target.y) * .85);
    const next = labels.filter((other) => other !== target && other.x >= target.right - .002
      && Math.abs((other.y + other.bottom - target.y - target.bottom) / 2) < .025).sort((a, b) => a.x - b.x)[0];
    const right = next?.x ?? 1;
    const otherLabelWords = new Set(labels.flatMap((item) => item.words));
    const row = words.filter((word) => word.x >= target.right - .002 && cx(word) < right - .002 && sameRow(word) && !otherLabelWords.has(word));
    const lower = labels.filter((other) => other !== target && other.y > target.bottom + .004
      && other.x >= target.x - .025 && other.x < right).sort((a, b) => a.y - b.y)[0];
    const below = words.filter((word) => cx(word) >= target.x - .025 && cx(word) < right - .002
      && cy(word) > target.bottom && cy(word) < Math.min(lower?.y ?? 1, target.bottom + .09) && !otherLabelWords.has(word));
    return [row, ...lines(below)];
  };
  const number = (name: keyof typeof ALIASES, key: string, pattern = /^\d+(?:[.,]\d+)?$/u) => {
    for (const region of fieldRegions(name)) {
      const values = region.filter((word) => pattern.test(word.text));
      if (values.length > 1) { confidence[key] = null; return ""; }
      if (values.length === 1) { score(key, values); return values[0].text; }
    }
    confidence[key] = null;
    return "";
  };
  const value = (name: keyof typeof ALIASES) => fieldRegions(name).map(lineText).find(Boolean) ?? "";
  let guideNumber = number("serial", "guideNumber", /^\d{4,12}$/u);
  if (!guideNumber) {
    const heading = label("heading");
    if (heading) {
      const serials = words.filter((word) => cx(word) > heading.right && /^\d{4,12}$/u.test(word.text)
        && Math.abs(cy(word) - (heading.y + heading.bottom) / 2) < Math.max(.025, heading.bottom - heading.y));
      if (serials.length === 1) { guideNumber = serials[0].text; score("guideNumber", serials); }
    }
  }
  const controlBody = Math.min(...labels.filter((item) => ["pumpingStart", "pumpingEnd", "equipment", "equipmentKind", "estimated", "real", "observations"].includes(item.name)).map((item) => item.y), 1);
  const orderNumber = label("order") ? number("order", "orderNumber", /^\d{1,12}$/u)
    : label("orderCode") && label("orderCode")!.y < controlBody ? number("orderCode", "orderNumber", /^\d{1,12}$/u) : "";
  let guideDate = fieldRegions("date").map(lineText).map(normalizeGuideDate).find(Boolean) ?? "";
  const day = label("day"), month = label("month"), year = label("year");
  if (!guideDate && day && month && year) {
    const leftBoundary = (day.right + month.x) / 2;
    const rightBoundary = (month.right + year.x) / 2;
    const top = Math.min(day.y, month.y, year.y) - .005;
    const nextRow = Math.min(...labels.filter((item) => !["day", "month", "year", "date"].includes(item.name)
      && item.y > Math.max(day.bottom, month.bottom, year.bottom) + .005).map((item) => item.y), 1);
    const bottom = Math.min(nextRow, Math.max(day.bottom, month.bottom, year.bottom) + .09);
    const dateLabels = new Set(labels.flatMap((item) => item.words));
    const band = words.filter((word) => cy(word) >= top && cy(word) < bottom && !dateLabels.has(word));
    const days = band.filter((word) => cx(word) >= day.x - .12 && cx(word) < leftBoundary && /^(?:0?[1-9]|[12]\d|3[01])$/u.test(word.text));
    const years = band.filter((word) => cx(word) >= rightBoundary && /^(?:\d{2}|20\d{2})$/u.test(word.text));
    const months = band.filter((word) => cx(word) >= leftBoundary && cx(word) < rightBoundary).flatMap((word) => {
      const token = normalizeOcrText(word.text);
      const matches = MONTHS.map((month, index) => ({ month, index })).filter(({ month }) => month === token
        || (month.length === token.length && [...month].filter((letter, i) => letter !== token[i]).length === 1));
      const monthNumber = /^(?:0?[1-9]|1[0-2])$/u.test(token) ? Number(token) : matches.length === 1 ? matches[0].index + 1 : null;
      return monthNumber ? [{ word, monthNumber }] : [];
    });
    if (days.length === 1 && months.length === 1 && years.length === 1) {
      guideDate = normalizeGuideDate(`${days[0].text}/${months[0].monthNumber}/${years[0].text}`) ?? "";
      score("guideDate", [days[0], months[0].word, years[0]]);
    }
  }
  // Restrict raw date fallbacks to the header, before recipient or operation
  // fields. Dates mentioned in observations do not date the document.
  const rawHeader = rawText.split(/\b(?:PEDIDO\s+POR|NOMBRE\s+DEL\s+CLIENTE|DIRECCI[OÓ]N\s+(?:DE\s+)?OBRA|HORA\s+(?:DE\s+)?INICIO|EQUIPO|VOLUMEN|OBSERVACIONES)\b/iu)[0];
  if (!guideDate) {
    const rawDate = rawHeader.match(/\bFECHA\s*[:\n]?\s*(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}|\d{1,2}\s+(?:de\s+)?[a-záéíóú]+\s+(?:de\s+)?\d{2,4})\b/iu)?.[1];
    guideDate = rawDate ? normalizeGuideDate(rawDate) ?? "" : "";
  }
  if (!guideDate) {
    // Older OCR responses may emit the split header as "Guatemala, 18",
    // "18/09", "Año", "2026". Require a date-only line and an explicit year;
    // street addresses such as 17-01 are not date candidates.
    const dateLine = rawHeader.match(/(?:^|\n)\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*(?=\n|$)/u)?.[1];
    const yearText = rawText.match(/\bA[NÑ]O\s*[:\n]?\s*(20\d{2}|\d{2})\b/iu)?.[1];
    if (dateLine && (dateLine.split("/").length === 3 || yearText)) guideDate = normalizeGuideDate(dateLine.split("/").length === 3 ? dateLine : `${dateLine}/${yearText}`) ?? "";
  }
  const observationsLabel = label("observations");
  let observations = "";
  if (observationsLabel) {
    const stop = labels.filter((item) => item.name === "signature" && item.y > observationsLabel.y).sort((a, b) => a.y - b.y)[0]?.y ?? Math.min(1, observationsLabel.bottom + .3);
    const content = words.filter((word) => cy(word) >= observationsLabel.y - .004 && cy(word) < stop && !observationsLabel.words.includes(word));
    observations = text(content).slice(0, 4000);
    score("observations", content);
  }
  const realVolume = number("real", "realVolume").replace(",", ".");
  const truckValue = value("truck");
  const truck = /^[\p{L}\d-]{1,30}$/u.test(truckValue) ? truckValue : "";
  const arrivalRaw = value("arrival"), departureRaw = value("departure");
  const rawLabeledValue = (aliases: string[]) => {
    for (const line of rawText.split(/\r?\n/u)) {
      const normalized = line.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toUpperCase();
      for (const alias of aliases) {
        const match = new RegExp(`\\b${alias.split(" ").join("\\s+")}\\b\\s*:?\\s*(.*)$`, "u").exec(normalized);
        if (match?.[1]) return line.slice(line.length - match[1].length).trim();
      }
    }
    return "";
  };
  return { guideNumber, orderNumber, guideDate, observations, realVolume, truck,
    arrivalRaw, departureRaw, arrivalTime: normalizeGuideTime(arrivalRaw) ?? "", departureTime: normalizeGuideTime(departureRaw) ?? "",
    estimatedVolume: number("estimated", "estimatedVolume"), equipmentNumber: number("equipment", "equipmentNumber"), concreteType: value("concrete") || rawLabeledValue(ALIASES.concrete),
    pumpingStartTime: value("pumpingStart") || rawLabeledValue(ALIASES.pumpingStart), pumpingEndTime: value("pumpingEnd") || rawLabeledValue(ALIASES.pumpingEnd), confidence };
}

export function parseServicesControlGuide(response: GoogleVisionResponse): GuideOcrDraft {
  const fields = readServicesControlFields(orientedGuideWords(response), response.responses?.[0]?.fullTextAnnotation?.text ?? "");
  const warnings: string[] = [];
  for (const [value, name] of [[fields.guideNumber, "el número de guía"], [fields.orderNumber, "el número de pedido"], [fields.guideDate, "la fecha"], [fields.realVolume, "el volumen real"]]) {
    if (!value) warnings.push(`No se pudo leer con seguridad ${name}. Complétalo desde la foto.`);
  }
  if (fields.realVolume) warnings.push("Revisa el volumen real manuscrito antes de guardar; se precargó como cantidad de la primera línea.");
  if (fields.arrivalRaw && !fields.arrivalTime) warnings.push("Revisa la hora de llegada del camión; no se pudo normalizar la lectura.");
  if (fields.departureRaw && !fields.departureTime) warnings.push("Revisa la hora de salida del camión; no se pudo normalizar la lectura.");
  return {
    guideNumber: fields.guideNumber, arrivalTime: fields.arrivalTime, departureTime: fields.departureTime,
    // Retain the persisted type identifier for historical captures. It now
    // represents every non-Mixto operation control, with no supplier rules.
    details: { ...emptyGuideDetails(), documentType: "PANEXUS_OPERATION", guideDate: fields.guideDate, orderNumber: fields.orderNumber, truck: fields.truck, observations: fields.observations },
    rawTimes: { loading: "", arrival: fields.arrivalRaw, departure: fields.departureRaw }, confidence: fields.confidence, warnings,
    lines: [{ quantity: fields.realVolume, unit: "M3", productCode: "", description: "", type: "SERVICE", catalogItemId: "", candidates: [], warning: null }],
  };
}
