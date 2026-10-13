import { NextResponse, type NextRequest } from "next/server";

import { buildTrustedUrl } from "@/features/auth/security";
import { GMAIL_OAUTH_STATE_COOKIE } from "@/features/integrations/gmail/constants";
import { secureStateEquals } from "@/features/integrations/gmail/crypto-core";
import {
  completeGmailAuthorization,
  consumeGmailOAuthState,
  getAuthorizedGmailRequestUser,
} from "@/features/integrations/gmail/service";
import { getGmailServerEnvironment } from "@/features/integrations/gmail/server-environment";

export const runtime = "nodejs";

type GmailCallbackResult =
  | "connected"
  | "cancelled"
  | "session_expired"
  | "state_invalid"
  | "identity_rejected"
  | "scopes_incomplete"
  | "refresh_token_required"
  | "connection_failed";

const SANITIZED_AUTHORIZATION_FAILURES = new Set([
  "GMAIL_TOKEN_EXCHANGE_FAILED",
  "GMAIL_ACCESS_TOKEN_MISSING",
  "GMAIL_ID_TOKEN_MISSING",
  "GMAIL_ID_TOKEN_VERIFICATION_FAILED",
  "GMAIL_TOKEN_INFO_FAILED",
  "GMAIL_CONNECTION_READ_FAILED",
  "GMAIL_TOKEN_ENCRYPTION_FAILED",
  "GMAIL_CONNECTION_STORE_FAILED",
]);

function reportSanitizedAuthorizationFailure(reason: string) {
  console.error("[gmail-oauth] authorization_failed", {
    reason: SANITIZED_AUTHORIZATION_FAILURES.has(reason)
      ? reason
      : "GMAIL_AUTHORIZATION_UNEXPECTED",
  });
}

function resultRedirect(result: GmailCallbackResult) {
  const environment = getGmailServerEnvironment();
  const target = buildTrustedUrl(environment.appUrl, "/integrations/gmail");
  target.searchParams.set("result", result);
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: environment.appEnvironment === "PROD",
    path: "/api/integrations/gmail/callback",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const user = await getAuthorizedGmailRequestUser();
  if (!user) return resultRedirect("session_expired");

  const returnedState = request.nextUrl.searchParams.get("state");
  const cookieState = request.cookies.get(GMAIL_OAUTH_STATE_COOKIE)?.value;
  if (
    !returnedState ||
    !cookieState ||
    !secureStateEquals(returnedState, cookieState)
  ) {
    return resultRedirect("state_invalid");
  }

  try {
    const consumed = await consumeGmailOAuthState(user.id, returnedState);
    if (!consumed) return resultRedirect("state_invalid");
  } catch {
    return resultRedirect("connection_failed");
  }

  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) {
    return resultRedirect(
      providerError === "access_denied" ? "cancelled" : "connection_failed",
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return resultRedirect("connection_failed");

  try {
    await completeGmailAuthorization({ user, code });
    return resultRedirect("connected");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (
      [
        "IDENTITY_MISSING",
        "EMAIL_UNVERIFIED",
        "HOSTED_DOMAIN_NOT_ALLOWED",
        "DOMAIN_NOT_ALLOWED",
        "EMAIL_MISMATCH",
        "GOOGLE_ACCOUNT_MISMATCH",
      ]
        .includes(reason)
    ) {
      return resultRedirect("identity_rejected");
    }
    if (reason === "GMAIL_SCOPES_INCOMPLETE") {
      return resultRedirect("scopes_incomplete");
    }
    if (reason === "GMAIL_REFRESH_TOKEN_REQUIRED") {
      return resultRedirect("refresh_token_required");
    }
    reportSanitizedAuthorizationFailure(reason);
    return resultRedirect("connection_failed");
  }
}
