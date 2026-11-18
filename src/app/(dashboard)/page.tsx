import { Suspense } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { DashboardSkeleton } from "@/features/dashboard/components/dashboard-skeleton";
import { ProjectDashboard } from "@/features/dashboard/components/project-dashboard";
import { ReinvoicingAgingChart } from "@/features/dashboard/components/reinvoicing-aging-chart";
import { canViewDashboardDetail } from "@/features/dashboard/details";
import { getProjectDashboard } from "@/features/dashboard/queries";
import { getReinvoicingAging } from "@/features/dashboard/reinvoicing-aging-queries";
import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";

async function DashboardReinvoicing({ projectId, timezone }: { projectId: string; timezone: string }) {
  const data = await getReinvoicingAging(projectId).catch((error) => {
    console.error("No fue posible cargar la gráfica de refacturación", error);
    return null;
  });
  return <ReinvoicingAgingChart data={data} timezone={timezone} />;
}

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
      reinvoicing={canViewDashboardDetail("reinvoicing", projectContext.roleCodes, projectContext.permissions) && (
        <Suspense fallback={<p className="rounded-xl border border-border bg-surface p-5 text-sm text-foreground-muted" role="status">Cargando antigüedad de refacturación…</p>}>
          <DashboardReinvoicing projectId={projectContext.activeProject.id} timezone={dashboard.timezone} />
        </Suspense>
      )}
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
