"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { ACTIVE_PROJECT_COOKIE, canAccessOperationalProject } from "./queries";
import type { SwitchProjectState } from "./types";

export async function switchProject(
  _previousState: SwitchProjectState,
  formData: FormData,
): Promise<SwitchProjectState> {
  const projectId = formData.get("projectId");
  const returnTo = formData.get("returnTo");

  if (typeof projectId !== "string" || !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return { status: "error", message: "El proyecto seleccionado no es válido." };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    return { status: "error", message: "Tu sesión expiró. Ingresa nuevamente." };
  }

  const hasOperationalAccess = await canAccessOperationalProject(
    claimsData.claims.sub,
    projectId,
  );

  // Global platform visibility never makes a project operational.
  if (!hasOperationalAccess) {
    return {
      status: "error",
      message: "No tienes acceso al proyecto seleccionado.",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_PROJECT_COOKIE, projectId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  const universalBatchReturn = typeof returnTo === "string" &&
      (returnTo === "/batches/universal" ||
        /^\/batches\/universal\?project=[0-9a-f-]{36}&batch=[0-9a-f-]{36}$/i.test(returnTo))
    ? returnTo
    : null;
  const dispatchDetailReturn = typeof returnTo === "string" &&
      /^\/dispatches\/[0-9a-f-]{36}$/i.test(returnTo)
    ? returnTo
    : null;
  const programmingDetailReturn = typeof returnTo === "string" &&
      /^\/programming\/[0-9a-f-]{36}$/i.test(returnTo)
    ? returnTo
    : null;
  const moduleRoot =
    typeof returnTo === "string"
      ? ["programming", "dispatches", "batches", "invoices", "reconciliation", "reports"].find(
          (segment) =>
            returnTo === `/${segment}` || returnTo.startsWith(`/${segment}/`),
        )
      : null;
  const safeReturnTo = universalBatchReturn ?? dispatchDetailReturn ?? programmingDetailReturn ?? (moduleRoot ? `/${moduleRoot}` : "/");
  redirect(safeReturnTo);
}
