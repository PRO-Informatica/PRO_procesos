import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import type { SessionProfile } from "./types";

type ProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  active: boolean;
};

export async function requireActiveProfile(): Promise<SessionProfile> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (!claims?.sub) {
    redirect("/login");
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, active")
    .eq("id", claims.sub)
    .maybeSingle<ProfileRow>();

  if (error || !data?.active) {
    redirect("/auth/signout?reason=inactive");
  }

  const email = typeof claims.email === "string" ? claims.email : "";

  return {
    id: data.id,
    fullName: data.full_name?.trim() || email.split("@")[0] || "Usuario",
    avatarUrl: data.avatar_url,
    email,
  };
}
