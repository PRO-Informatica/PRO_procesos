import { notFound } from "next/navigation";

import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { OrderDetailView } from "@/features/batches/components/order-detail-view";
import { getReconciliationOrderDetail } from "@/features/batches/order-queries";
import { getProjectContext } from "@/features/projects/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function OrderReconciliationPage({ params }: { params: Promise<{ id: string; orderId: string }> }) {
  const { id, orderId } = await params;
  if (!UUID.test(id) || !UUID.test(orderId)) notFound();
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status === "error") throw new Error(context.message);
  if (!context.activeProject) return <EmptyState title="Sin proyecto operacional" description="Selecciona un proyecto antes de consultar el pedido." />;
  if (!context.permissions.includes("invoice.view") || !context.permissions.includes("batch.view")) return <EmptyState title="Sin acceso a conciliación" description="Tu rol no incluye invoice.view y batch.view para este proyecto." />;
  const detail = await getReconciliationOrderDetail(context.activeProject.id, id, orderId, context.activeProject.timezone);
  if (!detail) notFound();
  return <OrderDetailView detail={detail} permissions={{
    canCreate: context.permissions.includes("batch.create"),
    canAddGuide: context.permissions.includes("batch.add_guide"),
    canModify: context.permissions.includes("batch.modify"),
    canCreateInvoice: context.permissions.includes("invoice.create"),
    canMatchInvoice: context.permissions.includes("invoice.match"),
    canReviewInvoice: context.permissions.includes("invoice.review"),
  }} />;
}
