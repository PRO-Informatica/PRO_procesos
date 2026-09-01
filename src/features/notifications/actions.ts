"use server";
import { revalidatePath } from "next/cache";
import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { createClient } from "@/lib/supabase/server";

async function authorize(projectId: string) { const profile = await requireActiveProfile(); const context = await getProjectContext(profile.id); return { profile, allowed: context.status === "ready" && context.projects.some((p) => p.id === projectId) }; }
export async function markNotificationRead(formData: FormData) { const projectId = String(formData.get("projectId") ?? ""); const key = String(formData.get("key") ?? "").trim().slice(0, 240); const { profile, allowed } = await authorize(projectId); if (!allowed || !key || key === "__ALL__") return; await (await createClient()).from("notification_reads").upsert({ project_id: projectId, user_id: profile.id, notification_key: key, read_at: new Date().toISOString() }); revalidatePath("/notifications"); revalidatePath("/"); }
export async function markAllNotificationsRead(formData: FormData) { const projectId = String(formData.get("projectId") ?? ""); const { profile, allowed } = await authorize(projectId); if (!allowed) return; await (await createClient()).from("notification_reads").upsert({ project_id: projectId, user_id: profile.id, notification_key: "__ALL__", read_at: new Date().toISOString() }); revalidatePath("/notifications"); revalidatePath("/"); }
