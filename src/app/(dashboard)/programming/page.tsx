import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { ProgrammingWorkspace } from "@/features/programming/components/programming-workspace";
import { getProgrammingPageData } from "@/features/programming/queries";
import { usesResidentProgrammingView } from "@/features/programming/status-presentation";
import { getProjectContext } from "@/features/projects/queries";
import { getDashboardListScope, type DashboardSearchParams } from "@/features/dashboard/list-scope";

export default async function ProgrammingPage({ searchParams }: { searchParams?: Promise<DashboardSearchParams> }) {
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

  const params = await searchParams ?? {};
  const filter = await getDashboardListScope(params, context, "/programming");
  if (filter.status === "error") return <EmptyState title="Indicador no disponible" description={filter.message} />;
  const dates = filter.status === "ready" ? filter.records.map(record => Date.parse(record.date)).filter(Number.isFinite) : [];
  const data = await getProgrammingPageData(
    context.activeProject.id,
    context.activeProject.timezone,
    dates.length ? { start: new Date(Math.min(...dates)).toISOString(), end: new Date(Math.max(...dates) + 1).toISOString() } : undefined,
  );

  return (
    <ProgrammingWorkspace
      key={JSON.stringify([context.activeProject.id, params])}
      dashboardScope={filter.status === "ready" ? filter.scope : undefined}
      project={context.activeProject}
      residentView={usesResidentProgrammingView(context.roleCodes)}
      canCreate={context.permissions.includes("programming.create")}
      canConfirm={context.permissions.includes("programming.confirm")}
      canModify={context.permissions.includes("programming.modify")}
      canEditStarted={context.isCompanyAdmin}
      canCancel={context.permissions.includes("programming.cancel")}
      canStartDispatch={context.permissions.includes("dispatch.create")}
      initialData={data}
    />
  );
}
