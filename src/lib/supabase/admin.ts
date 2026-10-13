import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPrivilegedEnvironment } from "@/lib/supabase/server-environment";

export function createAdminClient() {
  const environment = getPrivilegedEnvironment();

  return createClient(environment.supabaseUrl, environment.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
