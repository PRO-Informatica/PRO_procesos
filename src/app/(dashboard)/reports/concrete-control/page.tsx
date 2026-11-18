import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { CastingRadar } from "@/features/reports/components/casting-radar";
import { parseRadarFilters } from "@/features/reports/radar";
import { getCastingRadar } from "@/features/reports/radar-queries";
import { getRadarProjectScope } from "@/features/reports/report-scope";

export default async function ConcreteControlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireActiveProfile();
  const params = await searchParams;
  const universal = true;
  const projects = await getRadarProjectScope(profile.id);
  if (!projects.length) return <EmptyState title="Sin acceso al sistema de control" description="Esta sección está disponible para administradores y Compras con acceso al proyecto." />;
  const filters = parseRadarFilters(params);
  const data = await getCastingRadar(projects, filters);
  return <CastingRadar key={JSON.stringify(filters) + String(universal)} data={data} filters={filters} universal={universal} report="concrete" />;
}
