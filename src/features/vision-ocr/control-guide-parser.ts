import type { GoogleVisionResponse } from "./vision-ocr.ts";
import { findGuideLabels, orientedGuideWords, parseCompleteGuide } from "./complete-guide-parser.ts";
import { normalizeOcrText } from "./guide-parser.ts";
import { emptyGuideDetails, normalizeGuideDate, type GuideOcrDraft } from "./guide-draft.ts";
import type { VisionTemplateType } from "./template-classifier.ts";

type Word = ReturnType<typeof orientedGuideWords>[number];
const cx = (w: Word) => w.x + w.w / 2;
const cy = (w: Word) => w.y + w.h / 2;
function text(words: Word[]) {
  // Preserve observation line order without borrowing the signature/footer.
  return [...words].sort((a, b) => Math.abs(cy(a) - cy(b)) < Math.min(a.h, b.h) * .6 ? a.x - b.x : cy(a) - cy(b)).map((w) => w.text).join(" ").replace(/\s+([,.;:])/gu, "$1").trim();
}
const months = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
function monthNumber(raw: string) {
  const value = normalizeOcrText(raw);
  if (/^(?:0?[1-9]|1[0-2])$/u.test(value)) return Number(value);
  const exact = months.indexOf(value);
  if (exact >= 0) return exact + 1;
  // A single OCR letter substitution is accepted only for an unambiguous month.
  const matches = months.map((month, index) => ({ month, index })).filter(({ month }) => month.length === value.length && [...month].filter((letter, i) => letter !== value[i]).length === 1);
  return matches.length === 1 ? matches[0].index + 1 : null;
}

export function parseControlGuide(response: GoogleVisionResponse, documentType: "MIXTO_OPERATION" | "PANEXUS_OPERATION"): GuideOcrDraft {
  const words = orientedGuideWords(response);
  const labels = findGuideLabels(words, {
    heading: ["CONTROL OPERACION"], day: ["DIA"], month: ["MES"], year: ["ANO"],
    order: documentType === "MIXTO_OPERATION" ? ["PEDIDO NO"] : ["CODIGO"],
    real: ["VOLUMEN REAL"], observations: ["OBSERVACIONES"], signature: ["RECIBI CONFORME", "RECIBI"],
  });
  const label = (name: string) => labels.find((l) => l.name === name);
  const details = { ...emptyGuideDetails(), documentType };
  const confidence: GuideOcrDraft["confidence"] = {};
  const warnings: string[] = [];
  const numeric = (region: Word[], pattern: RegExp, name: string) => {
    const values = region.filter((w) => pattern.test(w.text));
    if (values.length !== 1) { confidence[name] = null; return ""; }
    confidence[name] = values[0].confidence;
    return values[0].text;
  };
  const heading = label("heading");
  // Top serial number, never EQUIPO No., PEDIDO No. or CODIGO.
  const guideNumber = heading ? numeric(words.filter((w) => cx(w) > heading.right && Math.abs(cy(w) - (heading.y + heading.bottom) / 2) < .075), /^\d{4,12}$/u, "guideNumber") : "";
  const order = label("order");
  if (order) details.orderNumber = numeric(words.filter((w) => cx(w) > order.right && cx(w) < order.right + .25 && Math.abs(cy(w) - (order.y + order.bottom) / 2) < .035), /^\d{1,12}$/u, "orderNumber");
  const dayLabel = label("day"), monthLabel = label("month"), yearLabel = label("year");
  if (dayLabel && yearLabel) {
    const top = Math.min(dayLabel.y, yearLabel.y, monthLabel?.y ?? 1) - .015;
    const bottom = Math.max(dayLabel.bottom, yearLabel.bottom, monthLabel?.bottom ?? 0) + .025;
    const band = words.filter((w) => cy(w) >= top && cy(w) <= bottom);
    const monthLeft = dayLabel.right + .025;
    const yearLeft = yearLabel.x - .045;
    const day = numeric(band.filter((w) => cx(w) >= dayLabel.x - .10 && cx(w) < monthLeft), /^(?:0?[1-9]|[12]\d|3[01])$/u, "guideDate");
    const monthValues = band.filter((w) => cx(w) >= monthLeft && cx(w) < yearLeft).map((w) => monthNumber(w.text)).filter((value) => value !== null);
    const year = numeric(band.filter((w) => cx(w) >= yearLeft), /^(?:\d{2}|20\d{2})$/u, "guideDate");
    if (day && monthValues.length === 1 && year) details.guideDate = normalizeGuideDate(`${day}/${monthValues[0]}/${year}`) ?? "";
  }
  const real = label("real");
  let quantity = "";
  if (real) quantity = numeric(words.filter((w) => cx(w) >= real.right && cx(w) < real.right + .18 && Math.abs(cy(w) - (real.y + real.bottom) / 2) < .04), /^\d+(?:[.,]\d+)?$/u, "realVolume").replace(",", ".");
  const observations = label("observations");
  if (observations) {
    const bottom = labels.filter((l) => l.name === "signature" && l.y > observations.y).sort((a, b) => a.y - b.y)[0]?.y ?? Math.min(1, observations.bottom + .22);
    const content = words.filter((w) => cy(w) >= observations.y - .005 && cy(w) < bottom && !observations.words.includes(w));
    details.observations = text(content).slice(0, 4000);
    confidence.observations = content.length ? Math.min(...content.map((w) => w.confidence ?? 0)) : null;
  }
  for (const [value, name] of [[guideNumber, "el número de guía"], [details.orderNumber, "el número de pedido"], [details.guideDate, "la fecha"], [quantity, "el volumen real"]]) if (!value) warnings.push(`No se pudo leer con seguridad ${name}. Complétalo desde la foto.`);
  if (quantity) warnings.push("Revisa el volumen real manuscrito antes de guardar; se precargó como cantidad de la primera línea.");
  return { guideNumber, details, arrivalTime: "", departureTime: "", rawTimes: { loading: "", arrival: "", departure: "" }, confidence, warnings,
    // These forms have no commercial codes. Quantity is the real volume;
    // the resident selects the service/product and its quotation variant.
    lines: [{ quantity, unit: "M3", productCode: "", description: "", type: "SERVICE", catalogItemId: "", candidates: [], warning: null }] };
}

export function parseGuideVariants(response: GoogleVisionResponse): Record<VisionTemplateType, GuideOcrDraft> {
  return { DISPATCH_GUIDE: parseCompleteGuide(response), MIXTO_OPERATION: parseControlGuide(response, "MIXTO_OPERATION"), PANEXUS_OPERATION: parseControlGuide(response, "PANEXUS_OPERATION") };
}
