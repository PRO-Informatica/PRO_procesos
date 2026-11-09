import { revalidatePath } from "next/cache";
import { CaptureError, captureContext, discardCapture, extractCapture, prepareCapture, saveCapture, savedGuideCapture } from "@/features/vision-ocr/capture-server";
import { getPublicEnvironment } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
function json(value: unknown, status = 200) { return Response.json(value, { status, headers }); }
async function handle(work: () => Promise<unknown>) {
  if (!["DEV", "PROD"].includes(getPublicEnvironment().appEnvironment)) return json({ error: "Herramienta no disponible." }, 404);
  try { return json(await work()); }
  catch (error) {
    if (error instanceof CaptureError) return json({ error: error.message, guideId: error.guideId }, error.status);
    console.error("[vision-guide] request_failed"); // Never log OCR text, photos or credentials.
    return json({ error: "No se pudo completar la captura. Intenta nuevamente." }, 500);
  }
}
async function readJson(request: Request) {
  if (Number(request.headers.get("content-length")) > 256000) throw new CaptureError("Solicitud demasiado grande.", 413);
  const text = await request.text();
  if (text.length > 256000) throw new CaptureError("Solicitud demasiado grande.", 413);
  try { return JSON.parse(text); } catch { throw new CaptureError("Datos inválidos."); }
}
export async function POST(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const context = await captureContext(request, url.searchParams.get("projectId") ?? "", url.searchParams.get("dispatchId") ?? "");
    if (url.searchParams.get("action") === "prepare") return prepareCapture(context, await readJson(request));
    if (Number(request.headers.get("content-length")) > 4 * 1024 * 1024) throw new CaptureError("El recorte supera el límite de carga.", 413);
    const data = await request.formData();
    const image = data.get("image"), capture = data.get("captureId");
    if (!(image instanceof File) || typeof capture !== "string") throw new CaptureError("Selecciona una fotografía.");
    const adjustmentText = String(data.get("adjustments") ?? "{}");
    if (adjustmentText.length > 5000) throw new CaptureError("Ajustes inválidos.");
    let adjustments: unknown;
    try { adjustments = JSON.parse(adjustmentText); } catch { throw new CaptureError("Ajustes inválidos."); }
    return extractCapture(context, capture, image, adjustments, data.get("manual") === "true");
  });
}
export async function PATCH(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const context = await captureContext(request, url.searchParams.get("projectId") ?? "", url.searchParams.get("dispatchId") ?? "");
    const input = await readJson(request);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || input.reviewed !== true) throw new CaptureError("Confirma que revisaste la guía antes de guardar.");
    const result = await saveCapture(context, String(input.captureId ?? ""), input.draft, input.expectedVersion);
    revalidatePath(`/dispatches/${context.dispatch.id}`); revalidatePath("/dispatches");
    return result;
  });
}
export async function DELETE(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const context = await captureContext(request, url.searchParams.get("projectId") ?? "", url.searchParams.get("dispatchId") ?? "");
    const input = await readJson(request);
    await discardCapture(context, String(input.captureId ?? ""));
    return { discarded: true };
  });
}
export async function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const context = await captureContext(request, url.searchParams.get("projectId") ?? "", url.searchParams.get("dispatchId") ?? "", true);
    return { capture: await savedGuideCapture(context, url.searchParams.get("guideId") ?? "") };
  });
}
