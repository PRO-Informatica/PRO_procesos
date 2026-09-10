import { requireActiveProfile } from "@/features/auth/queries";
import { getBatchDetail, getBatchSecondaryData, getUniversalBatchScope } from "@/features/batches/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const requestStartedAt = performance.now();
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? "";
    const batchId = url.searchParams.get("batchId") ?? "";
    const section = url.searchParams.get("section") === "secondary" ? "secondary" : "core";
    if (!UUID.test(projectId) || !UUID.test(batchId)) {
      return Response.json({ message: "El proyecto o lote no es válido." }, { status: 400 });
    }

    const profile = await requireActiveProfile();
    const scope = await getUniversalBatchScope(profile.id, projectId);
    if (!scope) {
      return Response.json({ message: "No tienes acceso a este lote." }, { status: 403 });
    }

    const data = section === "secondary"
      ? await getBatchSecondaryData(projectId, batchId)
      : await getBatchDetail(projectId, batchId, scope.project.timezone, { includeSecondary: false });
    if (!data) return Response.json({ message: "No se encontró el lote solicitado." }, { status: 404 });
    const totalDuration = Math.round((performance.now() - requestStartedAt) * 10) / 10;
    return Response.json({ data }, {
      headers: {
        "Cache-Control": "private, no-store",
        "Server-Timing": `detail;dur=${data.loadMetrics.durationMs}, total;dur=${totalDuration}`,
        "X-Detail-Query-Count": String(data.loadMetrics.queryCount),
        "X-Detail-Query-Stages": String(data.loadMetrics.stageCount),
      },
    });
  } catch (error) {
    console.error("Universal batch detail failed", error);
    return Response.json({ message: "No fue posible cargar el detalle del lote." }, { status: 500 });
  }
}
