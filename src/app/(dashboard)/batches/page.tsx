import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { BatchesWorkspace } from "@/features/batches/components/batches-workspace";
import { getBatchPageData } from "@/features/batches/queries";
import { getProjectContext } from "@/features/projects/queries";

export default async function BatchesPage() {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status === "error") throw new Error(context.message);
  if (!context.activeProject) {
    return <div className="mx-auto max-w-3xl"><EmptyState title="No tienes un proyecto operacional" description="Selecciona un proyecto antes de consultar sus lotes semanales." /></div>;
  }
  if (!context.permissions.includes("batch.view")) {
    return <div className="mx-auto max-w-3xl"><EmptyState title="Sin acceso a lotes" description="Tu rol actual no incluye batch.view para este proyecto." /></div>;
  }
  const data = await getBatchPageData(context.activeProject.id, context.activeProject.timezone);
  return <BatchesWorkspace project={context.activeProject} canCreate={context.permissions.includes("batch.create")} data={data} />;
}
