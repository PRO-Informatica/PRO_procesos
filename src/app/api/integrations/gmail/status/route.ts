import {
  getAuthorizedGmailRequestUser,
  getGmailConnectionPublicStatus,
} from "@/features/integrations/gmail/service";
import { hasGmailModuleAccessForUser } from "@/features/integrations/gmail/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

export async function GET() {
  const user = await getAuthorizedGmailRequestUser();
  if (!user) {
    return Response.json(
      { message: "No tienes una sesión autorizada." },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  try {
    if (!(await hasGmailModuleAccessForUser(user.id, "gmail.mailbox.view"))) {
      return Response.json(
        { message: "No tienes permiso para utilizar esta bandeja." },
        { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    const status = await getGmailConnectionPublicStatus(user.id);
    return Response.json(status, {
      headers: PRIVATE_NO_STORE_HEADERS,
    });
  } catch {
    return Response.json(
      { message: "No fue posible consultar la conexión de Gmail." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
