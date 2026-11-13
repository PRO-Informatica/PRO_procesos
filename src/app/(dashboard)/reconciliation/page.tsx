import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { canAccessOperationalSection } from "@/features/projects/access-policy";
import { ReconciliationWorkspace } from "@/features/reconciliation/components/reconciliation-workspace";
import { getGlobalReconciliation } from "@/features/reconciliation/queries";

export default async function ReconciliationPage() {
  const profile=await requireActiveProfile(); const context=await getProjectContext(profile.id);
  if(context.status==="error") throw new Error(context.message);
  if(!context.activeProject) return <EmptyState title="Sin proyecto operacional" description="Selecciona un proyecto para consultar conciliación."/>;
  if(!canAccessOperationalSection(context.roleCodes, "/reconciliation")||!context.permissions.includes("invoice.view")||!context.permissions.includes("batch.view")) return <EmptyState title="Sin acceso a Conciliación" description="Esta sección no está disponible para tu rol."/>;
  return <ReconciliationWorkspace project={context.activeProject} data={await getGlobalReconciliation(context.activeProject.id)}/>;
}
