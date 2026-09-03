import { notFound } from "next/navigation";

import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { ProgrammingDetailView } from "@/features/programming/components/programming-detail-view";
import { getProgrammingDetailPageData } from "@/features/programming/queries";
import { getProjectContext } from "@/features/projects/queries";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ProgrammingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);

  if (context.status === "error") throw new Error(context.message);
  if (!context.activeProject) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="No tienes un proyecto operacional"
          description="Selecciona o solicita acceso a un proyecto antes de abrir una programación."
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

  const data = await getProgrammingDetailPageData(
    context.activeProject.id,
    id,
    context.activeProject.timezone,
  );
  if (!data) notFound();

  return (
    <ProgrammingDetailView
      data={data}
      project={context.activeProject}
      receiverName={profile.fullName}
      permissions={{
        canModify: context.permissions.includes("programming.modify"),
        canConfirm: context.permissions.includes("programming.confirm"),
        canCancel: context.permissions.includes("programming.cancel"),
        canClose: context.permissions.includes("programming.close"),
        canCreateDispatch: context.permissions.includes("dispatch.create"),
        canModifyDispatch: context.permissions.includes("dispatch.modify"),
      }}
    />
  );
}
