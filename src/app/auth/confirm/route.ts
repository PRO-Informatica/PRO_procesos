import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { buildTrustedUrl, safeInternalPath } from "@/features/auth/security";
import { getPublicEnvironment } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const environment = getPublicEnvironment();
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const next = safeInternalPath(request.nextUrl.searchParams.get("next"));
  const supabase = await createClient();

  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("Missing authentication parameters") };

  if (result.error) {
    const loginUrl = buildTrustedUrl(environment.appUrl, "/login");
    loginUrl.searchParams.set("error", "auth_link_invalid");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(buildTrustedUrl(environment.appUrl, next));
}
