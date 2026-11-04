import { compareProjectAddresses } from "../../lib/address-identity.ts";
import { normalizeBusinessIdentity } from "../../lib/business-identity.ts";
import { normalizeServiceUnit } from "../platform/project-price-catalogs/service-units.ts";
import type { DispatchCatalogOption } from "../dispatches/types";

export const GUIDE_FIELDS = {
  customerName: "Nombre del cliente", projectName: "Proyecto", workAddress: "Dirección de obra",
  guideDate: "Fecha", orderNumber: "Número de pedido", plant: "Planta", truck: "Camión",
  loadingTime: "Hora de carga", pilot: "Piloto", operator: "Operador", observations: "Observaciones",
} as const;
export type GuideField = keyof typeof GUIDE_FIELDS;
export type GuideDetails = Record<GuideField, string>;
export type OcrDraftLine = {
  quantity: string; unit: string; productCode: string; description: string;
  type: "PRODUCT" | "SERVICE" | ""; catalogItemId: string;
  candidates: DispatchCatalogOption[]; warning: string | null;
};
export type GuideOcrDraft = {
  guideNumber: string; arrivalTime: string; departureTime: string;
  details: GuideDetails; lines: OcrDraftLine[];
  rawTimes: { loading: string; arrival: string; departure: string };
  confidence: Record<string, number | null>;
  warnings: string[];
};
export function emptyGuideDetails(): GuideDetails {
  return Object.fromEntries(Object.keys(GUIDE_FIELDS).map((key) => [key, ""])) as GuideDetails;
}

// No guessing AM/PM for a bare hour, and no coercing an invalid date to today.
export function normalizeGuideTime(raw: string): string | null {
  const value = raw.normalize("NFKC").trim().toLowerCase().replace(/[.\s]/gu, "");
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/u);
  if (!match || (!match[2] && !match[3])) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (minute > 59 || hour > 23) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[3] === "pm" ? 12 : 0);
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeGuideDate(raw: string): string | null {
  const value = raw.trim();
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
  return normalizeServiceUnit(normalized) ?? (normalized === "EA" ? "UN" : "");
}

export function guideIdentity(project: { name: string; code: string; address: string; additionalAddresses?: string[] }, details: GuideDetails) {
  const name = normalizeBusinessIdentity(details.projectName);
  const projectMatches = Boolean(name && [project.name, project.code].some((value) => normalizeBusinessIdentity(value) === name));
  const address = compareProjectAddresses(project, details.workAddress);
  return {
    matches: projectMatches && address.comparison.result === "MATCH",
    projectMatches, addressMatches: address.comparison.result === "MATCH",
    matchedAddress: address.address,
    message: !projectMatches ? "El proyecto leído debe coincidir con el nombre o código del proyecto activo. Corrige la lectura si es necesario."
      : address.comparison.result !== "MATCH" ? "La dirección leída no coincide con las direcciones del proyecto. Revisa la foto y corrige la lectura o la configuración del proyecto."
      : "Proyecto y dirección coinciden. El pedido es informativo y no se usa para validar esta guía.",
  };
}

export function matchGuideCatalog(line: OcrDraftLine, catalog: DispatchCatalogOption[], productUnit: string): OcrDraftLine {
  // Exact code only: never infer a price from a vaguely similar description.
  const code = line.productCode.normalize("NFKC").replace(/\s+/gu, "").toUpperCase();
  const candidates = catalog.filter((item) => item.code.replace(/\s+/gu, "").toUpperCase() === code);
  if (candidates.length !== 1) return {
    ...line, productCode: code, catalogItemId: "", candidates,
    type: candidates.length && candidates.every((item) => item.type === candidates[0].type) ? candidates[0].type
      : code.startsWith("SERV") ? "SERVICE" : line.type,
    warning: candidates.length ? "El código tiene varias opciones. Selecciona la variante según sus observaciones; no se ha elegido precio."
      : "Código fuera del catálogo del proyecto. Puedes guardar la guía con precio pendiente.",
  };
  const item = candidates[0];
  return { ...line, productCode: code, type: item.type, catalogItemId: item.id, candidates,
    unit: item.type === "PRODUCT" ? productUnit : item.unitCode ?? line.unit,
    description: item.type === "PRODUCT" ? item.reference ?? line.description : item.description ?? line.description,
    warning: null };
}

export function validateOcrReview(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Revisa los datos extraídos.";
  const draft = value as GuideOcrDraft;
  if (typeof draft.guideNumber !== "string" || !draft.guideNumber.trim() || draft.guideNumber.length > 120) return "Registra un número de guía válido.";
  if (!draft.details || Object.keys(GUIDE_FIELDS).some((key) => typeof draft.details[key as GuideField] !== "string" || draft.details[key as GuideField].length > (key === "observations" ? 4000 : 500))) return "Revisa los campos de la guía y su longitud.";
  if (!normalizeGuideDate(draft.details.guideDate)) return "Confirma una fecha válida en la guía.";
  if (![draft.arrivalTime, draft.departureTime].every((time) => typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time))) return "Confirma las horas de llegada y salida del camión.";
  if (draft.details.loadingTime && !normalizeGuideTime(draft.details.loadingTime)) return "Corrige la hora de carga o déjala vacía si no es legible.";
  if (!Array.isArray(draft.lines) || !draft.lines.length || draft.lines.length > 100) return "Agrega al menos una línea y hasta 100.";
  for (const line of draft.lines) {
    if (!line || typeof line !== "object") return "Revisa las líneas de la guía.";
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999999999 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.00001) return "Cada cantidad debe ser mayor que cero, con hasta tres decimales.";
    if (!["PRODUCT", "SERVICE"].includes(line.type) || typeof line.productCode !== "string" || !line.productCode.trim() || line.productCode.length > 120 || typeof line.description !== "string" || line.description.length > 500) return "Confirma el tipo, código y descripción de cada línea.";
    if (!normalizeGuideUnit(line.unit) || (line.type === "PRODUCT" && !["M3", "KM", "UN"].includes(line.unit))) return "Confirma la UM de cada línea.";
  }
  return null;
}
