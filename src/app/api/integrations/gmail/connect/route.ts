import { NextResponse } from "next/server";

import { buildTrustedUrl } from "@/features/auth/security";
import { GMAIL_OAUTH_STATE_COOKIE } from "@/features/integrations/gmail/constants";
import {
  createGmailAuthorizationRequest,
  getAuthorizedGmailRequestUser,
  getGmailConnectionPublicStatus,
} from "@/features/integrations/gmail/service";
import { getGmailServerEnvironment } from "@/features/integrations/gmail/server-environment";

export const runtime = "nodejs";

export async function GET() {
  const environment = getGmailServerEnvironment();
  const user = await getAuthorizedGmailRequestUser();
  if (!user) {
    const loginUrl = buildTrustedUrl(environment.appUrl, "/login");
    loginUrl.searchParams.set("next", "/integrations/gmail");
    return NextResponse.redirect(loginUrl);
  }

  try {
    const connection = await getGmailConnectionPublicStatus(user.id);
    if (connection.connected) {
      return NextResponse.redirect(buildTrustedUrl(environment.appUrl, "/"));
    }
    const request = await createGmailAuthorizationRequest(user);
    const response = NextResponse.redirect(request.authorizationUrl);
    response.headers.set("Cache-Control", "private, no-store");
    response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, request.state, {
      httpOnly: true,
      sameSite: "lax",
      secure: environment.appEnvironment === "PROD",
      path: "/api/integrations/gmail/callback",
      maxAge: 10 * 60,
    });
    return response;
  } catch {
    const target = buildTrustedUrl(environment.appUrl, "/integrations/gmail");
    target.searchParams.set("result", "start_failed");
    return NextResponse.redirect(target);
  }
}
