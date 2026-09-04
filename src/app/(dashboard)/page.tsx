import { Suspense } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { DashboardSkeleton } from "@/features/dashboard/components/dashboard-skeleton";
import { ProjectDashboard } from "@/features/dashboard/components/project-dashboard";
import { getProjectDashboard } from "@/features/dashboard/queries";
import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";

async function DashboardContent() {
  const profile = await requireActiveProfile();
  const projectContext = await getProjectContext(profile.id);

  if (projectContext.status === "error") {
    throw new Error(projectContext.message);
  }

  if (!projectContext.activeProject) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No tienes proyectos asignados"
          description="Tu cuenta está activa, pero todavía no tiene acceso operacional a un proyecto."
        />
      </div>
    );
  }

  const dashboard = await getProjectDashboard(
    projectContext.activeProject.id,
    projectContext.activeProject.timezone,
  );

  return (
    <ProjectDashboard
      project={projectContext.activeProject}
      roleCodes={projectContext.roleCodes}
      data={dashboard}
    />
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}
