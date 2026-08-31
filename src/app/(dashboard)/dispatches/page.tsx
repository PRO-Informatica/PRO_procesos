import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { DispatchesWorkspace } from "@/features/dispatches/components/dispatches-workspace";
import { getDispatchPageData } from "@/features/dispatches/queries";
import { getProjectContext } from "@/features/projects/queries";

export default async function DispatchesPage() {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);

  if (context.status === "error") throw new Error(context.message);
  if (!context.activeProject) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState title="No tienes un proyecto operacional" description="Selecciona o solicita acceso a un proyecto antes de consultar sus despachos." />
      </div>
    );
  }
  if (!context.permissions.includes("dispatch.view")) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState title="Sin acceso a despachos" description="Tu acceso actual no incluye el permiso dispatch.view para este proyecto." />
      </div>
    );
  }

  const data = await getDispatchPageData(context.activeProject.id);
  return <DispatchesWorkspace project={context.activeProject} canCreate={context.permissions.includes("dispatch.create")} data={data} />;
}
