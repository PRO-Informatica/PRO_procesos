import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { InvoicesWorkspace } from "@/features/invoices/components/invoices-workspace";
import { getGlobalInvoices } from "@/features/invoices/queries";
import { getProjectContext } from "@/features/projects/queries";
import { canAccessOperationalSection } from "@/features/projects/access-policy";

export default async function InvoicesPage() {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status === "error") throw new Error(context.message);
  if (!context.activeProject) return <EmptyState title="Sin proyecto operacional" description="Selecciona un proyecto para consultar facturas."/>;
  if (!canAccessOperationalSection(context.roleCodes, "/invoices") || !context.permissions.includes("invoice.view")) return <EmptyState title="Sin acceso a Facturas" description="Esta sección no está disponible para tu rol."/>;
  return <InvoicesWorkspace project={context.activeProject} data={await getGlobalInvoices(context.activeProject.id)}/>;
}
