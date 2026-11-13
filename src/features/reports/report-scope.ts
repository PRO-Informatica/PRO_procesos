import "server-only";

import { getProjectContext } from "@/features/projects/queries";
import { canAccessOperationalSection } from "@/features/projects/access-policy";
import { getUniversalReportScopes, type ReportProjectInput } from "./queries";

export async function getRadarProjectScope(userId: string, universal: boolean): Promise<ReportProjectInput[]> {
  if (universal) {
    return (await getUniversalReportScopes(userId)).map(({ project }) => project);
  }
  const context = await getProjectContext(userId);
  if (context.status === "error") throw new Error(context.message);
  if (!context.activeProject || !canAccessOperationalSection(context.roleCodes, "/reports") || !context.permissions.includes("dispatch.view")) return [];
  return context.isCompanyAdmin ? context.projects.filter((project) => project.companyId === context.activeProject?.companyId) : [context.activeProject];
}
