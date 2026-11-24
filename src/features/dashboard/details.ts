import type { DashboardRecord, ProjectDashboardData } from "./types.ts";
import { canAccessOperationalSection } from "../projects/access-policy.ts";

export const DASHBOARD_DETAILS = {
  today: "Programaciones de hoy",
  week: "Programaciones de la semana",
  weekCompleted: "Programaciones completadas de la semana",
  weekPending: "Programaciones pendientes de la semana",
  month: "Volumen programado del mes",
  receivedMonth: "Concreto recibido del mes",
  overdue: "Programaciones vencidas",
  orders: "Despachos por estado de conciliación",
  pendingOrders: "Despachos pendientes",
  pendingInvoices: "Despachos pendientes de factura",
  pendingReconciliation: "Despachos por conciliar",
  reinvoicing: "Despachos en refacturación",
  reconciled: "Despachos conciliados",
  programmedDay: "Volumen programado del día",
  receivedDay: "Concreto recibido del día",
} as const;
export type DashboardDetailView = keyof typeof DASHBOARD_DETAILS;
const financialViews = new Set<DashboardDetailView>(["orders", "pendingOrders", "pendingInvoices", "pendingReconciliation", "reinvoicing", "reconciled"]);

export function isDashboardDetailView(value: string): value is DashboardDetailView {
  return Object.hasOwn(DASHBOARD_DETAILS, value);
}

export function isFinancialDashboardDetail(view: DashboardDetailView) {
  return financialViews.has(view);
}

export function canViewDashboardDetail(view: DashboardDetailView, roleCodes: string[], permissions: string[]) {
  if (!canAccessOperationalSection(roleCodes, "/dashboard/details")) return false;
  if (isFinancialDashboardDetail(view)) return canAccessOperationalSection(roleCodes, "/reconciliation") &&
    ["dispatch.view", "invoice.view", "batch.view"].every((permission) => permissions.includes(permission));
  return permissions.includes(view === "receivedMonth" || view === "receivedDay" ? "dispatch.view" : "programming.view");
}

export function dashboardDetailHref(project: string, view: DashboardDetailView, options: { batch?: string; date?: string } = {}) {
  const params = new URLSearchParams({ project, dashboard: view });
  if (options.batch) params.set("batch", options.batch);
  if (options.date) params.set("date", options.date);
  return `${dashboardDestination(view)}?${params}`;
}

export function dashboardDestination(view: DashboardDetailView) {
  if (isFinancialDashboardDetail(view)) return "/reconciliation";
  return view === "receivedMonth" || view === "receivedDay" ? "/dispatches" : "/programming";
}

// Normalize the destinations dashboard links can open after switching projects.
export function dashboardNavigationTarget(projectId: string, target: string) {
  if (["/invoices", "/reconciliation", "/reports"].includes(target) ||
      /^\/(programming|dispatches|batches)\/[0-9a-f-]{36}$/i.test(target)) return target;
  if (!/^\/(programming|dispatches|reconciliation)\?/.test(target)) return null;

  const url = new URL(target, "http://localhost");
  const view = url.searchParams.get("dashboard") ?? "";
  if (!isDashboardDetailView(view) || dashboardDestination(view) !== url.pathname ||
      url.searchParams.get("project") !== projectId) return null;
  return dashboardDetailHref(projectId, view, {
    batch: url.searchParams.get("batch") ?? undefined,
    date: url.searchParams.get("date") ?? undefined,
  });
}

export type DashboardListScope = {
  label: string;
  recordIds: readonly string[];
  description: string;
  batchId?: string;
};

export function selectDashboardRecords(data: Pick<ProjectDashboardData, "records" | "weekDays" | "batchReconciliation">,
  view: DashboardDetailView, { batch, date }: { batch?: string; date?: string } = {}): DashboardRecord[] {
  if (batch && (!isFinancialDashboardDetail(view) || !data.batchReconciliation.some((item) => item.batchId === batch))) return [];
  const daily = view === "programmedDay" || view === "receivedDay";
  // Only dates represented by this dashboard's weekly chart are valid.
  if (daily && !data.weekDays.some((day) => day.date === date)) return [];
  const group = daily ? `day:${date}:${view === "programmedDay" ? "programmed" : "received"}` : view;
  return data.records.filter((record) => record.groups.includes(group) && (!batch || record.batchIds.includes(batch)));
}
