import "server-only";

import {
  buildVisionRequestBody,
  extractVisionText,
  hasValidImageSignature,
  isAllowedVisionImageType,
  type GoogleVisionResponse,
  VISION_OCR_ENDPOINT,
  VISION_OCR_MAX_BYTES,
} from "./vision-ocr";
import { detectVisionTemplate, parseVisionDocument } from "./document-parser";
import type { VisionTemplateType } from "./template-classifier";

export class VisionOcrError extends Error {
  constructor(
    public readonly publicMessage: string,
    public readonly status: number,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = "VisionOcrError";
  }
}

async function readValidatedImage(file: File) {
  if (!file.size) {
    throw new VisionOcrError("La imagen está vacía.", 400, "EMPTY_IMAGE");
  }
  if (file.size > VISION_OCR_MAX_BYTES) {
    throw new VisionOcrError("La imagen supera el límite permitido de 7 MiB.", 413, "IMAGE_TOO_LARGE");
  }
  if (!isAllowedVisionImageType(file.type)) {
    throw new VisionOcrError("Selecciona una imagen JPG, PNG o WEBP.", 400, "UNSUPPORTED_IMAGE_TYPE");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasValidImageSignature(bytes, file.type)) {
    throw new VisionOcrError("El contenido no corresponde a una imagen válida.", 400, "INVALID_IMAGE_SIGNATURE");
  }
  return bytes;
}

function googleFailureStatus(status: number) {
  if (status === 429) return 429;
  if (status >= 500) return 503;
  return 502;
}

export async function extractDocumentText(
  file: File,
  requestedTemplate: VisionTemplateType,
  curedByMixto: boolean | null,
) {
  const apiKey = process.env.GOOGLE_VISION_API_DEV_KEY;
  if (!apiKey) {
    throw new VisionOcrError(
      "Google Vision OCR no está configurado en este ambiente.",
      503,
      "API_KEY_NOT_CONFIGURED",
    );
  }

  const bytes = await readValidatedImage(file);
  const body = buildVisionRequestBody(Buffer.from(bytes).toString("base64"));

  let response: Response;
  try {
    response = await fetch(VISION_OCR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new VisionOcrError(
      "No fue posible conectar con Google Vision. Intenta nuevamente.",
      503,
      "GOOGLE_VISION_UNAVAILABLE",
    );
  }

  let payload: GoogleVisionResponse;
  try {
    payload = await response.json() as GoogleVisionResponse;
  } catch {
    throw new VisionOcrError(
      "Google Vision devolvió una respuesta no válida.",
      502,
      "INVALID_GOOGLE_RESPONSE",
    );
  }

  if (!response.ok) {
    throw new VisionOcrError(
      response.status === 429
        ? "Se alcanzó temporalmente el límite de Google Vision. Intenta más tarde."
        : "Google Vision no pudo procesar la imagen.",
      googleFailureStatus(response.status),
      `GOOGLE_HTTP_${response.status}`,
    );
  }

  const result = extractVisionText(payload);
  if (result.error) {
    throw new VisionOcrError(
      "Google Vision no pudo procesar la imagen.",
      502,
      "GOOGLE_ANNOTATION_ERROR",
    );
  }

  const confirmedTemplate = detectVisionTemplate(result.text, payload);
  const templateType = confirmedTemplate ?? requestedTemplate;
  const document = parseVisionDocument(payload, templateType, curedByMixto);
  if (confirmedTemplate && confirmedTemplate !== requestedTemplate) {
    document.warnings.unshift("La plantilla detectada en el servidor fue distinta a la estimación local; se usó la identificación confirmada por el contenido.");
  }

  return {
    text: result.text,
    templateType,
    document,
  };
}
