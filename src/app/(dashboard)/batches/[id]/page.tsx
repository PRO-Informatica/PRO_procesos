import { notFound } from "next/navigation";

import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { BatchDetailView } from "@/features/batches/components/batch-detail-view";
import { getBatchDetail } from "@/features/batches/queries";
import { getProjectContext } from "@/features/projects/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status === "error") throw new Error(context.message);
  if (!context.activeProject) return <div className="mx-auto max-w-3xl"><EmptyState title="No tienes un proyecto operacional" description="Selecciona un proyecto antes de consultar el lote." /></div>;
  if (!context.permissions.includes("batch.view")) return <div className="mx-auto max-w-3xl"><EmptyState title="Sin acceso a lotes" description="Tu rol actual no incluye batch.view para este proyecto." /></div>;
  const detail = await getBatchDetail(context.activeProject.id, id, context.activeProject.timezone);
  if (!detail) notFound();
  return <BatchDetailView detail={detail} project={context.activeProject} permissions={{
    canCreate: context.permissions.includes("batch.create"),
    canModify: context.permissions.includes("batch.modify"),
    canCreateInvoice: context.permissions.includes("invoice.create"),
    canMatchInvoice: context.permissions.includes("invoice.match"),
    canReviewInvoice: context.permissions.includes("invoice.review"),
  }} />;
}
