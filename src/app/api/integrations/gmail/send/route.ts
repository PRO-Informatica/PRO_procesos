import {
  getMailboxPublicError,
  sendOperationalEmail,
} from "@/features/integrations/gmail/mailbox-service";
import { GMAIL_MULTIPART_REQUEST_MAX_BYTES } from "@/features/integrations/gmail/attachment-constants";
import {
  getMultipartBodyPublicError,
  readLimitedMultipartFormData,
} from "@/features/integrations/gmail/mailbox-http";
import { hasValidSameOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(request: Request) {
  if (!hasValidSameOrigin(request)) {
    return Response.json({ message: "Solicitud no válida." }, { status: 403, headers: HEADERS });
  }
  try {
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    const data = await sendOperationalEmail(
      projectId,
      () => readLimitedMultipartFormData(request, GMAIL_MULTIPART_REQUEST_MAX_BYTES),
    );
    return Response.json({ data }, { headers: HEADERS });
  } catch (error) {
    const bodyError = getMultipartBodyPublicError(error);
    if (bodyError) {
      return Response.json(
        { code: bodyError.code, message: bodyError.message },
        { status: bodyError.status, headers: HEADERS },
      );
    }
    const result = getMailboxPublicError(error);
    return Response.json(
      { code: result.code, message: result.message },
      { status: result.status, headers: HEADERS },
    );
  }
}
