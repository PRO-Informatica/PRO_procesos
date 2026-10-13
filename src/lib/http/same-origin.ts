import "server-only";

import { getPublicEnvironment } from "@/lib/env";

export function hasValidSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === getPublicEnvironment().appUrl;
  } catch {
    return false;
  }
}
