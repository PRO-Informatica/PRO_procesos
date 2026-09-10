import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { UniversalInvoicesWorkspace } from "@/features/invoices/universal/components/universal-invoices-workspace";
import { getOperationalProjectAccess } from "@/features/projects/queries";

export default async function UniversalInvoicesPage() {
  const profile = await requireActiveProfile();
  const scopes = await getOperationalProjectAccess(profile.id);
  const projects = scopes
    .filter(({ project, permissions }) =>
      project.status === "ACTIVE" &&
      ["invoice.universal", "invoice.view", "invoice.create", "invoice.match"].every((permission) =>
        permissions.includes(permission),
      ),
    )
    .map(({ project }) => ({ id: project.id, code: project.code, name: project.name }));
  if (!projects.length) {
    return <EmptyState title="Sin acceso a Facturas Universal" description="Necesitas invoice.universal, invoice.view, invoice.create e invoice.match en al menos un proyecto." />;
  }
  return <UniversalInvoicesWorkspace authorizedProjects={projects} />;
}
