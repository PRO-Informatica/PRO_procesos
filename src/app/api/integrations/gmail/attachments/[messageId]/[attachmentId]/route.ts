import {
  downloadOperationalAttachment,
  getMailboxPublicError,
} from "@/features/integrations/gmail/mailbox-service";
import { sanitizeAttachmentFileName } from "@/features/integrations/gmail/mailbox-mime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ messageId: string; attachmentId: string }> },
) {
  try {
    const { messageId, attachmentId } = await context.params;
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    const result = await downloadOperationalAttachment({
      projectId,
      messageId,
      attachmentId,
    });
    const inline = new URL(request.url).searchParams.get("disposition") === "inline";
    const fileName = sanitizeAttachmentFileName(result.attachment.fileName);
    const fallback = fileName.replace(/[^a-zA-Z0-9._-]/gu, "_") || "adjunto";
    const encodedFileName = encodeURIComponent(fileName).replace(
      /['()*]/gu,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    const disposition = inline && result.attachment.previewable ? "inline" : "attachment";
    return new Response(new Uint8Array(result.bytes), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodedFileName}`,
        "Content-Length": String(result.bytes.byteLength),
        "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox",
        "Content-Type": result.attachment.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const result = getMailboxPublicError(error);
    return Response.json(
      { code: result.code, message: result.message },
      { status: result.status, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
