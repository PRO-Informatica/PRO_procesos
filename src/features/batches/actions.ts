"use server";

import { revalidatePath } from "next/cache";

import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { BatchMutationState } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function authorize(projectId: string, permission: string) {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (
    context.status !== "ready" ||
    context.activeProject?.id !== projectId ||
    !context.permissions.includes(permission)
  ) return null;
  return context;
}

function batchError(message: string) {
  const value = message.toUpperCase();
  if (value.includes("BATCH_WEEK_ALREADY_EXISTS") || value.includes("BATCH_WEEK_OR_CODE_ALREADY_EXISTS")) return "Ya existe un lote para esa semana o código.";
  if (value.includes("BATCH_PERIOD_MUST_BE_MONDAY_TO_SUNDAY")) return "La semana debe iniciar lunes y finalizar domingo.";
  if (value.includes("BATCH_GUIDE_DATE_OUTSIDE_WEEK")) return "La fecha de la guía no pertenece a la semana del lote.";
  if (value.includes("BATCH_GUIDE_DISPATCH_NOT_REGISTERED")) return "La guía ya no pertenece a un despacho registrado elegible.";
  if (value.includes("GUIDE_ALREADY_IN_ACTIVE_BATCH")) return "La guía ya tiene una relación activa con otro lote.";
  if (value.includes("BATCH_NOT_EDITABLE")) return "El lote ya no permite cambios manuales.";
  if (value.includes("BATCH_GUIDE_REMOVAL_REASON_INVALID")) return "Indica un motivo válido para remover la guía.";
  if (value.includes("WEEKLY_BATCH_ROLLOVER_STATE_INVALID")) return "Solo un lote en preparación puede cerrar su semana.";
  if (value.includes("PERMISSION_DENIED")) return "No tienes permiso para realizar esta operación.";
  return "No fue posible completar la operación del lote.";
}

function refresh(batchId?: string) {
  revalidatePath("/batches");
  if (batchId) revalidatePath(`/batches/${batchId}`);
  revalidatePath("/dispatches");
}

export async function createBatchAction(
  _state: BatchMutationState,
  formData: FormData,
): Promise<BatchMutationState> {
  const projectId = text(formData, "projectId");
  const code = text(formData, "code");
  const periodStart = text(formData, "periodStart");
  const periodEnd = text(formData, "periodEnd");
  if (!UUID.test(projectId) || !code || !periodStart || !periodEnd) {
    return { status: "error", message: "Completa el código y la semana del lote." };
  }
  if (!await authorize(projectId, "batch.create")) {
    return { status: "error", message: "No tienes permiso para crear lotes." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_batch", {
    p_project_id: projectId,
    p_code: code,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (error) return { status: "error", message: batchError(error.message) };
  const batchId = String(data);
  refresh(batchId);
  return { status: "success", batchId, message: "Lote semanal creado correctamente." };
}

export async function addGuideToBatchAction(
  _state: BatchMutationState,
  formData: FormData,
): Promise<BatchMutationState> {
  const projectId = text(formData, "projectId");
  const batchId = text(formData, "batchId");
  const guideId = text(formData, "guideId");
  if (![projectId, batchId, guideId].every((value) => UUID.test(value))) {
    return { status: "error", message: "Selecciona una guía válida." };
  }
  if (!await authorize(projectId, "batch.add_guide")) {
    return { status: "error", message: "No tienes permiso para agregar guías." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_guide_to_batch", {
    p_batch_id: batchId,
    p_guide_id: guideId,
  });
  if (error) return { status: "error", message: batchError(error.message) };
  refresh(batchId);
  return { status: "success", batchId, message: "Guía agregada al lote." };
}

export async function removeGuideFromBatchAction(
  _state: BatchMutationState,
  formData: FormData,
): Promise<BatchMutationState> {
  const projectId = text(formData, "projectId");
  const batchId = text(formData, "batchId");
  const guideId = text(formData, "guideId");
  const reason = text(formData, "reason");
  if (![projectId, batchId, guideId].every((value) => UUID.test(value)) || !reason) {
    return { status: "error", message: "Indica un motivo para remover la guía." };
  }
  if (!await authorize(projectId, "batch.modify")) {
    return { status: "error", message: "No tienes permiso para modificar el lote." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_guide_from_batch", {
    p_batch_id: batchId,
    p_guide_id: guideId,
    p_reason: reason,
  });
  if (error) return { status: "error", message: batchError(error.message) };
  refresh(batchId);
  return { status: "success", batchId, message: "Guía removida; el historial se conservó." };
}

export async function rolloverBatchAction(
  _state: BatchMutationState,
  formData: FormData,
): Promise<BatchMutationState> {
  const projectId = text(formData, "projectId");
  const batchId = text(formData, "batchId");
  if (!UUID.test(projectId) || !UUID.test(batchId)) {
    return { status: "error", message: "El lote no es válido." };
  }
  if (!await authorize(projectId, "batch.modify")) {
    return { status: "error", message: "No tienes permiso para cerrar la semana." };
  }
  const userClient = await createClient();
  const { data: batch } = await userClient
    .from("batches")
    .select("id, project_id, status")
    .eq("id", batchId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!batch || batch.status !== "ASSEMBLING") {
    return { status: "error", message: "El lote ya no está disponible para rollover." };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("rollover_weekly_batch", {
    p_batch_id: batchId,
  });
  if (error) return { status: "error", message: batchError(error.message) };
  const nextBatchId = String(data);
  refresh(batchId);
  revalidatePath(`/batches/${nextBatchId}`);
  return {
    status: "success",
    batchId: nextBatchId,
    message: "Semana preparada. El lote origen quedó listo para revisión.",
  };
}
