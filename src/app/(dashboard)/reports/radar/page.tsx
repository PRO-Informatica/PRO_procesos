import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { CastingRadar } from "@/features/reports/components/casting-radar";
import { parseRadarFilters, type RadarFilters } from "@/features/reports/radar";
import { getCastingRadar } from "@/features/reports/radar-queries";
import { getRadarProjectScope } from "@/features/reports/report-scope";

export default async function CastingRadarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireActiveProfile();
  const params = await searchParams;
  const universal = params.scope === "universal";
  const projects = await getRadarProjectScope(profile.id, universal);
  if (!projects.length) return <EmptyState title="Sin acceso al radar de fundición" description="Selecciona un proyecto con acceso de consulta a Despachos y Guías." />;
  const filters: RadarFilters = parseRadarFilters(params);
  const data = await getCastingRadar(projects, filters);
  return <CastingRadar key={JSON.stringify(filters) + String(universal)} data={data} filters={filters} universal={universal} />;
}
