import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { GuideReport } from "@/features/reports/components/guide-report";
import { parseGuideReportFilters } from "@/features/reports/filters";
import { getGuideReport, getUniversalReportScopes } from "@/features/reports/queries";

export default async function UniversalReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireActiveProfile();
  const scopes = await getUniversalReportScopes(profile.id);
  if (!scopes.length) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Sin acceso a Reportería Universal"
          description="Esta vista está disponible para Compras y administradores de empresa con acceso real a Despachos."
        />
      </div>
    );
  }

  const filters = parseGuideReportFilters(await searchParams);
  const projects = scopes.map(({ project }) => ({
    id: project.id,
    name: project.name,
    code: project.code,
    billingLegalName: project.billingLegalName,
    companyName: project.companyName,
    timezone: project.timezone,
  }));
  const data = await getGuideReport(projects, filters);
  return <GuideReport data={data} filters={filters} universal projectCount={projects.length} />;
}
