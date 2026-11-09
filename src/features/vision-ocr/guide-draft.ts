import { normalizeServiceUnit } from "../platform/project-price-catalogs/service-units.ts";
import { CASTING_ELEMENTS } from "../dispatches/casting-elements.ts";
import { validateGuideDetails } from "../dispatches/guide-details.ts";
import type { DispatchCatalogOption } from "../dispatches/types";
import { GUIDE_FIELDS, type GuideField, type GuideDetails } from "../dispatches/guide-details.ts";
export { GUIDE_FIELDS, emptyGuideDetails, type GuideField, type GuideDetails } from "../dispatches/guide-details.ts";
export type OcrDraftLine = {
  quantity: string; unit: string; productCode: string; description: string;
  type: "PRODUCT" | "SERVICE" | ""; catalogItemId: string;
  candidates: DispatchCatalogOption[]; warning: string | null;
};
export type GuideOcrDraft = {
  resident?: { castingElement: string; laboratoryApplied: boolean };
  guideNumber: string; arrivalTime: string; departureTime: string;
  details: GuideDetails; lines: OcrDraftLine[];
  rawTimes: { loading: string; arrival: string; departure: string };
  confidence: Record<string, number | null>;
  warnings: string[];
};

// Recompute from the edited lines so a catalog selection or removal clears its alert.
export function guideCatalogReviewWarnings(lines: { productCode: string; catalogItemId: string; catalogType: string; ocrWarning?: string | null }[]) {
  return lines.flatMap((line, index) => {
    if (line.catalogItemId || !line.productCode.trim()) return [];
    const kind = line.catalogType === "PRODUCT" ? "Producto" : line.catalogType === "SERVICE" ? "Servicio" : "Producto o servicio";
    return [`Línea ${index + 1} · ${kind} ${line.productCode.trim()}: ${line.ocrWarning || "Sin precio seleccionado en la cotización del proyecto. Revisa el código y sus variantes."}`];
  });
}
// No guessing AM/PM for a bare hour, and no coercing an invalid date to today.
export function normalizeGuideTime(raw: string): string | null {
  const value = raw.normalize("NFKC").trim().toLowerCase().replace(/(\d)\s*\.\s*(\d{2})(?=\D|$)/u, "$1:$2").replace(/[.\s]/gu, "");
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/u);
  if (!match || (!match[2] && !match[3])) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (minute > 59 || hour > 23) return null;
  if (match[3]) {
    if (hour < 1 || (hour > 12 && match[3] !== "pm")) return null;
    if (hour <= 12) hour = hour % 12 + (match[3] === "pm" ? 12 : 0);
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeGuideDate(raw: string): string | null {
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const named = raw.normalize("NFKC").trim().toLowerCase().match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{2}|\d{4})$/u);
  const namedMonth = named ? months.indexOf(named[2]) + 1 : 0;
  const value = named && namedMonth ? `${named[1]}/${namedMonth}/${named[3]}` : raw.trim().replace(/\s*([/.-])\s*/gu, "$1");
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  const local = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/u);
  if (!iso && !local) return null;
  const year = iso ? +iso[1] : +local![3] + (local![3].length === 2 ? 2000 : 0);
  const month = iso ? +iso[2] : +local![2];
  const day = iso ? +iso[3] : +local![1];
  if (year < 2000 || year > 2100) return null;
  const result = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${result}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === result ? result : null;
}

export function normalizeGuideUnit(raw: string) {
  const normalized = raw.normalize("NFKC").toUpperCase().replace(/\s+/gu, "");
  return normalizeServiceUnit(normalized) ?? (["EA", "UM"].includes(normalized) ? "UN" : "");
}

export function matchGuideCatalog(line: OcrDraftLine, catalog: DispatchCatalogOption[], productUnit: string): OcrDraftLine {
  // Exact code only: never infer a price from a vaguely similar description.
  const code = line.productCode.normalize("NFKC").replace(/\s+/gu, "").toUpperCase();
  if (!code) return { ...line, candidates: [], catalogItemId: "", warning: null };
  const candidates = catalog.filter((item) => item.code.replace(/\s+/gu, "").toUpperCase() === code);
  if (candidates.length !== 1) return {
    ...line, productCode: code, catalogItemId: "", candidates,
    type: candidates.length && candidates.every((item) => item.type === candidates[0].type) ? candidates[0].type
      : code.startsWith("SERV") ? "SERVICE" : line.type,
    warning: candidates.length ? "El código tiene varias opciones. Selecciona la variante según sus observaciones; no se ha elegido precio."
      : "Código fuera de la cotización del proyecto. Puedes guardar la guía con precio pendiente.",
  };
  const item = candidates[0];
  return { ...line, productCode: code, type: item.type, catalogItemId: item.id, candidates,
    unit: !line.unit ? "" : item.type === "PRODUCT" ? productUnit : item.unitCode ?? line.unit,
    description: item.type === "PRODUCT" ? item.reference ?? line.description : item.description ?? line.description,
    warning: null };
}

export function validateOcrReview(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Revisa los datos extraídos.";
  const draft = value as GuideOcrDraft;
  const detailsError = validateGuideDetails(draft.details);
  if (detailsError) return detailsError;
  if (typeof draft.guideNumber !== "string" || !draft.guideNumber.trim() || draft.guideNumber.length > 120) return "Registra un número de guía válido.";
  if (!draft.details || Object.keys(GUIDE_FIELDS).some((key) => typeof draft.details[key as GuideField] !== "string" || draft.details[key as GuideField].length > (key === "observations" ? 4000 : 500))) return "Revisa los campos de la guía y su longitud.";
  if (!normalizeGuideDate(draft.details.guideDate)) return "Confirma una fecha válida en la guía.";
  if (![draft.arrivalTime, draft.departureTime].every((time) => typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time))) return "Confirma las horas de llegada y salida del camión.";
  if (draft.details.loadingTime && !normalizeGuideTime(draft.details.loadingTime)) return "Corrige la hora de carga o déjala vacía si no es legible.";
  if (!draft.resident || !Object.hasOwn(CASTING_ELEMENTS, draft.resident.castingElement) || typeof draft.resident.laboratoryApplied !== "boolean") return "Selecciona el elemento a fundir y revisa si se aplicó laboratorio.";
  if (!Array.isArray(draft.lines) || !draft.lines.length || draft.lines.length > 100) return "Agrega al menos una línea y hasta 100.";
  for (const line of draft.lines) {
    if (!line || typeof line !== "object") return "Revisa las líneas de la guía.";
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999999999 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.00001) return "Cada cantidad debe ser mayor que cero, con hasta tres decimales.";
    if (!["PRODUCT", "SERVICE"].includes(line.type) || typeof line.productCode !== "string" || !line.productCode.trim() || line.productCode.length > 120 || typeof line.description !== "string" || line.description.length > 500) return "Confirma el tipo, código y descripción de cada línea.";
    if (typeof line.unit !== "string" || (line.unit !== "" && (!normalizeGuideUnit(line.unit) || (line.type === "PRODUCT" && !["M3", "KM", "UN"].includes(line.unit))))) return "Revisa la UM indicada o déjala vacía.";
  }
  return null;
}
