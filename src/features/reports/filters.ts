import type { GuideReportFilters } from "./types";

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: Params, key: string) {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function parseGuideReportFilters(params: Params): GuideReportFilters {
  const now = new Date();
  const defaultTo = isoDate(now);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12));
  const periodValue = read(params, "period");
  const period = ["day", "week", "month", "custom"].includes(periodValue) ? periodValue as GuideReportFilters["period"] : "month";
  let defaultFrom = isoDate(start);
  let defaultEnd = isoDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 12)),
  );
  if (period === "day") defaultFrom = defaultEnd = defaultTo;
  if (period === "week") {
    const weekday = now.getUTCDay();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (weekday === 0 ? 6 : weekday - 1), 12));
    defaultFrom = isoDate(monday);
    defaultEnd = isoDate(new Date(monday.getTime() + 6 * 86400000));
  }
  const from = read(params, "from");
  const to = read(params, "to");
  const incidents = read(params, "incidents");
  return {
    period,
    projectId: read(params, "project") || undefined,
    supplierId: read(params, "supplier") || undefined,
    userId: read(params, "user") || undefined,
    orderNumber: read(params, "order") || undefined,
    batchId: read(params, "batch") || undefined,
    dispatchStatus: read(params, "dispatchStatus") || undefined,
    programmingStatus: read(params, "programmingStatus") || undefined,
    orderStatus: read(params, "orderStatus") || undefined,
    reconciliationStatus: read(params, "reconciliation") || undefined,
    withIncidents: incidents === "yes" || incidents === "no" ? incidents : undefined,
    dateFrom: period === "custom" && validDate(from) ? from : defaultFrom,
    dateTo: period === "custom" && validDate(to) ? to : defaultEnd,
  };
}

export function reportSearchParams(filters: GuideReportFilters) {
  const params = new URLSearchParams({ period: filters.period ?? "custom", from: filters.dateFrom, to: filters.dateTo });
  const values: Array<[string, string | undefined]> = [
    ["project", filters.projectId], ["supplier", filters.supplierId], ["user", filters.userId],
    ["order", filters.orderNumber], ["batch", filters.batchId], ["dispatchStatus", filters.dispatchStatus], ["programmingStatus", filters.programmingStatus],
    ["orderStatus", filters.orderStatus], ["reconciliation", filters.reconciliationStatus], ["incidents", filters.withIncidents],
  ];
  for (const [key, value] of values) if (value) params.set(key, value);
  return params;
}
