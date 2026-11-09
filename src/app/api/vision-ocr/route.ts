import type { ParsedVisionDocument } from "@/features/vision-ocr/document-parser";
import { extractDocumentText, VisionOcrError } from "@/features/vision-ocr/service";
import { isVisionTemplateType, type VisionTemplateType } from "@/features/vision-ocr/template-classifier";
import { VISION_OCR_MAX_BYTES } from "@/features/vision-ocr/vision-ocr";
import { hasValidSameOrigin } from "@/lib/http/same-origin";
import { getPublicEnvironment } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

function json(body: { success: boolean; text?: string; templateType?: VisionTemplateType; document?: ParsedVisionDocument; error?: string }, status = 200) {
  return Response.json(body, { status, headers: PRIVATE_HEADERS });
}

async function authorizeRequest() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return { status: 401, error: "Tu sesión no está disponible." };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("active")
    .eq("id", userId)
    .maybeSingle<{ active: boolean }>();

  if (profileError || !profile?.active) {
    return { status: 403, error: "Tu usuario no tiene acceso a esta herramienta." };
  }
  return null;
}

export async function POST(request: Request) {
  if (getPublicEnvironment().appEnvironment !== "DEV") {
    return json({ success: false, error: "Herramienta no disponible." }, 404);
  }
  if (!hasValidSameOrigin(request)) return json({ success: false, error: "Solicitud no válida." }, 403);

  const authorizationError = await authorizeRequest();
  if (authorizationError) {
    return json({ success: false, error: authorizationError.error }, authorizationError.status);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > VISION_OCR_MAX_BYTES + 1024 * 1024) {
    return json({ success: false, error: "La imagen supera el límite permitido de 7 MiB." }, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ success: false, error: "La solicitud de imagen no es válida." }, 400);
  }

  const image = formData.get("image");
  if (!(image instanceof File)) {
    return json({ success: false, error: "Selecciona una imagen." }, 400);
  }

  const templateType = formData.get("templateType");
  if (!isVisionTemplateType(templateType)) {
    return json({ success: false, error: "No fue posible identificar la plantilla de la imagen." }, 400);
  }
  const curedByMixtoValue = formData.get("mixtoCuredBySupplier");
  const curedByMixto = curedByMixtoValue === "true" ? true : curedByMixtoValue === "false" ? false : null;

  try {
    const result = await extractDocumentText(image, templateType, curedByMixto);
    return json({ success: true, ...result });
  } catch (error) {
    if (error instanceof VisionOcrError) {
      console.error("[vision-ocr] request_failed", { reason: error.reason, status: error.status });
      return json({ success: false, error: error.publicMessage }, error.status);
    }
    console.error("[vision-ocr] unexpected_failure");
    return json({ success: false, error: "No fue posible extraer el texto de la imagen." }, 500);
  }
}
