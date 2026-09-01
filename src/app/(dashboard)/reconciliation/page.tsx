import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { ReconciliationWorkspace } from "@/features/reconciliation/components/reconciliation-workspace";
import { getGlobalReconciliation } from "@/features/reconciliation/queries";

export default async function ReconciliationPage() {
  const profile=await requireActiveProfile(); const context=await getProjectContext(profile.id);
  if(context.status==="error") throw new Error(context.message);
  if(!context.activeProject) return <EmptyState title="Sin proyecto operacional" description="Selecciona un proyecto para consultar conciliación."/>;
  if(!context.permissions.includes("invoice.view")||!context.permissions.includes("batch.view")) return <EmptyState title="Sin acceso a Conciliación" description="Tu rol requiere invoice.view y batch.view."/>;
  return <ReconciliationWorkspace project={context.activeProject} data={await getGlobalReconciliation(context.activeProject.id)}/>;
}
