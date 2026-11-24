import { Suspense } from "react";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/feedback/empty-state";
import { DashboardSkeleton } from "@/features/dashboard/components/dashboard-skeleton";
import { ProjectDashboard } from "@/features/dashboard/components/project-dashboard";
import { ReinvoicingAgingChart } from "@/features/dashboard/components/reinvoicing-aging-chart";
import { canViewDashboardDetail } from "@/features/dashboard/details";
import { getProjectDashboard } from "@/features/dashboard/queries";
import { getReinvoicingAging } from "@/features/dashboard/reinvoicing-aging-queries";
import { requireActiveProfile } from "@/features/auth/queries";
import { canAccessOperationalSection } from "@/features/projects/access-policy";
import { getProjectContext } from "@/features/projects/queries";
import type { ProjectAccessScope } from "@/features/projects/types";

async function DashboardReinvoicing({ projectId, timezone }: { projectId: string; timezone: string }) {
  const data = await getReinvoicingAging(projectId).catch((error) => {
    console.error("No fue posible cargar la gráfica de refacturación", error);
    return null;
  });
  return <ReinvoicingAgingChart data={data} timezone={timezone} />;
}

async function DashboardContent({ project, roleCodes, permissions }: ProjectAccessScope) {
  const dashboard = await getProjectDashboard(project.id, project.timezone);

  return (
    <ProjectDashboard
      project={project}
      roleCodes={roleCodes}
      data={dashboard}
      reinvoicing={canViewDashboardDetail("reinvoicing", roleCodes, permissions) && (
        <Suspense fallback={<p className="rounded-xl border border-border bg-surface p-5 text-sm text-foreground-muted" role="status">Cargando antigüedad de refacturación…</p>}>
          <DashboardReinvoicing projectId={project.id} timezone={dashboard.timezone} />
        </Suspense>
      )}
    />
  );
}

export default async function HomePage() {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);

  if (context.status === "error") throw new Error(context.message);
  const { activeProject, roleCodes, permissions } = context;
  if (!activeProject) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No tienes proyectos asignados"
          description="Tu cuenta está activa, pero todavía no tiene acceso operacional a un proyecto."
        />
      </div>
    );
  }

  if (!canAccessOperationalSection(roleCodes, "/")) {
    if (permissions.includes("programming.view")) redirect("/programming");
    return <EmptyState title="Sin acceso a Inicio" description="El dashboard está disponible para administradores del proyecto." />;
  }

  return (
    <Suspense key={activeProject.id} fallback={<DashboardSkeleton />}>
      <DashboardContent project={activeProject} roleCodes={roleCodes} permissions={permissions} />
    </Suspense>
  );
}
