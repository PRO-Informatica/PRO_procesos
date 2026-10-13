import { NextResponse, type NextRequest } from "next/server";

import { buildTrustedUrl } from "@/features/auth/security";
import { getPublicEnvironment } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

async function handleSignOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const environment = getPublicEnvironment();
  const loginUrl = buildTrustedUrl(environment.appUrl, "/login");
  if (request.nextUrl.searchParams.get("reason") === "inactive") {
    loginUrl.searchParams.set("error", "access_denied");
  }

  return NextResponse.redirect(loginUrl);
}

export async function GET(request: NextRequest) {
  return handleSignOut(request);
}

export async function POST(request: NextRequest) {
  return handleSignOut(request);
}
