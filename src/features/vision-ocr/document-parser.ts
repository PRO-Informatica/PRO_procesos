import type { GoogleVisionResponse } from "./vision-ocr.ts";
import { normalizeOcrText, type ParsedDispatchGuide, parseDispatchGuide } from "./guide-parser.ts";
import { parseMixtoOperation, parseServicesOperation, type ParsedMixtoOperation, type ParsedServicesOperation } from "./operation-parser.ts";
import { findGuideLabels, orientedGuideWords } from "./complete-guide-parser.ts";
import { hasControlHeading } from "./control-template.ts";
import type { VisionTemplateType } from "./template-classifier.ts";

export type ParsedDispatchGuideDocument = ParsedDispatchGuide & { templateType: "DISPATCH_GUIDE" };
export type ParsedVisionDocument = ParsedDispatchGuideDocument | ParsedMixtoOperation | ParsedServicesOperation;

export function detectVisionTemplate(text: string, response?: GoogleVisionResponse): VisionTemplateType | null {
  const normalized = normalizeOcrText(text);
  if (normalized.includes("GUIA DE DESPACHO")) return "DISPATCH_GUIDE";
  if (!hasControlHeading(text)) return null;

  // Identify the document family first, then its issuer. Mentions in the
  // customer, work group or observations are not the document's brand.
  const words = response ? orientedGuideWords(response) : [];
  const bodyLabels = findGuideLabels(words, { body: ["PEDIDO POR", "NOMBRE DEL CLIENTE", "DIRECCION OBRA", "DIRECCION DE OBRA", "GRUPO DE TRABAJO", "OBSERVACIONES"] });
  const bodyTop = Math.min(...bodyLabels.map((label) => label.y), .23);
  const headerBrand = words.length
    ? normalizeOcrText(words.filter((word) => word.y + word.h / 2 < bodyTop)
      .sort((a, b) => Math.abs(a.y - b.y) < Math.min(a.h, b.h) * .6 ? a.x - b.x : a.y - b.y)
      .map((word) => word.text).join(" "))
    : normalized.split(/\b(?:PEDIDO POR|NOMBRE DEL CLIENTE|DIRECCION (?:DE )?OBRA|GRUPO DE TRABAJO|OBSERVACIONES)\b/u)[0];
  // Historical captures retain this identifier; all other suppliers now share
  // the general Servicios varios parser, without Panexus-specific rules.
  return headerBrand.includes("MIXTO LISTO") ? "MIXTO_OPERATION" : "PANEXUS_OPERATION";
}

export function parseVisionDocument(
  response: GoogleVisionResponse,
  templateType: VisionTemplateType,
  curedByMixto: boolean | null,
): ParsedVisionDocument {
  if (templateType === "MIXTO_OPERATION") return parseMixtoOperation(response, curedByMixto);
  if (templateType === "PANEXUS_OPERATION") return parseServicesOperation(response);
  return { templateType: "DISPATCH_GUIDE", ...parseDispatchGuide(response) };
}
