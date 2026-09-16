import { NextResponse, type NextRequest } from "next/server";

import { validateApplicationAccess } from "@/features/auth/application-access";
import {
  buildTrustedUrl,
  hasExactCorporateDomain,
  normalizeEmail,
  safeInternalPath,
  type AuthErrorCode,
} from "@/features/auth/security";
import { getPublicEnvironment } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

function loginRedirect(appUrl: string, error: AuthErrorCode, next: string) {
  const target = buildTrustedUrl(appUrl, "/login");
  target.searchParams.set("error", error);
  if (next !== "/") target.searchParams.set("next", next);
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  const environment = getPublicEnvironment();
  const next = safeInternalPath(request.nextUrl.searchParams.get("next"));
  const providerError = request.nextUrl.searchParams.get("error");

  if (providerError) {
    return loginRedirect(
      environment.appUrl,
      providerError === "access_denied" ? "oauth_cancelled" : "oauth_failed",
      next,
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return loginRedirect(environment.appUrl, "oauth_failed", next);
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    await supabase.auth.signOut();
    return loginRedirect(environment.appUrl, "oauth_failed", next);
  }

  const { data, error: userError } = await supabase.auth.getUser();
  const user = data.user;
  if (userError || !user) {
    await supabase.auth.signOut();
    return loginRedirect(environment.appUrl, "oauth_failed", next);
  }

  if (!user.email_confirmed_at) {
    await supabase.auth.signOut();
    return loginRedirect(environment.appUrl, "email_unverified", next);
  }

  const normalizedEmail = normalizeEmail(user.email);
  if (!hasExactCorporateDomain(normalizedEmail)) {
    await supabase.auth.signOut();
    return loginRedirect(environment.appUrl, "domain_not_allowed", next);
  }

  const access = await validateApplicationAccess(user.id);
  if (!access.authorized) {
    await supabase.auth.signOut();
    return loginRedirect(environment.appUrl, "access_denied", next);
  }

  return NextResponse.redirect(buildTrustedUrl(environment.appUrl, next));
}
