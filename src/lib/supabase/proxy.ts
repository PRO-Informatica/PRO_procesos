import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getPublicEnvironment } from "@/lib/env";

const guestRoutes = ["/login", "/forgot-password"];
const authUtilityRoutes = ["/auth/confirm", "/auth/signout", "/reset-password"];

function copyCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const environment = getPublicEnvironment();

  const supabase = createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // Validates and refreshes expired auth tokens. Authorization remains in RLS.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  const pathname = request.nextUrl.pathname;
  const isGuestRoute = guestRoutes.some((route) => pathname.startsWith(route));
  const isAuthUtilityRoute = authUtilityRoutes.some((route) =>
    pathname.startsWith(route),
  );

  if (!claims && !isGuestRoute && !isAuthUtilityRoute) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return copyCookies(response, NextResponse.redirect(loginUrl));
  }

  if (claims && isGuestRoute) {
    return copyCookies(
      response,
      NextResponse.redirect(new URL("/", request.url)),
    );
  }

  return response;
}
