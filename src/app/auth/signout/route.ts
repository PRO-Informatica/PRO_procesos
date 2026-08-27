import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const loginUrl = new URL("/login", request.url);
  if (request.nextUrl.searchParams.get("reason") === "inactive") {
    loginUrl.searchParams.set(
      "error",
      "Tu usuario no tiene acceso activo. Comunícate con el administrador de tu empresa.",
    );
  }

  return NextResponse.redirect(loginUrl);
}
