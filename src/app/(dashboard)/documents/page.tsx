import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { DocumentsWorkspace } from "@/features/documents/components/documents-workspace";
import { getGlobalDocuments } from "@/features/documents/queries";
import type { DocumentFilters } from "@/features/documents/types";
import { getProjectContext } from "@/features/projects/queries";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireActiveProfile(); const context = await getProjectContext(profile.id);
  if (context.status === "error") throw new Error(context.message);
  if (!context.activeProject) return <EmptyState title="Sin proyecto operacional" description="Selecciona un proyecto para consultar Documentos." />;
  if (!["document.view", "dispatch.view", "invoice.view"].some((permission) => context.permissions.includes(permission))) return <EmptyState title="Sin acceso a Documentos" description="Tu rol no tiene acceso documental en este proyecto." />;
  const raw = await searchParams; const get = (key: string) => { const value = raw[key]; return (Array.isArray(value) ? value[0] : value) || undefined; };
  const filters: DocumentFilters = { projectId: get("project"), type: get("type"), order: get("order"), guide: get("guide"), invoice: get("invoice"), userId: get("user"), dateFrom: get("from"), dateTo: get("to") };
  const projects = context.isCompanyAdmin ? context.projects.filter((p) => p.companyId === context.activeProject?.companyId) : [context.activeProject];
  return <DocumentsWorkspace filters={filters} data={await getGlobalDocuments(projects.map(({ id, name }) => ({ id, name })), filters)} />;
}
