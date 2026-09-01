"use server";

import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function getGlobalDocumentUrl(projectId: string, documentId: string) {
  if (!UUID.test(projectId) || !UUID.test(documentId)) return { status: "error" as const, message: "Documento inválido." };
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  const project = context.projects.find((item) => item.id === projectId);
  const permitted = context.status === "ready" && project && (context.permissions.includes("document.view") || context.permissions.includes("dispatch.view") || context.permissions.includes("invoice.view"));
  if (!permitted) return { status: "error" as const, message: "No tienes acceso a este documento." };
  const { data, error } = await (await createClient()).from("document_versions").select("storage_bucket, storage_path").eq("document_id", documentId).eq("upload_status", "UPLOADED").eq("is_current", true).maybeSingle();
  if (error || !data) return { status: "error" as const, message: "No hay una versión disponible." };
  const signed = await createAdminClient().storage.from(data.storage_bucket).createSignedUrl(data.storage_path, 300);
  return signed.error || !signed.data ? { status: "error" as const, message: "No fue posible preparar el enlace privado." } : { status: "success" as const, url: signed.data.signedUrl };
}
