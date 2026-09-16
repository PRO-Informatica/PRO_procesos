import "server-only";

export async function readLimitedJsonBody(request: Request, maxBytes = 64 * 1024) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("REQUEST_BODY_TOO_LARGE");
  }
  if (!request.body) throw new Error("REQUEST_BODY_MISSING");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("REQUEST_BODY_INVALID");
  }
}

async function readLimitedBodyBytes(request: Request, maxBytes: number) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("REQUEST_BODY_TOO_LARGE");
  }
  if (!request.body) throw new Error("REQUEST_BODY_MISSING");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readLimitedMultipartFormData(request: Request, maxBytes: number) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;\s*boundary=/iu.test(contentType)) {
    throw new Error("REQUEST_CONTENT_TYPE_INVALID");
  }
  const bytes = await readLimitedBodyBytes(request, maxBytes);
  try {
    return await new Request("http://local.invalid", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: bytes,
    }).formData();
  } catch {
    throw new Error("REQUEST_BODY_INVALID");
  }
}

export function getMultipartBodyPublicError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "REQUEST_BODY_TOO_LARGE") {
    return {
      status: 413,
      code,
      message: "Los archivos seleccionados superan el límite permitido.",
    };
  }
  if (["REQUEST_BODY_MISSING", "REQUEST_BODY_INVALID", "REQUEST_CONTENT_TYPE_INVALID"].includes(code)) {
    return {
      status: 400,
      code: "REQUEST_BODY_INVALID",
      message: "La solicitud de correo no es válida.",
    };
  }
  return null;
}
