import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { InvoicesWorkspace } from "@/features/invoices/components/invoices-workspace";
import { getGlobalInvoices } from "@/features/invoices/queries";
import { getProjectContext } from "@/features/projects/queries";

export default async function InvoicesPage() {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status === "error") throw new Error(context.message);
  if (!context.activeProject) return <EmptyState title="Sin proyecto operacional" description="Selecciona un proyecto para consultar facturas."/>;
  if (!context.permissions.includes("invoice.view")) return <EmptyState title="Sin acceso a Facturas" description="Tu rol no incluye invoice.view para este proyecto."/>;
  return <InvoicesWorkspace project={context.activeProject} data={await getGlobalInvoices(context.activeProject.id)}/>;
}
