import { notFound } from "next/navigation";

import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { DispatchDetailView } from "@/features/dispatches/components/dispatch-detail-view";
import { getDispatchDetail } from "@/features/dispatches/queries";
import { getProjectContext } from "@/features/projects/queries";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status === "error") throw new Error(context.message);
  if (!context.activeProject) {
    return <div className="mx-auto max-w-3xl"><EmptyState title="No tienes un proyecto operacional" description="Selecciona un proyecto antes de consultar el despacho." /></div>;
  }
  if (!context.permissions.includes("dispatch.view")) {
    return <div className="mx-auto max-w-3xl"><EmptyState title="Sin acceso a despachos" description="Tu acceso actual no incluye dispatch.view para este proyecto." /></div>;
  }

  const detail = await getDispatchDetail(context.activeProject.id, id);
  if (!detail) notFound();
  return <DispatchDetailView detail={detail} project={context.activeProject} />;
}
