import {
  getMailboxPublicError,
  listOperationalMailbox,
} from "@/features/integrations/gmail/mailbox-service";
import type { GmailMailboxFolder } from "@/features/integrations/gmail/mailbox-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const folder = url.searchParams.get("folder") === "SENT" ? "SENT" : "INBOX";
    const data = await listOperationalMailbox({
      projectId: url.searchParams.get("projectId") ?? "",
      folder: folder as GmailMailboxFolder,
      pageToken: url.searchParams.get("pageToken"),
    });
    return Response.json({ data }, { headers: HEADERS });
  } catch (error) {
    const result = getMailboxPublicError(error);
    return Response.json(
      { code: result.code, message: result.message },
      { status: result.status, headers: HEADERS },
    );
  }
}
