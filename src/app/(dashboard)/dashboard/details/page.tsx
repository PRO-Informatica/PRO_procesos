import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { redirect } from "next/navigation";
import { OpenDashboardProject } from "@/features/dashboard/components/dashboard-navigation";
import { canViewDashboardDetail, dashboardDetailHref, dashboardNavigationTarget, isDashboardDetailView } from "@/features/dashboard/details";
import { canAccessOperationalSection } from "@/features/projects/access-policy";
import { getOperationalProjectAccessForProject, getProjectContext } from "@/features/projects/queries";

export default async function DashboardDetailsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status === "error") throw new Error(context.message);
  const noAccess = <EmptyState title="Sin acceso a este detalle" description="Tu rol no tiene acceso a esta sección. Puedes continuar utilizando las demás opciones del sistema." />;
  if (!canAccessOperationalSection(context.roleCodes, "/dashboard/details")) return noAccess;
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  if (value("target")) {
    const projectId = value("project");
    const target = dashboardNavigationTarget(projectId, value("target"));
    if (!target || !context.dashboardProjectIds.includes(projectId)) return noAccess;
    if (context.activeProject?.id === projectId) redirect(target);
    const scope = await getOperationalProjectAccessForProject(profile.id, projectId);
    if (!scope || !canAccessOperationalSection(scope.roleCodes, "/dashboard/details")) return noAccess;
    return <EmptyState
      title={`Abrir detalle en ${scope.project.name}`}
      description="Para consultar el detalle, cambia el proyecto activo."
      action={<OpenDashboardProject projectId={projectId} target={target} />}
    />;
  }
  const view = value("view");
  if (!context.activeProject || context.activeProject.id !== value("project")) return <EmptyState title="Selecciona el proyecto del indicador" description="Vuelve al inicio con el proyecto correspondiente para consultar sus registros." />;
  if (!isDashboardDetailView(view)) return <EmptyState title="Indicador no disponible" description="Abre el detalle desde una tarjeta o gráfica del inicio." />;
  if (!canViewDashboardDetail(view, context.roleCodes, context.permissions)) return noAccess;
  // Keep old bookmarks working; all new links open existing workspaces.
  redirect(dashboardDetailHref(context.activeProject.id, view, { batch: value("batch"), date: value("date") }));
}
