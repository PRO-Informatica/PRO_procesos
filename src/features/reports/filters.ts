import { normalizeCastingElement } from "../dispatches/casting-elements.ts";
import type { GuideReportFilters } from "./types";

export type ReportParams = URLSearchParams | Record<string, string | string[] | undefined>;

export function readReportParam(params: ReportParams, key: string) {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function reportDateRange(params: ReportParams) {
  const now = new Date();
  const from = readReportParam(params, "from");
  const to = readReportParam(params, "to");
  const dateFrom = validDate(from) ? from : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12)).toISOString().slice(0, 10);
  const dateTo = validDate(to) ? to : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
  return dateFrom <= dateTo ? { dateFrom, dateTo } : { dateFrom: dateTo, dateTo: dateFrom };
}

export function parseGuideReportFilters(params: ReportParams): GuideReportFilters {
  const read = (key: string) => readReportParam(params, key);
  const incidents = read("incidents");
  return {
    ...reportDateRange(params),
    projectId: read("project") || undefined,
    supplierId: read("supplier") || undefined,
    userId: read("user") || undefined,
    orderNumber: read("order") || undefined,
    batchId: read("batch") || undefined,
    dispatchStatus: read("dispatchStatus") || undefined,
    programmingStatus: read("programmingStatus") || undefined,
    castingElement: normalizeCastingElement(read("castingElement")) ?? undefined,
    reconciliationStatus: read("reconciliation") || undefined,
    withIncidents: incidents === "yes" || incidents === "no" ? incidents : undefined,
  };
}

export function reportSearchParams(filters: GuideReportFilters) {
  const params = new URLSearchParams({ from: filters.dateFrom, to: filters.dateTo });
  const values: Array<[string, string | undefined]> = [
    ["project", filters.projectId], ["supplier", filters.supplierId], ["user", filters.userId],
    ["order", filters.orderNumber], ["batch", filters.batchId], ["dispatchStatus", filters.dispatchStatus], ["programmingStatus", filters.programmingStatus],
    ["castingElement", filters.castingElement], ["reconciliation", filters.reconciliationStatus], ["incidents", filters.withIncidents],
  ];
  for (const [key, value] of values) if (value) params.set(key, value);
  return params;
}
