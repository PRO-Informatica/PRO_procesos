import {
  getMailboxPublicError,
  getOperationalThread,
} from "@/features/integrations/gmail/mailbox-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await context.params;
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    const data = await getOperationalThread(projectId, threadId);
    return Response.json({ data }, { headers: HEADERS });
  } catch (error) {
    const result = getMailboxPublicError(error);
    return Response.json(
      { code: result.code, message: result.message },
      { status: result.status, headers: HEADERS },
    );
  }
}
