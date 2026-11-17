import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { canAccessOperationalSection } from "@/features/projects/access-policy";
import { ReconciliationWorkspace } from "@/features/reconciliation/components/reconciliation-workspace";
import { getGlobalReconciliation } from "@/features/reconciliation/queries";
import { getDashboardListScope, type DashboardSearchParams } from "@/features/dashboard/list-scope";

export default async function ReconciliationPage({ searchParams }: { searchParams?: Promise<DashboardSearchParams> }) {
  const profile=await requireActiveProfile(); const context=await getProjectContext(profile.id);
  if(context.status==="error") throw new Error(context.message);
  if(!context.activeProject) return <EmptyState title="Sin proyecto operacional" description="Selecciona un proyecto para consultar conciliación."/>;
  if(!canAccessOperationalSection(context.roleCodes, "/reconciliation")||!context.permissions.includes("invoice.view")||!context.permissions.includes("batch.view")) return <EmptyState title="Sin acceso a Conciliación" description="Esta sección no está disponible para tu rol."/>;
  const params = await searchParams ?? {};
  const filter = await getDashboardListScope(params, context, "/reconciliation");
  if (filter.status === "error") return <EmptyState title="Indicador no disponible" description={filter.message} />;
  return <ReconciliationWorkspace key={JSON.stringify([context.activeProject.id, params])} project={context.activeProject} data={await getGlobalReconciliation(context.activeProject.id)} dashboardScope={filter.status === "ready" ? filter.scope : undefined} />;
}
