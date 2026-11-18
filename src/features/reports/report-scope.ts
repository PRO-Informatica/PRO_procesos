import "server-only";

import { getUniversalReportScopes, type ReportProjectInput } from "./queries";

// Every report and export rechecks the same roles, independent of URL parameters.
export async function getRadarProjectScope(userId: string): Promise<ReportProjectInput[]> {
  return (await getUniversalReportScopes(userId)).map(({ project }) => project);
}
