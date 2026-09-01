import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { GuideReport } from "@/features/reports/components/guide-report";
import { parseGuideReportFilters } from "@/features/reports/filters";
import { getGuideReport } from "@/features/reports/queries";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status === "error") throw new Error(context.message);
  if (!context.activeProject) return <EmptyState title="Sin proyecto operacional" description="Selecciona un proyecto para consultar Reportería." />;
  if (!context.permissions.includes("dispatch.view")) return <EmptyState title="Sin acceso a Reportería" description="Tu rol necesita acceso de consulta a Despachos y Guías." />;
  const filters = parseGuideReportFilters(await searchParams);
  const projects = context.isCompanyAdmin ? context.projects.filter((project) => project.companyId === context.activeProject?.companyId) : [context.activeProject];
  const data = await getGuideReport(projects.map(({ id, name, timezone }) => ({ id, name, timezone })), filters);
  return <GuideReport data={data} filters={filters} />;
}
