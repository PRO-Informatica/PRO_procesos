import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { ProgrammingWorkspace } from "@/features/programming/components/programming-workspace";
import { getProgrammingPageData } from "@/features/programming/queries";
import { getProjectContext } from "@/features/projects/queries";

export default async function ProgrammingPage() {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);

  if (context.status === "error") throw new Error(context.message);
  if (!context.activeProject) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No tienes un proyecto operacional"
          description="Selecciona o solicita acceso a un proyecto antes de abrir la planificación."
        />
      </div>
    );
  }
  if (!context.permissions.includes("programming.view")) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Sin acceso a programación"
          description="Tu rol actual no incluye el permiso programming.view para este proyecto."
        />
      </div>
    );
  }

  const data = await getProgrammingPageData(
    context.activeProject.id,
    context.activeProject.timezone,
  );

  return (
    <ProgrammingWorkspace
      project={context.activeProject}
      canCreate={context.permissions.includes("programming.create")}
      initialData={data}
    />
  );
}
