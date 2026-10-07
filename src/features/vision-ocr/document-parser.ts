import type { GoogleVisionResponse } from "./vision-ocr.ts";
import { extractVisionLayoutWords, normalizeOcrText, type ParsedDispatchGuide, parseDispatchGuide } from "./guide-parser.ts";
import { parseMixtoOperation, parsePanexusOperation, type ParsedMixtoOperation, type ParsedPanexusOperation } from "./operation-parser.ts";
import type { VisionTemplateType } from "./template-classifier.ts";

export type ParsedDispatchGuideDocument = ParsedDispatchGuide & { templateType: "DISPATCH_GUIDE" };
export type ParsedVisionDocument = ParsedDispatchGuideDocument | ParsedMixtoOperation | ParsedPanexusOperation;

function includesAll(value: string, parts: string[]) {
  return parts.every((part) => value.includes(part));
}

export function detectVisionTemplate(text: string, response?: GoogleVisionResponse): VisionTemplateType | null {
  const normalized = normalizeOcrText(text);
  if (normalized.includes("GUIA DE DESPACHO")) return "DISPATCH_GUIDE";
  if (!normalized.includes("CONTROL OPERACION")) return null;

  const headerBrand = response
    ? normalizeOcrText(extractVisionLayoutWords(response)
      .filter((word) => {
        const x = (word.xStart + word.xEnd) / 2;
        const y = (word.yStart + word.yEnd) / 2;
        return x <= 0.42 && y <= 0.23;
      })
      .map((word) => word.text)
      .join(" "))
    : "";

  let mixtoScore = 0;
  let panexusScore = 0;
  if (headerBrand.includes("MIXTO LISTO")) mixtoScore += 20;
  if (headerBrand.includes("PANEXUS")) panexusScore += 20;
  if (normalized.includes("MIXTO LISTO")) mixtoScore += 8;
  if (normalized.includes("CURADO POR MIXTO LISTO")) mixtoScore += 5;
  if (normalized.includes("TUBERIA DEJADA EN OBRA")) mixtoScore += 4;
  if (includesAll(normalized, ["PEDIDO NO", "NIT"])) mixtoScore += 2;
  if (normalized.includes("PANEXUS")) panexusScore += 6;
  if (normalized.includes("CURADO POR PANEXUS")) panexusScore += 5;
  if (normalized.includes("RELEVANTES")) panexusScore += 4;
  if (normalized.includes("FORMALETA")) panexusScore += 3;
  if (includesAll(normalized, ["CODIGO", "NO FACTURA"])) panexusScore += 2;

  if (mixtoScore === 0 && panexusScore === 0) return null;
  return mixtoScore >= panexusScore ? "MIXTO_OPERATION" : "PANEXUS_OPERATION";
}

export function parseVisionDocument(
  response: GoogleVisionResponse,
  templateType: VisionTemplateType,
  curedByMixto: boolean | null,
): ParsedVisionDocument {
  if (templateType === "MIXTO_OPERATION") return parseMixtoOperation(response, curedByMixto);
  if (templateType === "PANEXUS_OPERATION") return parsePanexusOperation(response);
  return { templateType: "DISPATCH_GUIDE", ...parseDispatchGuide(response) };
}
