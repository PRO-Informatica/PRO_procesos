"use server";

import { revalidatePath } from "next/cache";

import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type {
  DispatchMutationState,
  IncidentMutationState,
  UploadActionResult,
} from "./types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESULTS = ["DISPATCHED", "NOT_DISPATCHED"];
const RESPONSIBILITIES = ["SUPPLIER", "PROJECT", "SHARED", "UNDETERMINED"];
const CHARGES = ["YES", "NO", "UNDETERMINED"];

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
  ) {
    return null;
  }
  return { profile, context };
}

function localToIso(value: string, timezone: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const desired = Date.UTC(+year, +month - 1, +day, +hour, +minute);
  let guess = desired;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZone: timezone,
      }).formatToParts(new Date(guess));
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((candidate) => candidate.type === type)?.value);
      const represented = Date.UTC(
        part("year"),
        part("month") - 1,
        part("day"),
        part("hour"),
        part("minute"),
        part("second"),
      );
      guess += desired - represented;
    }
    return new Date(guess).toISOString();
  } catch {
    return null;
  }
}

function dispatchError(message: string) {
  const value = message.toUpperCase();
  if (value.includes("DISPATCH_VERSION_CONFLICT"))
    return "El despacho cambió. Recarga la página antes de continuar.";
  if (value.includes("PROGRAMMING_DISPATCH_ALREADY_EXISTS"))
    return "Esta programación ya tiene un despacho.";
  if (value.includes("DISPATCH_PROGRAMMING_INVALID_STATE"))
    return "La programación debe estar confirmada o en ejecución.";
  if (value.includes("DISPATCH_COMPLETED_NOT_EDITABLE"))
    return "El despacho está completado y ya no admite cambios.";
  if (value.includes("DISPATCH_GUIDE_NUMBER_ALREADY_EXISTS"))
    return "Ya existe una guía con ese número en este despacho.";
  if (value.includes("DISPATCH_GUIDE_BATCH_LOCKED"))
    return "La guía ya está relacionada con un lote y no puede editarse.";
  if (value.includes("DISPATCH_GUIDE_HAS_EVIDENCE"))
    return "Quita primero la evidencia vinculada a esta guía.";
  if (value.includes("DISPATCH_PROGRAMMING_UNIT_MISMATCH"))
    return "La unidad debe coincidir con la programación.";
  if (value.includes("NOT_DISPATCHED_INCIDENT_REQUIRED"))
    return "Un despacho no realizado debe tener al menos una incidencia.";
  if (value.includes("DISPATCH_RESULT_REQUIRED"))
    return "Selecciona el resultado de la operación.";
  if (value.includes("DISPATCH_DEPARTURE_REQUIRED"))
    return "Registra la hora de salida.";
  if (value.includes("DISPATCH_ORDER_NUMBER_REQUIRED"))
    return "Ingresa el número de pedido.";
  if (value.includes("DISPATCH_REAL_VOLUME_REQUIRED"))
    return "Ingresa un Volumen Real mayor que cero.";
  if (value.includes("DISPATCH_GUIDE_REQUIRED"))
    return "Agrega al menos una guía antes de finalizar.";
  if (value.includes("DISPATCH_GUIDE_INCOMPLETE"))
    return "Todas las guías deben tener número y al menos un producto válido.";
  if (value.includes("PERMISSION_DENIED")) return "No tienes permiso para realizar esta acción.";
  return "No fue posible completar la operación. Revisa los datos e intenta nuevamente.";
}

function validId(value: string) {
  return UUID.test(value);
}

function version(formData: FormData) {
  const value = Number(text(formData, "expectedVersion"));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function revalidateDispatch(dispatchId?: string, programmingId?: string) {
  revalidatePath("/dispatches");
  if (dispatchId) revalidatePath(`/dispatches/${dispatchId}`);
  if (programmingId) revalidatePath(`/programming/${programmingId}`);
}

export async function startDispatchAction(
  _state: DispatchMutationState,
  formData: FormData,
): Promise<DispatchMutationState> {
  const projectId = text(formData, "projectId");
  const programmingId = text(formData, "programmingId");
  if (!validId(projectId) || !validId(programmingId))
    return { status: "error", message: "Selecciona una programación válida." };
  const auth = await authorize(projectId, "dispatch.create");
  if (!auth) return { status: "error", message: "No tienes permiso para iniciar despachos." };
  const timezone = auth.context.activeProject?.timezone || "America/Guatemala";
  const arrivalAt = localToIso(text(formData, "arrivalAt"), timezone);
  if (!arrivalAt) return { status: "error", message: "Ingresa una hora de llegada válida." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_dispatch", {
    p_programming_id: programmingId,
    p_arrival_at: arrivalAt,
    p_received_by_name: text(formData, "receivedByName"),
  });
  if (error) return { status: "error", message: dispatchError(error.message) };
  const dispatchId = String(data);
  revalidateDispatch(dispatchId, programmingId);
  return {
    status: "success",
    dispatchId,
    message: "Despacho iniciado. Puedes registrar las guías progresivamente.",
  };
}

export async function saveDispatchAction(
  _state: DispatchMutationState,
  formData: FormData,
): Promise<DispatchMutationState> {
  const projectId = text(formData, "projectId");
  const dispatchId = text(formData, "dispatchId");
  const programmingId = text(formData, "programmingId");
  const expectedVersion = version(formData);
  if (!validId(projectId) || !validId(dispatchId) || expectedVersion === null)
    return { status: "error", message: "Recarga el despacho antes de guardar." };
  const auth = await authorize(projectId, "dispatch.modify");
  if (!auth) return { status: "error", message: "No tienes permiso para editar el despacho." };
  const timezone = auth.context.activeProject?.timezone || "America/Guatemala";
  const arrivalAt = localToIso(text(formData, "arrivalAt"), timezone);
  const departureValue = text(formData, "departureAt");
  const departureAt = departureValue ? localToIso(departureValue, timezone) : null;
  const result = text(formData, "result");
  if (!arrivalAt || (departureValue && !departureAt))
    return { status: "error", message: "Revisa las horas de llegada y salida." };
  if (result && !RESULTS.includes(result))
    return { status: "error", message: "Selecciona un resultado válido." };
  const rawVolume = text(formData, "realVolume");
  const realVolume = rawVolume === "" ? null : Number(rawVolume);
  if (realVolume !== null && (!Number.isFinite(realVolume) || realVolume < 0))
    return { status: "error", message: "Ingresa un Volumen Real válido." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_dispatch", {
    p_dispatch_id: dispatchId,
    p_expected_version: expectedVersion,
    p_arrival_at: arrivalAt,
    p_departure_at: departureAt,
    p_received_by_name: text(formData, "receivedByName"),
    p_result: result || null,
    p_order_number: text(formData, "orderNumber") || null,
    p_real_volume: result === "NOT_DISPATCHED" ? 0 : realVolume,
    p_real_unit_code: text(formData, "realUnitCode") || null,
  });
  if (error) return { status: "error", message: dispatchError(error.message) };
  revalidateDispatch(dispatchId, programmingId);
  return {
    status: "success",
    newVersion: Number(data),
    message: "Cambios guardados. El despacho continúa en ejecución.",
  };
}

function guideLines(formData: FormData) {
  const quantities = formData.getAll("lineQuantity").map(Number);
  const units = formData.getAll("lineUnitCode").map(String);
  const codes = formData.getAll("lineProductCode").map((value) => String(value).trim());
  const descriptions = formData
    .getAll("lineProductDescription")
    .map((value) => String(value).trim());
  return quantities.map((quantity, index) => ({
    quantity,
    unit_code: units[index]?.trim(),
    product_code: codes[index],
    product_description: descriptions[index],
  }));
}

export async function saveDispatchGuideAction(
  _state: DispatchMutationState,
  formData: FormData,
): Promise<DispatchMutationState> {
  const projectId = text(formData, "projectId");
  const dispatchId = text(formData, "dispatchId");
  const guideId = text(formData, "guideId");
  const guideNumber = text(formData, "guideNumber");
  const expectedVersion = version(formData);
  const lines = guideLines(formData);
  if (!validId(projectId) || !validId(dispatchId) || expectedVersion === null)
    return { status: "error", message: "Recarga el despacho antes de guardar la guía." };
  if (!guideNumber)
    return { status: "error", message: "Ingresa el número de guía." };
  if (
    !lines.length ||
    lines.some(
      (line) =>
        !Number.isFinite(line.quantity) ||
        line.quantity <= 0 ||
        !line.unit_code ||
        !line.product_code ||
        !line.product_description,
    )
  ) return { status: "error", message: "Cada producto necesita cantidad, UM, código y descripción." };
  if (!(await authorize(projectId, "dispatch.modify")))
    return { status: "error", message: "No tienes permiso para guardar guías." };
  const supabase = await createClient();
  const params = {
    p_expected_version: expectedVersion,
    p_guide_number: guideNumber,
    p_guide_date: text(formData, "guideDate"),
    p_lines: lines,
  };
  const response = guideId
    ? await supabase.rpc("update_dispatch_guide_with_lines", {
        ...params,
        p_guide_id: guideId,
      })
    : await supabase.rpc("create_dispatch_guide_with_lines", {
        ...params,
        p_dispatch_id: dispatchId,
      });
  if (response.error)
    return { status: "error", message: dispatchError(response.error.message) };
  const data = response.data as { guide_id?: string; dispatch_version?: number } | number;
  const newVersion = typeof data === "number" ? data : Number(data.dispatch_version);
  const savedGuideId = typeof data === "number" ? guideId : data.guide_id;
  revalidateDispatch(dispatchId, text(formData, "programmingId"));
  return {
    status: "success",
    guideId: savedGuideId,
    newVersion,
    message: guideId ? "Guía actualizada." : "Guía agregada al despacho.",
  };
}

export async function deleteDispatchGuideAction(
  _state: DispatchMutationState,
  formData: FormData,
): Promise<DispatchMutationState> {
  const projectId = text(formData, "projectId");
  const dispatchId = text(formData, "dispatchId");
  const guideId = text(formData, "guideId");
  const expectedVersion = version(formData);
  if (![projectId, dispatchId, guideId].every(validId) || expectedVersion === null)
    return { status: "error", message: "Recarga el despacho antes de eliminar la guía." };
  if (!(await authorize(projectId, "dispatch.modify")))
    return { status: "error", message: "No tienes permiso para eliminar guías." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_dispatch_guide", {
    p_guide_id: guideId,
    p_expected_version: expectedVersion,
  });
  if (error) return { status: "error", message: dispatchError(error.message) };
  revalidateDispatch(dispatchId, text(formData, "programmingId"));
  return { status: "success", newVersion: Number(data), message: "Guía eliminada." };
}

export async function completeDispatchAction(
  _state: DispatchMutationState,
  formData: FormData,
): Promise<DispatchMutationState> {
  const projectId = text(formData, "projectId");
  const dispatchId = text(formData, "dispatchId");
  const expectedVersion = version(formData);
  if (!validId(projectId) || !validId(dispatchId) || expectedVersion === null)
    return { status: "error", message: "Recarga el despacho antes de finalizar." };
  if (!(await authorize(projectId, "dispatch.modify")))
    return { status: "error", message: "No tienes permiso para finalizar el despacho." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_dispatch", {
    p_dispatch_id: dispatchId,
    p_expected_version: expectedVersion,
  });
  if (error) return { status: "error", message: dispatchError(error.message) };
  revalidateDispatch(dispatchId, text(formData, "programmingId"));
  return { status: "success", newVersion: Number(data), message: "Despacho completado." };
}

export async function registerIncidentAction(
  _state: IncidentMutationState,
  formData: FormData,
): Promise<IncidentMutationState> {
  const projectId = text(formData, "projectId");
  const dispatchId = text(formData, "dispatchId");
  const typeId = text(formData, "incidentTypeId");
  const responsibility = text(formData, "responsibility");
  const charge = text(formData, "chargeApplicability");
  if (
    !validId(projectId) ||
    !validId(dispatchId) ||
    !validId(typeId) ||
    !RESPONSIBILITIES.includes(responsibility) ||
    !CHARGES.includes(charge)
  ) return { status: "error", message: "Completa los datos requeridos de la incidencia." };
  if (!(await authorize(projectId, "dispatch.register_incident")))
    return { status: "error", message: "No tienes permiso para registrar incidencias." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_dispatch_incident", {
    p_dispatch_id: dispatchId,
    p_incident_type_id: typeId,
    p_responsibility: responsibility,
    p_charge_applicability: charge,
    p_notes: text(formData, "notes") || null,
  });
  if (error) return { status: "error", message: dispatchError(error.message) };
  revalidateDispatch(dispatchId);
  return { status: "success", incidentId: String(data), message: "Incidencia registrada." };
}

type PrepareUploadInput = {
  projectId: string;
  contextId: string;
  context: "dispatch" | "guide" | "incident";
  fileName: string;
  mimeType: string;
  fileSize: number;
  documentId?: string;
};

export async function prepareDispatchUpload(
  input: PrepareUploadInput,
): Promise<UploadActionResult> {
  const permission = input.context === "incident" ? "dispatch.register_incident" : "dispatch.modify";
  if (
    !validId(input.projectId) ||
    !validId(input.contextId) ||
    !(await authorize(input.projectId, permission))
  ) return { status: "error", message: "No tienes permiso para adjuntar este documento." };
  const supabase = await createClient();
  const rpc = input.context === "dispatch"
    ? "prepare_dispatch_document_upload"
    : input.context === "guide"
      ? "prepare_guide_document_upload"
      : "prepare_incident_document_upload";
  const idKey = input.context === "dispatch"
    ? "p_dispatch_id"
    : input.context === "guide"
      ? "p_guide_id"
      : "p_incident_id";
  const purpose = input.context === "dispatch"
    ? "DISPATCH_EVIDENCE"
    : input.context === "guide"
      ? "DISPATCH_GUIDE"
      : "INCIDENT_EVIDENCE";
  const { data, error } = await supabase.rpc(rpc, {
    [idKey]: input.contextId,
    p_file_name: input.fileName,
    p_mime_type: input.mimeType,
    p_file_size: input.fileSize,
    p_purpose: purpose,
    p_document_id: input.documentId || null,
  });
  if (error || !data?.[0])
    return { status: "error", message: dispatchError(error?.message ?? "DOCUMENT_PREPARE_FAILED") };
  const prepared = data[0];
  const signed = await createAdminClient()
    .storage.from(prepared.storage_bucket)
    .createSignedUploadUrl(prepared.storage_path, { upsert: false });
  if (signed.error || !signed.data?.token) {
    await supabase.rpc("fail_document_upload", {
      p_document_id: prepared.document_id,
      p_version_id: prepared.version_id,
      p_reason: "No fue posible crear la URL firmada.",
    });
    return { status: "error", message: "No fue posible preparar la carga segura." };
  }
  return {
    status: "success",
    upload: {
      documentId: prepared.document_id,
      versionId: prepared.version_id,
      versionNumber: prepared.version_number,
      bucket: prepared.storage_bucket,
      path: prepared.storage_path,
      token: signed.data.token,
      expiresAt: prepared.upload_expires_at,
    },
  };
}

export async function finalizeDispatchUpload(
  projectId: string,
  documentId: string,
  versionId: string,
) {
  if (![projectId, documentId, versionId].every(validId))
    return { status: "error" as const, message: "Carga inválida." };
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status !== "ready" || context.activeProject?.id !== projectId)
    return { status: "error" as const, message: "Proyecto inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finalize_document_upload", {
    p_document_id: documentId,
    p_version_id: versionId,
  });
  if (error) return { status: "error" as const, message: dispatchError(error.message) };
  revalidatePath("/dispatches");
  return { status: "success" as const };
}

export async function failDispatchUpload(
  projectId: string,
  documentId: string,
  versionId: string,
  reason: string,
) {
  if (![projectId, documentId, versionId].every(validId)) return;
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status !== "ready" || context.activeProject?.id !== projectId) return;
  await (await createClient()).rpc("fail_document_upload", {
    p_document_id: documentId,
    p_version_id: versionId,
    p_reason: reason.slice(0, 500),
  });
}

export async function removeDispatchEvidenceAction(projectId: string, documentId: string) {
  if (!validId(projectId) || !validId(documentId) || !(await authorize(projectId, "dispatch.modify")))
    return { status: "error" as const, message: "No tienes permiso para eliminar la evidencia." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_dispatch_evidence", {
    p_document_id: documentId,
  });
  if (error) return { status: "error" as const, message: dispatchError(error.message) };
  const objects = Array.isArray(data?.storage_objects) ? data.storage_objects : [];
  const byBucket = new Map<string, string[]>();
  for (const object of objects) {
    if (!object?.bucket || !object?.path) continue;
    const paths = byBucket.get(object.bucket) ?? [];
    paths.push(object.path);
    byBucket.set(object.bucket, paths);
  }
  const admin = createAdminClient();
  for (const [bucket, paths] of byBucket) await admin.storage.from(bucket).remove(paths);
  revalidatePath("/dispatches");
  return { status: "success" as const };
}

export async function getDocumentDownloadUrl(projectId: string, documentId: string) {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (
    context.status !== "ready" ||
    context.activeProject?.id !== projectId ||
    (!context.permissions.includes("dispatch.view") && !context.permissions.includes("document.view"))
  ) return { status: "error" as const, message: "No tienes acceso a este documento." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_versions")
    .select("storage_bucket, storage_path")
    .eq("document_id", documentId)
    .eq("upload_status", "UPLOADED")
    .eq("is_current", true)
    .maybeSingle();
  if (error || !data) return { status: "error" as const, message: "No hay una versión disponible." };
  const signed = await createAdminClient()
    .storage.from(data.storage_bucket)
    .createSignedUrl(data.storage_path, 300);
  if (signed.error || !signed.data)
    return { status: "error" as const, message: "No fue posible crear el enlace seguro." };
  return { status: "success" as const, url: signed.data.signedUrl };
}
