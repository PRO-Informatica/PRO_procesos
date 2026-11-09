import { CASTING_ELEMENTS, normalizeCastingElement } from "../dispatches/casting-elements.ts";
import { readReportParam, reportDateRange, type ReportParams } from "./filters.ts";
import type { DispatchReportSummary } from "./types";

export type RadarFilters = {
  dateFrom: string;
  dateTo: string;
  projectId?: string;
  guide?: string;
  dispatch?: string;
  castingElement?: string;
  truck?: string;
  concrete?: string;
  laboratory?: "yes" | "no";
};

export type RadarLine = {
  type: "PRODUCT" | "SERVICE";
  code: string;
  description: string;
  reference: string;
  quantity: number;
  unit: string;
};

export type RadarGuide = {
  id: string;
  number: string;
  date: string;
  documentType: string;
  orderNumber: string;
  customerName: string;
  projectName: string;
  workAddress: string;
  truck: string;
  plant: string;
  loadingTime: string;
  arrivalAt: string | null;
  departureAt: string | null;
  laboratory: boolean;
  castingElement: string;
  pilot: string;
  operator: string;
  observations: string;
  temperature: number | null;
  slump: string;
  laboratoryNotes: string;
  concreteQuantity: number;
  concrete: string;
  lines: RadarLine[];
};

export type RadarDispatch = {
  id: string;
  code: string;
  programmingCode: string;
  orderNumber: string;
  projectId: string;
  projectName: string;
  supplierName: string;
  scheduledAt: string;
  timezone: string;
  summary: DispatchReportSummary;
  guides: RadarGuide[];
};

export type RadarData = { dispatches: RadarDispatch[]; projects: { value: string; label: string }[] };

export function parseRadarFilters(params: ReportParams): RadarFilters {
  const read = (key: string) => readReportParam(params, key).trim();
  const laboratory = read("laboratory");
  return {
    ...reportDateRange(params),
    projectId: read("project") || undefined,
    guide: read("guide") || undefined,
    dispatch: read("dispatch") || undefined,
    castingElement: normalizeCastingElement(read("castingElement")) ?? undefined,
    truck: read("truck") || undefined,
    concrete: read("concrete") || undefined,
    laboratory: laboratory === "yes" || laboratory === "no" ? laboratory : undefined,
  };
}

export function radarSearchParams(filters: RadarFilters, universal = false) {
  const params = new URLSearchParams({ from: filters.dateFrom, to: filters.dateTo });
  for (const [key, value] of Object.entries({ project: filters.projectId, dispatch: filters.dispatch, castingElement: filters.castingElement, guide: filters.guide, truck: filters.truck, concrete: filters.concrete, laboratory: filters.laboratory })) {
    if (value) params.set(key, value);
  }
  if (universal) params.set("scope", "universal");
  return params;
}

function searchable(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim();
}

function identifierMatches(value: string, query: string) {
  const compact = (text: string) => searchable(text).replace(/[^a-z0-9]/gu, "");
  const needle = compact(query);
  return needle ? compact(value).includes(needle) : searchable(value).includes(searchable(query));
}

export function radarGuideMatches(guide: RadarGuide, filters: RadarFilters) {
  if (filters.guide && !identifierMatches(guide.number, filters.guide)) return false;
  if (filters.truck && !searchable(guide.truck).includes(searchable(filters.truck))) return false;
  if (filters.concrete && !searchable(`${guide.concrete} ${guide.lines.map((line) => `${line.type === "SERVICE" ? "Servicio" : "Producto"} ${line.code} ${line.reference} ${line.description}`).join(" ")}`).includes(searchable(filters.concrete))) return false;
  if (filters.laboratory && guide.laboratory !== (filters.laboratory === "yes")) return false;
  return true;
}

// Dates and predicates describe the dispatch; guide searches never trim its breakdown.
export function filterRadarDispatches(dispatches: RadarDispatch[], filters: RadarFilters) {
  return dispatches.filter((dispatch) => {
    const date = radarLocalDate(dispatch.scheduledAt, dispatch.timezone);
    if (date < filters.dateFrom || date > filters.dateTo) return false;
    if (filters.projectId && dispatch.projectId !== filters.projectId) return false;
    if (filters.dispatch && !identifierMatches(dispatch.code, filters.dispatch) && !identifierMatches(dispatch.id, filters.dispatch)) return false;
    if (filters.castingElement && !dispatch.summary.castingElements.includes(filters.castingElement)) return false;
    if (filters.guide && !dispatch.guides.some((guide) => identifierMatches(guide.number, filters.guide!))) return false;
    if (filters.truck && !dispatch.guides.some((guide) => searchable(guide.truck).includes(searchable(filters.truck!)))) return false;
    if (filters.concrete && !dispatch.guides.some((guide) => radarGuideMatches(guide, { dateFrom: filters.dateFrom, dateTo: filters.dateTo, concrete: filters.concrete }))) return false;
    const hasLaboratory = dispatch.guides.some((guide) => guide.laboratory);
    if (filters.laboratory === "yes" && !hasLaboratory) return false;
    if (filters.laboratory === "no" && (!dispatch.guides.length || hasLaboratory)) return false;
    return true;
  });
}

export function radarLocalDate(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (key: string) => parts.find(({ type }) => type === key)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// Fetch one extra UTC day on either side, then apply the project's local date.
export function radarQueryDateRange(filters: RadarFilters) {
  const shift = (value: string, days: number) => new Date(Date.parse(`${value}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  return { dateFrom: shift(filters.dateFrom, -1), dateTo: shift(filters.dateTo, 1) };
}

type Row = Record<string, unknown>;
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }

export function makeRadarGuide(row: Row, lineRows: Row[], programmingCasting?: unknown): RadarGuide {
  const details = row.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details as Row : {};
  const lines: RadarLine[] = [...lineRows].sort((a, b) => number(a.position) - number(b.position)).map((line) => ({
    type: line.catalog_type === "SERVICE" ? "SERVICE" : "PRODUCT",
    code: text(line.product_code), description: text(line.product_description), reference: text(line.catalog_reference),
    quantity: number(line.quantity), unit: text(line.unit_code),
  }));
  const products = lines.filter((line) => line.type === "PRODUCT");
  const element = normalizeCastingElement(text(row.casting_element) || text(programmingCasting));
  return {
    id: text(row.id), number: text(row.guide_number), date: text(row.guide_date),
    documentType: text(details.documentType), orderNumber: text(details.orderNumber),
    customerName: text(details.customerName), projectName: text(details.projectName), workAddress: text(details.workAddress),
    truck: text(details.truck), plant: text(details.plant), loadingTime: text(details.loadingTime),
    arrivalAt: text(row.truck_arrival_at) || null, departureAt: text(row.truck_departure_at) || null,
    laboratory: row.laboratory_applied === true, castingElement: element ? CASTING_ELEMENTS[element] : "Sin registrar",
    pilot: text(details.pilot), operator: text(details.operator), observations: text(details.observations),
    temperature: details.temperature !== null && details.temperature !== undefined && String(details.temperature).trim() !== "" && Number.isFinite(Number(details.temperature)) ? Number(details.temperature) : null,
    slump: text(details.slump), laboratoryNotes: text(details.laboratoryNotes),
    concreteQuantity: Math.round(products.filter((line) => /^m[³3]$/iu.test(line.unit)).reduce((total, line) => total + line.quantity, 0) * 10000) / 10000,
    concrete: products.length ? [...new Set(products.map((line) => line.reference || line.description || line.code))].join(" / ") : lines.length ? "Servicio" : "Sin líneas",
    lines,
  };
}

export function radarTime(value: string | null, timezone: string) {
  if (!value) return "—";
  if (/^\d{2}:\d{2}(?::\d{2})?$/u.test(value)) return value.slice(0, 5);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-GT", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function radarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function radarTimeWithDate(value: string | null, guideDate: string, timezone: string) {
  const time = radarTime(value, timezone);
  if (!value || time === "—") return time;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return time;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (key: string) => parts.find(({ type }) => type === key)?.value ?? "";
  const localDate = `${part("year")}-${part("month")}-${part("day")}`;
  return localDate === guideDate ? time : `${time} · ${radarDate(localDate)}`;
}

export const MAX_RADAR_DISPATCHES = 100;
export function selectRadarDispatches(dispatches: RadarDispatch[], requested: unknown) {
  if (!Array.isArray(requested) || !requested.length || requested.length > MAX_RADAR_DISPATCHES || requested.some((id) => typeof id !== "string")) {
    throw new Error(`Selecciona entre 1 y ${MAX_RADAR_DISPATCHES} despachos.`);
  }
  const ids = [...new Set(requested as string[])];
  const byId = new Map(dispatches.map((dispatch) => [dispatch.id, dispatch]));
  if (ids.some((id) => !byId.has(id))) throw new Error("Uno de los despachos ya no está disponible con estos filtros o no tienes acceso a él. Actualiza el radar.");
  return ids.map((id) => byId.get(id)!);
}
