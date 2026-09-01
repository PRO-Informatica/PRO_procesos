"use server";

import { revalidatePath } from "next/cache";

import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type {
  CorrectionMutationState,
  DispatchMutationState,
  IncidentMutationState,
  UploadActionResult,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESULTS = ["COMPLETE", "PARTIAL", "RETURNED", "REJECTED", "NOT_DISPATCHED", "CANCELLED"];
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
  ) return null;
  return { profile, context };
}

function localToIso(value: string, timezone: string) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, m, d, h, minute] = match;
  const desired = Date.UTC(+y, +m - 1, +d, +h, +minute);
  let guess = desired;
  try {
    for (let i = 0; i < 3; i += 1) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hourCycle: "h23", timeZone: timezone,
      }).formatToParts(new Date(guess));
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((candidate) => candidate.type === type)?.value);
      const represented = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
      guess += desired - represented;
    }
    return new Date(guess).toISOString();
  } catch {
    return null;
  }
}

function dispatchError(message: string) {
  const value = message.toUpperCase();
  if (value.includes("PERMISSION_DENIED")) return "No tienes permiso para registrar despachos.";
  if (value.includes("DISPATCH_PROGRAMMING_INVALID_STATE")) return "La programación debe estar confirmada o en ejecución.";
  if (value.includes("DISPATCH_SUPPLIER_INACTIVE")) return "El proveedor de la programación está inactivo.";
  if (value.includes("DISPATCH_SUPPLIER_NOT_LINKED")) return "El proveedor ya no está vinculado al proyecto.";
  if (value.includes("DISPATCH_TEMPLATE_AMBIGUOUS")) return "Hay más de una plantilla publicada aplicable. Un administrador debe dejar una única plantilla de guía vigente.";
  if (value.includes("DISPATCH_TEMPLATE_INVALID")) return "No existe una plantilla publicada de guía aplicable a este proveedor.";
  if (value.includes("DISPATCH_MIXED_UNITS_NOT_SUPPORTED")) return "Todos los productos deben usar la misma unidad de medida.";
  if (value.includes("DISPATCH_RESULT_QUANTITY_MISMATCH")) return "Las cantidades físicas no corresponden al resultado seleccionado.";
  if (value.includes("INVALID_OR_INACTIVE_UNIT_OF_MEASURE")) return "Una unidad de medida ya no está disponible.";
  if (value.includes("DISPATCH_INVALID_TIME_SEQUENCE")) return "Las horas deben cumplir carga ≤ llegada ≤ salida.";
  if (value.includes("GUIDE_NUMBER_REQUIRED")) return "Ingresa el número de guía.";
  return "No fue posible registrar el despacho. Revisa los datos e intenta nuevamente.";
}

function correctionError(message: string): Pick<CorrectionMutationState, "message" | "conflict"> {
  const value = message.toUpperCase();
  if (value.includes("DISPATCH_VERSION_CONFLICT")) return {
    conflict: true,
    message: "Este despacho cambió desde que abriste la pantalla. Recarga los datos antes de intentar otra corrección.",
  };
  if (value.includes("DISPATCH_GUIDE_INVOICE_LOCKED")) return { message: "La guía está vinculada a una factura y ya no puede corregirse." };
  if (value.includes("DISPATCH_GUIDE_BATCH_LOCKED")) return { message: "La guía tiene una asociación de lote activa o histórica y ya no puede corregirse." };
  if (value.includes("DISPATCH_NOT_EDITABLE")) return { message: "Solo los despachos en estado Registrado pueden corregirse." };
  if (value.includes("DISPATCH_CORRECTION_REASON_REQUIRED")) return { message: "Indica el motivo de la corrección." };
  if (value.includes("PERMISSION_DENIED")) return { message: "No tienes permiso para corregir esta guía." };
  return { message: dispatchError(message).replace("registrar el despacho", "corregir la guía") };
}

export async function registerDispatchAction(
  _state: DispatchMutationState,
  formData: FormData,
): Promise<DispatchMutationState> {
  const projectId = text(formData, "projectId");
  const programmingId = text(formData, "programmingId");
  if (!UUID.test(projectId) || !UUID.test(programmingId)) return { status: "error", message: "Selecciona una programación válida." };
  const auth = await authorize(projectId, "dispatch.create");
  if (!auth) return { status: "error", message: "No tienes permiso para registrar despachos." };

  const result = text(formData, "result");
  const quantities = formData.getAll("lineQuantity").map(Number);
  const units = formData.getAll("lineUnitCode").map(String);
  const codes = formData.getAll("lineProductCode").map((value) => String(value).trim());
  const descriptions = formData.getAll("lineProductDescription").map((value) => String(value).trim());
  const lines = quantities.map((quantity, index) => ({
    quantity,
    unit_code: units[index]?.trim(),
    product_code: codes[index],
    product_description: descriptions[index],
  }));
  if (
    !RESULTS.includes(result) || !lines.length ||
    lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0 || !line.unit_code || !line.product_code || !line.product_description)
  ) return { status: "error", message: "Completa correctamente las líneas y el resultado físico." };

  const dispatchedRaw = text(formData, "dispatchedQuantity");
  const receivedRaw = text(formData, "receivedQuantity");
  const dispatched = dispatchedRaw === "" ? null : Number(dispatchedRaw);
  const received = receivedRaw === "" ? null : Number(receivedRaw);
  if ((dispatched !== null && !Number.isFinite(dispatched)) || (received !== null && !Number.isFinite(received))) {
    return { status: "error", message: "Revisa las cantidades físicas." };
  }

  const timezone = auth.context.activeProject?.timezone || "America/Guatemala";
  const loadAt = localToIso(text(formData, "loadAt"), timezone);
  const arrivalAt = localToIso(text(formData, "arrivalAt"), timezone);
  const departureAt = localToIso(text(formData, "departureAt"), timezone);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_dispatch_with_lines", {
    p_programming_id: programmingId,
    p_guide_number: text(formData, "guideNumber"),
    p_order_number: text(formData, "orderNumber") || null,
    p_guide_date: text(formData, "guideDate"),
    p_received_by_name: text(formData, "receivedByName"),
    p_lines: lines,
    p_load_at: loadAt,
    p_arrival_at: arrivalAt,
    p_departure_at: departureAt,
    p_result: result,
    p_dispatched_quantity: dispatched,
    p_received_quantity: received,
    p_template_version_id: null,
    p_provider_extra_data: {},
  });
  if (error) return { status: "error", message: dispatchError(error.message) };
  const dispatchId = String(data);
  const admin = createAdminClient();
  const { data: guide } = await admin
    .from("dispatch_guides")
    .select("id")
    .eq("project_id", projectId)
    .eq("dispatch_id", dispatchId)
    .maybeSingle();
  revalidatePath("/dispatches");
  revalidatePath(`/programming/${programmingId}`);
  revalidatePath(`/dispatches/${dispatchId}`);
  return {
    status: "success",
    dispatchId,
    guideId: guide?.id,
    message: "Despacho y guía registrados correctamente.",
  };
}

export async function correctDispatchGuideAction(
  _state: CorrectionMutationState,
  formData: FormData,
): Promise<CorrectionMutationState> {
  const projectId = text(formData, "projectId");
  const dispatchId = text(formData, "dispatchId");
  const programmingId = text(formData, "programmingId");
  const templateVersionId = text(formData, "templateVersionId");
  const expectedVersion = Number(text(formData, "expectedVersion"));
  const reason = text(formData, "reason");
  if (
    !UUID.test(projectId) || !UUID.test(dispatchId) || !UUID.test(programmingId) ||
    !UUID.test(templateVersionId) || !Number.isInteger(expectedVersion) || expectedVersion <= 0
  ) return { status: "error", message: "Los datos de la guía están desactualizados. Recarga la página." };
  if (!reason) return { status: "error", message: "Indica el motivo de la corrección." };
  const auth = await authorize(projectId, "dispatch.modify");
  if (!auth) {
    return { status: "error", message: "No tienes permiso para corregir esta guía." };
  }

  const result = text(formData, "result");
  const quantities = formData.getAll("lineQuantity").map(Number);
  const units = formData.getAll("lineUnitCode").map(String);
  const codes = formData.getAll("lineProductCode").map((value) => String(value).trim());
  const descriptions = formData.getAll("lineProductDescription").map((value) => String(value).trim());
  const lines = quantities.map((quantity, index) => ({
    quantity,
    unit_code: units[index]?.trim(),
    product_code: codes[index],
    product_description: descriptions[index],
  }));
  if (
    !RESULTS.includes(result) || !lines.length ||
    lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0 || !line.unit_code || !line.product_code || !line.product_description)
  ) return { status: "error", message: "Completa correctamente las líneas y el resultado físico." };

  const dispatched = Number(text(formData, "dispatchedQuantity"));
  const received = Number(text(formData, "receivedQuantity"));
  if (!Number.isFinite(dispatched) || !Number.isFinite(received)) {
    return { status: "error", message: "Revisa las cantidades físicas." };
  }

  let providerExtraData: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text(formData, "providerExtraData") || "{}");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    providerExtraData = parsed as Record<string, unknown>;
  } catch {
    return { status: "error", message: "Los datos complementarios de la guía no son válidos." };
  }

  const timezone = auth.context.activeProject?.timezone || "America/Guatemala";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("correct_dispatch_guide_with_lines", {
    p_dispatch_id: dispatchId,
    p_expected_version: expectedVersion,
    p_guide_number: text(formData, "guideNumber"),
    p_order_number: text(formData, "orderNumber") || null,
    p_guide_date: text(formData, "guideDate"),
    p_received_by_name: text(formData, "receivedByName"),
    p_lines: lines,
    p_load_at: localToIso(text(formData, "loadAt"), timezone),
    p_arrival_at: localToIso(text(formData, "arrivalAt"), timezone),
    p_departure_at: localToIso(text(formData, "departureAt"), timezone),
    p_result: result,
    p_dispatched_quantity: dispatched,
    p_received_quantity: received,
    p_template_version_id: templateVersionId,
    p_provider_extra_data: providerExtraData,
    p_reason: reason,
  });
  if (error) return { status: "error", ...correctionError(error.message) };

  revalidatePath("/dispatches");
  revalidatePath(`/dispatches/${dispatchId}`);
  revalidatePath(`/programming/${programmingId}`);
  return {
    status: "success",
    newVersion: Number(data),
    message: "La guía y su resultado se corrigieron con trazabilidad completa.",
  };
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
  if (!UUID.test(projectId) || !UUID.test(dispatchId) || !UUID.test(typeId) || !RESPONSIBILITIES.includes(responsibility) || !CHARGES.includes(charge)) {
    return { status: "error", message: "Completa los datos requeridos de la incidencia." };
  }
  if (!(await authorize(projectId, "dispatch.register_incident"))) return { status: "error", message: "No tienes permiso para registrar incidencias." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_dispatch_incident", {
    p_dispatch_id: dispatchId,
    p_incident_type_id: typeId,
    p_responsibility: responsibility,
    p_charge_applicability: charge,
    p_notes: text(formData, "notes") || null,
  });
  if (error) {
    const value = error.message.toUpperCase();
    const message = value.includes("PERMISSION") ? "No tienes permiso para registrar incidencias."
      : value.includes("INACTIVE") ? "El tipo de incidencia está inactivo."
      : value.includes("COMPANY_MISMATCH") ? "El tipo de incidencia pertenece a otra empresa."
      : "No fue posible registrar la incidencia.";
    return { status: "error", message };
  }
  revalidatePath(`/dispatches/${dispatchId}`);
  revalidatePath("/dispatches");
  return { status: "success", incidentId: String(data), message: "Incidencia registrada." };
}

type PrepareUploadInput = {
  projectId: string;
  contextId: string;
  context: "guide" | "incident";
  fileName: string;
  mimeType: string;
  fileSize: number;
  documentId?: string;
};

export async function prepareDispatchUpload(input: PrepareUploadInput): Promise<UploadActionResult> {
  const permission = input.context === "guide" ? "dispatch.modify" : "dispatch.register_incident";
  if (!UUID.test(input.projectId) || !UUID.test(input.contextId) || !(await authorize(input.projectId, permission))) {
    return { status: "error", message: "No tienes permiso para adjuntar este documento." };
  }
  const supabase = await createClient();
  const rpc = input.context === "guide" ? "prepare_guide_document_upload" : "prepare_incident_document_upload";
  const idKey = input.context === "guide" ? "p_guide_id" : "p_incident_id";
  const { data, error } = await supabase.rpc(rpc, {
    [idKey]: input.contextId,
    p_file_name: input.fileName,
    p_mime_type: input.mimeType,
    p_file_size: input.fileSize,
    p_purpose: input.context === "guide" ? "DISPATCH_GUIDE" : "INCIDENT_EVIDENCE",
    p_document_id: input.documentId || null,
  });
  if (error || !data?.[0]) return { status: "error", message: dispatchError(error?.message ?? "DOCUMENT_PREPARE_FAILED") };
  const prepared = data[0];
  const admin = createAdminClient();
  const signed = await admin.storage.from(prepared.storage_bucket).createSignedUploadUrl(prepared.storage_path, { upsert: false });
  if (signed.error || !signed.data?.token) {
    await supabase.rpc("fail_document_upload", { p_document_id: prepared.document_id, p_version_id: prepared.version_id, p_reason: "No fue posible crear la URL firmada." });
    return { status: "error", message: "No fue posible preparar la carga segura." };
  }
  return { status: "success", upload: {
    documentId: prepared.document_id,
    versionId: prepared.version_id,
    versionNumber: prepared.version_number,
    bucket: prepared.storage_bucket,
    path: prepared.storage_path,
    token: signed.data.token,
    expiresAt: prepared.upload_expires_at,
  } };
}

export async function finalizeDispatchUpload(projectId: string, documentId: string, versionId: string) {
  if (!UUID.test(projectId) || !UUID.test(documentId) || !UUID.test(versionId)) return { status: "error" as const, message: "Carga inválida." };
  const auth = await requireActiveProfile();
  const context = await getProjectContext(auth.id);
  if (context.status !== "ready" || context.activeProject?.id !== projectId) return { status: "error" as const, message: "Proyecto inválido." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finalize_document_upload", { p_document_id: documentId, p_version_id: versionId });
  if (error) return { status: "error" as const, message: "El archivo se cargó, pero no pudo validarse. Intenta nuevamente." };
  revalidatePath("/dispatches");
  return { status: "success" as const };
}

export async function failDispatchUpload(projectId: string, documentId: string, versionId: string, reason: string) {
  if (!UUID.test(projectId) || !UUID.test(documentId) || !UUID.test(versionId)) return;
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status !== "ready" || context.activeProject?.id !== projectId) return;
  const supabase = await createClient();
  await supabase.rpc("fail_document_upload", { p_document_id: documentId, p_version_id: versionId, p_reason: reason.slice(0, 500) });
}

export async function getDocumentDownloadUrl(projectId: string, documentId: string) {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status !== "ready" || context.activeProject?.id !== projectId || !context.permissions.includes("dispatch.view")) {
    return { status: "error" as const, message: "No tienes acceso a este documento." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("document_versions").select("storage_bucket, storage_path").eq("document_id", documentId).eq("upload_status", "UPLOADED").eq("is_current", true).maybeSingle();
  if (error || !data) return { status: "error" as const, message: "No hay una versión disponible." };
  const signed = await createAdminClient().storage.from(data.storage_bucket).createSignedUrl(data.storage_path, 300);
  if (signed.error || !signed.data) return { status: "error" as const, message: "No fue posible crear el enlace seguro." };
  return { status: "success" as const, url: signed.data.signedUrl };
}
