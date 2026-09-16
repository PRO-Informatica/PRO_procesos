import "server-only";

import { isPlatformAdmin } from "@/features/platform/queries";
import { getOperationalProjectAccess } from "@/features/projects/queries";
import { createClient } from "@/lib/supabase/server";

import { hasAuthorizedApplicationAccess } from "./security";

type ProfileAccessRow = {
  active: boolean;
};

export async function validateApplicationAccess(userId: string) {
  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("active")
    .eq("id", userId)
    .maybeSingle<ProfileAccessRow>();

  if (profileError || !profile) {
    return { authorized: false, reason: "PROFILE_MISSING" as const };
  }
  if (!profile.active) {
    return { authorized: false, reason: "PROFILE_INACTIVE" as const };
  }

  try {
    const [platformAdmin, projectScopes] = await Promise.all([
      isPlatformAdmin(userId),
      getOperationalProjectAccess(userId),
    ]);
    const authorized = hasAuthorizedApplicationAccess({
      profileActive: profile.active,
      isPlatformAdmin: platformAdmin,
      projectScopes,
    });

    return {
      authorized,
      reason: authorized ? ("AUTHORIZED" as const) : ("MEMBERSHIP_REQUIRED" as const),
    };
  } catch {
    return { authorized: false, reason: "ACCESS_CHECK_FAILED" as const };
  }
}
