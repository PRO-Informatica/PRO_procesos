import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { redirect } from "next/navigation";
import { canViewDashboardDetail, dashboardDetailHref, isDashboardDetailView } from "@/features/dashboard/details";
import { getProjectContext } from "@/features/projects/queries";

export default async function DashboardDetailsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status === "error") throw new Error(context.message);
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const view = value("view");
  if (!context.activeProject || context.activeProject.id !== value("project")) return <EmptyState title="Selecciona el proyecto del indicador" description="Vuelve al inicio con el proyecto correspondiente para consultar sus registros." />;
  if (!isDashboardDetailView(view)) return <EmptyState title="Indicador no disponible" description="Abre el detalle desde una tarjeta o gráfica del inicio." />;
  if (!canViewDashboardDetail(view, context.roleCodes, context.permissions)) return <EmptyState title="Sin acceso a este detalle" description="Tu rol no tiene acceso a esta sección. Puedes continuar utilizando las demás opciones del sistema." />;
  // Keep old bookmarks working; all new links open existing workspaces.
  redirect(dashboardDetailHref(context.activeProject.id, view, { batch: value("batch"), date: value("date") }));
}
