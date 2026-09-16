import {
  disconnectGmail,
  getAuthorizedGmailRequestUser,
} from "@/features/integrations/gmail/service";
import { hasValidSameOrigin } from "@/lib/http/same-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasValidSameOrigin(request)) {
    return Response.json({ message: "Solicitud no válida." }, { status: 403 });
  }
  const user = await getAuthorizedGmailRequestUser();
  if (!user) {
    return Response.json({ message: "No tienes una sesión autorizada." }, { status: 401 });
  }
  try {
    return Response.json(await disconnectGmail(user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { message: "No fue posible desconectar Gmail." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
