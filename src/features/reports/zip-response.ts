import { Readable } from "node:stream";
import type JSZip from "jszip";

// Send actual chunks rather than one buffered response. This also avoids the
// buffered Vercel Function response-size limit for photo/PDF evidence bundles.
export function reportZipResponse(zip: JSZip, filename: string) {
  const stream = zip.generateNodeStream({
    streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 6 },
  });
  return new Response(Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
