import "server-only";
import type { ProjectContextData } from "../projects/types";
import { canViewDashboardDetail, DASHBOARD_DETAILS, dashboardDestination, isDashboardDetailView, selectDashboardRecords } from "./details";
import { getProjectDashboard } from "./queries";

export type DashboardSearchParams = Record<string, string | string[] | undefined>;

// Recompute the indicator on the server, in the active project and with the
// destination's permissions. A query string never grants access to records.
export async function getDashboardListScope(params: DashboardSearchParams, context: ProjectContextData, destination: string) {
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const view = value("dashboard");
  if (!view) return { status: "none" } as const;
  if (!isDashboardDetailView(view) || dashboardDestination(view) !== destination || !context.activeProject || context.activeProject.id !== value("project")) {
    return { status: "error", message: "Abre el indicador desde el inicio con el proyecto correspondiente." } as const;
  }
  if (!canViewDashboardDetail(view, context.roleCodes, context.permissions)) {
    return { status: "error", message: "Tu rol no tiene acceso a este indicador." } as const;
  }
  const data = await getProjectDashboard(context.activeProject.id, context.activeProject.timezone);
  const records = selectDashboardRecords(data, view, { batch: value("batch"), date: value("date") });
  const batchCode = data.batchReconciliation.find(item => item.batchId === value("batch"))?.batchCode;
  return { status: "ready", records, scope: {
    label: DASHBOARD_DETAILS[view],
    batchId: value("batch") || undefined,
    // Received indicators count guides; their destination lists their dispatches.
    recordIds: [...new Set(records.map(record => record.kind === "guide" ? record.href.split("/").at(-1)! : record.id))],
    description: [context.activeProject.name, batchCode, value("date"), `${records.length} ${destination === "/dispatches" ? "guía(s)" : "registro(s)"}`].filter(Boolean).join(" · "),
  } } as const;
}
