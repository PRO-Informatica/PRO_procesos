import { requireActiveProfile } from "@/features/auth/queries";
import { getBatchPageData, getUniversalBatchScope } from "@/features/batches/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    if (!UUID.test(projectId)) return Response.json({ message: "El proyecto no es válido." }, { status: 400 });

    const profile = await requireActiveProfile();
    const scope = await getUniversalBatchScope(profile.id, projectId);
    if (!scope) return Response.json({ message: "No tienes acceso a los lotes de este proyecto." }, { status: 403 });

    const data = await getBatchPageData(projectId, scope.project.timezone);
    return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Universal batch project refresh failed", error);
    return Response.json({ message: "No fue posible actualizar los lotes del proyecto." }, { status: 500 });
  }
}
