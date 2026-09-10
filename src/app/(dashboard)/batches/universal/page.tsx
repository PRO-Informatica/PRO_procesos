import { EmptyState } from "@/components/feedback/empty-state";
import { requireActiveProfile } from "@/features/auth/queries";
import { UniversalBatchesWorkspace } from "@/features/batches/components/universal-batches-workspace";
import { getUniversalBatchOverview, getUniversalBatchScopes } from "@/features/batches/queries";

export default async function UniversalBatchesPage() {
  const profile = await requireActiveProfile();
  const scopes = await getUniversalBatchScopes(profile.id);
  if (!scopes.length) {
    return <div className="mx-auto max-w-3xl"><EmptyState title="Sin acceso a Lotes Universal" description="Esta vista está disponible para Compras y administradores de empresa con acceso real a lotes." /></div>;
  }

  const overview = await getUniversalBatchOverview(scopes);
  return <UniversalBatchesWorkspace projects={overview} />;
}
