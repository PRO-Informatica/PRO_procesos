import "server-only";

import { createClient } from "@/lib/supabase/server";

type PlatformAdminRow = {
  user_id: string;
};

/**
 * Resolves platform access independently from project roles and permissions.
 * RLS only exposes the authenticated user's own platform_admins row.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle<PlatformAdminRow>();

  if (error) {
    throw new Error("No fue posible verificar el acceso de plataforma.");
  }

  return data?.user_id === userId;
}
