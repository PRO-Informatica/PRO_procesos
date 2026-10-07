export const VISION_TEMPLATE_TYPES = [
  "DISPATCH_GUIDE",
  "MIXTO_OPERATION",
  "PANEXUS_OPERATION",
] as const;

export type VisionTemplateType = (typeof VISION_TEMPLATE_TYPES)[number];

export type LocalTemplateAnalysis = {
  templateType: VisionTemplateType;
  mixtoCuredBySupplier: boolean | null;
};

export const VISION_TEMPLATE_LABELS: Record<VisionTemplateType, string> = {
  DISPATCH_GUIDE: "Guía de despacho",
  MIXTO_OPERATION: "Pedido / control operación · Mixto Listo",
  PANEXUS_OPERATION: "Pedido / control operación · Panexus",
};

export function isVisionTemplateType(value: unknown): value is VisionTemplateType {
  return typeof value === "string" && VISION_TEMPLATE_TYPES.includes(value as VisionTemplateType);
}

type PixelSource = { data: Uint8ClampedArray; width: number; height: number };

function cropDarkRatio(source: PixelSource, xStart: number, xEnd: number, yStart: number, yEnd: number) {
  const left = Math.max(0, Math.floor(source.width * xStart));
  const right = Math.min(source.width, Math.ceil(source.width * xEnd));
  const top = Math.max(0, Math.floor(source.height * yStart));
  const bottom = Math.min(source.height, Math.ceil(source.height * yEnd));
  let dark = 0;
  let total = 0;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * source.width + x) * 4;
      const luminance = source.data[offset] * 0.299 + source.data[offset + 1] * 0.587 + source.data[offset + 2] * 0.114;
      if (luminance < 140) dark += 1;
      total += 1;
    }
  }
  return total ? dark / total : 0;
}

function detectMixtoCuringMark(source: PixelSource) {
  const yesInk = cropDarkRatio(source, 0.234, 0.25, 0.489, 0.506);
  const noInk = cropDarkRatio(source, 0.322, 0.338, 0.489, 0.506);
  const difference = yesInk - noInk;
  if (Math.abs(difference) < 0.035) return null;
  return difference > 0;
}

export function classifyTemplatePixels(source: PixelSource): LocalTemplateAnalysis {
  if (source.width / source.height >= 1.2) {
    return { templateType: "DISPATCH_GUIDE", mixtoCuredBySupplier: null };
  }

  const left = 0;
  const right = Math.max(1, Math.floor(source.width * 0.32));
  const bottom = Math.max(1, Math.floor(source.height * 0.22));
  let red = 0;
  let sampled = 0;
  for (let y = 0; y < bottom; y += 2) {
    for (let x = left; x < right; x += 2) {
      const offset = (y * source.width + x) * 4;
      const r = source.data[offset];
      const g = source.data[offset + 1];
      const b = source.data[offset + 2];
      if (r > 105 && r > g * 1.28 && r > b * 1.28) red += 1;
      sampled += 1;
    }
  }

  const templateType: VisionTemplateType = sampled && red / sampled >= 0.015
    ? "MIXTO_OPERATION"
    : "PANEXUS_OPERATION";
  return {
    templateType,
    mixtoCuredBySupplier: templateType === "MIXTO_OPERATION" ? detectMixtoCuringMark(source) : null,
  };
}

export async function analyzeVisionTemplate(file: File): Promise<LocalTemplateAnalysis> {
  const bitmap = await createImageBitmap(file);
  try {
    const maximumSide = 900;
    const scale = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("CANVAS_UNAVAILABLE");
    context.drawImage(bitmap, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    return classifyTemplatePixels({ data: imageData.data, width, height });
  } finally {
    bitmap.close();
  }
}
