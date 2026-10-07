export const VISION_OCR_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
export const VISION_OCR_MAX_BYTES = 7 * 1024 * 1024;
export const VISION_OCR_ACCEPT = "image/jpeg,image/png,image/webp";

export const VISION_OCR_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type GoogleVisionResponse = {
  responses?: Array<{
    fullTextAnnotation?: {
      text?: string;
      pages?: Array<{
        width?: number;
        height?: number;
        blocks?: Array<{
          paragraphs?: Array<{
            words?: Array<{
              symbols?: Array<{ text?: string }>;
              boundingBox?: {
                vertices?: Array<{ x?: number; y?: number }>;
              };
            }>;
          }>;
        }>;
      }>;
    };
    error?: { code?: number; message?: string; status?: string };
  }>;
  error?: { code?: number; message?: string; status?: string };
};

export function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

export function isAllowedVisionImageType(type: string) {
  return VISION_OCR_ALLOWED_TYPES.has(type.toLowerCase());
}

export function hasValidImageSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (mimeType === "image/png") {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= png.length && png.every((value, index) => bytes[index] === value);
  }

  if (mimeType === "image/webp") {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }

  return false;
}

export function buildVisionRequestBody(base64Content: string) {
  return {
    requests: [
      {
        image: { content: base64Content },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
      },
    ],
  };
}

export function extractVisionText(response: GoogleVisionResponse) {
  const error = response.error ?? response.responses?.[0]?.error;
  if (error) return { error: true as const };

  const text = response.responses?.[0]?.fullTextAnnotation?.text;
  return { error: false as const, text: typeof text === "string" ? text : "" };
}
