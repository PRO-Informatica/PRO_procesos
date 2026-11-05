import { validGuideCrop, type GuideCrop, type Point } from "./image-geometry.ts";
import { chooseGuideContrast, detectGuideBoundary, detectGuideOrientation } from "./automatic-image.ts";
export { FULL_GUIDE_CROP, validGuideCrop, type GuideCrop, type Point } from "./image-geometry.ts";
export type ImageQuality = { width: number; height: number; contrast: number; sharpness: number; warnings: string[] };
export type PreparedGuideImage = { file: File; quality: ImageQuality; preview: string; enhanced: boolean };

export function imageQuality(data: Uint8ClampedArray, width: number, height: number, sourceWidth = width, sourceHeight = height): ImageQuality {
  const gray = new Float32Array(width * height);
  let sum = 0, squares = 0, dark = 0, light = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
    gray[i] = v; sum += v; squares += v * v; if (v < 35) dark++; if (v > 248) light++;
  }
  const contrast = Math.sqrt(Math.max(0, squares / gray.length - (sum / gray.length) ** 2));
  let lapSum = 0, lapSq = 0, count = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, v = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
    lapSum += v; lapSq += v * v; count++;
  }
  const sharpness = count ? lapSq / count - (lapSum / count) ** 2 : 0;
  const warnings: string[] = [];
  if (Math.min(sourceWidth, sourceHeight) < 700) warnings.push("La guía ocupa pocos píxeles. Acerca la cámara y toma una foto de mayor resolución.");
  if (contrast < 22 || dark / gray.length > 0.6 || light / gray.length > 0.8) warnings.push("La iluminación o el contraste dificultan la lectura. Evita sombras y reflejos.");
  if (sharpness < 55) warnings.push("La imagen podría estar desenfocada. Limpia la cámara y mantenla quieta.");
  return { width: sourceWidth, height: sourceHeight, contrast: Math.round(contrast), sharpness: Math.round(sharpness), warnings };
}

export async function rotatedGuideImage(file: File, turns: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const angle = ((turns % 4) + 4) % 4;
    // Full-resolution original stays untouched in Storage. Processing is bounded.
    const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = angle % 2 ? height : width; canvas.height = angle % 2 ? width : height;
    const ctx = canvas.getContext("2d"); if (!ctx) throw Error("Tu navegador no pudo preparar la fotografía.");
    ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(angle * Math.PI / 2);
    ctx.drawImage(bitmap, -width / 2, -height / 2, width, height);
    return canvas;
  } finally { bitmap.close(); }
}

export function automaticGuideCrop(source: HTMLCanvasElement) {
  const sample = document.createElement("canvas");
  const scale = Math.min(1, 600 / Math.max(source.width, source.height));
  sample.width = Math.max(1, Math.round(source.width * scale));
  sample.height = Math.max(1, Math.round(source.height * scale));
  const ctx = sample.getContext("2d");
  if (!ctx) throw Error("No se pudo analizar la foto.");
  ctx.drawImage(source, 0, 0, sample.width, sample.height);
  return detectGuideBoundary(ctx.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height);
}

export function automaticGuideOrientation(source: HTMLCanvasElement) {
  const sample = document.createElement("canvas");
  const scale = Math.min(1, 600 / Math.max(source.width, source.height));
  sample.width = Math.max(1, Math.round(source.width * scale)); sample.height = Math.max(1, Math.round(source.height * scale));
  const ctx = sample.getContext("2d"); if (!ctx) return 0;
  ctx.drawImage(source, 0, 0, sample.width, sample.height);
  return detectGuideOrientation(ctx.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height);
}

// Unit square -> selected quadrilateral. Projective mapping corrects perspective;
// bilinear sampling avoids erasing thin handwriting with a binary threshold.
function projective(crop: GuideCrop) {
  const [a, b, c, d] = crop;
  const dx1 = b.x - c.x, dx2 = d.x - c.x, dx3 = a.x - b.x + c.x - d.x;
  const dy1 = b.y - c.y, dy2 = d.y - c.y, dy3 = a.y - b.y + c.y - d.y;
  const divisor = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / divisor, h = (dx1 * dy3 - dx3 * dy1) / divisor;
  return (u: number, v: number) => {
    const denominator = g * u + h * v + 1;
    return { x: ((b.x - a.x + g * b.x) * u + (d.x - a.x + h * d.x) * v + a.x) / denominator,
      y: ((b.y - a.y + g * b.y) * u + (d.y - a.y + h * d.y) * v + a.y) / denominator };
  };
}

export async function prepareGuideImage(source: HTMLCanvasElement, crop: GuideCrop, enhance: boolean | "auto") {
  if (!validGuideCrop(crop)) throw Error("Marca las cuatro esquinas en orden, sin cruzarlas, incluyendo toda la guía.");
  const distance = (a: Point, b: Point) => Math.hypot((b.x - a.x) * source.width, (b.y - a.y) * source.height);
  const rawWidth = Math.max(distance(crop[0], crop[1]), distance(crop[3], crop[2]));
  const rawHeight = Math.max(distance(crop[0], crop[3]), distance(crop[1], crop[2]));
  const scale = Math.min(1, 2200 / Math.max(rawWidth, rawHeight));
  const width = Math.max(1, Math.round(rawWidth * scale)), height = Math.max(1, Math.round(rawHeight * scale));
  const input = source.getContext("2d")!.getImageData(0, 0, source.width, source.height).data;
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const output = ctx.createImageData(width, height);
  const map = projective(crop);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = map(x / Math.max(1, width - 1), y / Math.max(1, height - 1));
    const sx = Math.max(0, Math.min(source.width - 1, p.x * (source.width - 1))), sy = Math.max(0, Math.min(source.height - 1, p.y * (source.height - 1)));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const i0 = (y0 * source.width + x0) * 4, i1 = (y0 * source.width + Math.min(x0 + 1, source.width - 1)) * 4;
    const i2 = (Math.min(y0 + 1, source.height - 1) * source.width + x0) * 4, i3 = (Math.min(y0 + 1, source.height - 1) * source.width + Math.min(x0 + 1, source.width - 1)) * 4;
    const out = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) output.data[out + c] = input[i0 + c] * (1 - fx) * (1 - fy) + input[i1 + c] * fx * (1 - fy) + input[i2 + c] * (1 - fx) * fy + input[i3 + c] * fx * fy;
    output.data[out + 3] = 255;
  }
  ctx.putImageData(output, 0, 0);
  const sample = document.createElement("canvas");
  sample.width = Math.min(600, width); sample.height = Math.max(1, Math.round(height * sample.width / width));
  sample.getContext("2d")!.drawImage(canvas, 0, 0, sample.width, sample.height);
  const quality = imageQuality(sample.getContext("2d")!.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height, width, height);
  // Assess the unfiltered raster. Enhancement cannot hide a quality warning.
  const choice = chooseGuideContrast(sample.getContext("2d")!.getImageData(0, 0, sample.width, sample.height).data);
  const enhanced = enhance === "auto" ? choice.apply : enhance;
  if (enhanced) {
    const gain = enhance === "auto" ? choice.gain : 1.12;
    for (let i = 0; i < output.data.length; i += 4) for (let c = 0; c < 3; c++) {
      // Soft contrast only: no binary threshold or removal of colored ink.
      output.data[i + c] = Math.max(0, 255 - (255 - output.data[i + c]) * gain);
    }
    ctx.putImageData(output, 0, 0);
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(Error("No se pudo preparar la imagen.")), "image/jpeg", 0.9));
  if (blob.size > 3 * 1024 * 1024) throw Error("El recorte supera 3 MiB. Reduce el área de fondo y vuelve a intentar.");
  return { file: new File([blob], "guia-lectura.jpg", { type: "image/jpeg" }), quality, preview: URL.createObjectURL(blob), enhanced };
}
