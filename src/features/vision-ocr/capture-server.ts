import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getProjectContext } from "@/features/projects/queries";
import type { DispatchCatalogOption } from "@/features/dispatches/types";
import { getPublicEnvironment } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hasValidSameOrigin } from "@/lib/http/same-origin";
import { emptyGuideDetails, matchGuideCatalog, normalizeGuideDate, normalizeGuideTime, validateOcrReview, type GuideOcrDraft } from "./guide-draft";
import { extractDocumentText, VisionOcrError } from "./service";
import { hasValidImageSignature, isAllowedVisionImageType } from "./vision-ocr";
import type { VisionTemplateType } from "./template-classifier";

const BUCKET = "vision-ocr-dev";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
export class CaptureError extends Error {
  constructor(message: string, public status = 400, public guideId?: string) { super(message); }
}
type Capture = {
  id: string; project_id: string; dispatch_id: string; created_by: string;
  original_name: string; original_mime: string; original_size: number; original_path: string;
  original_sha256: string | null; status: string; guide_id: string | null;
  expires_at: string; extraction: (GuideOcrDraft & { catalogDraft?: GuideOcrDraft; variants?: Record<VisionTemplateType, GuideOcrDraft>; imageRotation?: number }) | null; raw_text: string | null;
  review_payload: { details?: GuideOcrDraft["details"] } | null;
  prepared_upload: { documentId: string; versionId: string; bucket: string; path: string } | null;
  evidence_attached_at: string | null;
};
export async function captureContext(request: Request, projectId: string, dispatchId: string, readOnly = false) {
  const environment = getPublicEnvironment();
  if (environment.appEnvironment !== "DEV" || environment.projectRef !== "gholwtklihaphoevosyb") throw new CaptureError("Herramienta disponible únicamente en DEV.", 404);
  if (!readOnly && !hasValidSameOrigin(request)) throw new CaptureError("Solicitud no válida.", 403);
  if (!UUID.test(projectId) || !UUID.test(dispatchId)) throw new CaptureError("Selecciona un despacho válido.");
  const db = await createClient();
  const claims = await db.auth.getClaims();
  const actor = claims.data?.claims?.sub;
  if (claims.error || !actor) throw new CaptureError("Tu sesión no está disponible.", 401);
  const profile = await db.from("profiles").select("active").eq("id", actor).maybeSingle();
  if (!profile.data?.active || profile.error) throw new CaptureError("Usuario sin acceso.", 403);
  const context = await getProjectContext(actor);
  if (context.status !== "ready" || context.activeProject?.id !== projectId || !context.permissions.includes(readOnly ? "dispatch.view" : "dispatch.modify")) throw new CaptureError("No tienes permiso en este proyecto.", 403);
  const dispatch = await db.from("dispatches").select("id,project_id,status,programming_id,version").eq("id", dispatchId).eq("project_id", projectId).maybeSingle();
  if (dispatch.error || !dispatch.data) throw new CaptureError("Despacho no disponible.", 404);
  // Evidence retries for already saved captures remain possible after completion.
  const programming = await db.from("programming").select("unit_code").eq("id", dispatch.data.programming_id).eq("project_id", projectId).single();
  if (programming.error) throw new CaptureError("No se pudo consultar la programación.", 503);
  return { db, admin: createAdminClient(), actor, project: context.activeProject, dispatch: dispatch.data, unit: String(programming.data.unit_code) };
}
type Context = Awaited<ReturnType<typeof captureContext>>;
async function ownedCapture(context: Context, id: string) {
  if (!UUID.test(id)) throw new CaptureError("Captura inválida.");
  const result = await context.admin.from("guide_ocr_captures").select("*").eq("id", id).eq("created_by", context.actor).eq("project_id", context.project.id).eq("dispatch_id", context.dispatch.id).maybeSingle();
  if (result.error || !result.data) throw new CaptureError("Captura no disponible. Toma nuevamente la fotografía.", 404);
  const capture = result.data as Capture;
  if (!capture.guide_id && new Date(capture.expires_at).valueOf() < Date.now()) throw new CaptureError("La captura venció. Toma nuevamente la fotografía.", 410);
  return capture;
}
export async function projectCatalog(context: Context): Promise<DispatchCatalogOption[]> {
  const results = await Promise.all((["PRODUCT", "SERVICE"] as const).map(async (type) => {
    const items: DispatchCatalogOption[] = [];
    for (let offset = 0; offset < 10000; offset += 1000) {
      const result = await context.db.from(type === "PRODUCT" ? "project_product_prices" : "project_service_prices")
        .select(type === "PRODUCT" ? "id,code,reference,price" : "id,code,description,unit_code,observations,price")
        .eq("project_id", context.project.id).order("id").range(offset, offset + 999);
      if (result.error) throw new CaptureError("No fue posible consultar los precios. Intenta de nuevo; no se asignará un precio inventado.", 503);
      for (const raw of result.data ?? []) {
        const row = raw as unknown as Record<string, unknown>;
        const price = Number(row.price);
        if (!Number.isFinite(price) || price < 0) throw new CaptureError("Hay precios inválidos en la cotización.", 503);
        items.push({ id: String(row.id), type, code: String(row.code), price, currency: "GTQ",
          reference: typeof row.reference === "string" ? row.reference : null,
          description: typeof row.description === "string" ? row.description : null,
          unitCode: typeof row.unit_code === "string" ? row.unit_code : null,
          observations: typeof row.observations === "string" ? row.observations : null });
      }
      if ((result.data?.length ?? 0) < 1000) return items;
    }
    throw new CaptureError("La cotización supera el límite de esta versión. Consulta al administrador.", 503);
  }));
  return results.flat();
}

export async function prepareCapture(context: Context, input: { fileName: string; mimeType: string; size: number }) {
  if (context.dispatch.status !== "IN_EXECUTION") throw new CaptureError("El despacho debe estar en ejecución.");
  if (!input || typeof input.fileName !== "string" || typeof input.mimeType !== "string") throw new CaptureError("Archivo inválido.");
  if (!isAllowedVisionImageType(input.mimeType) || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > 10 * 1024 * 1024) throw new CaptureError("Usa una foto JPG, PNG o WEBP de hasta 10 MiB.");
  const name = input.fileName?.replace(/[\x00-\x1f/\\]/gu, "_").slice(0, 200) || "guia.jpg";
  const quota = await context.admin.from("guide_ocr_captures").select("id", { count: "exact", head: true }).eq("created_by", context.actor).gte("created_at", new Date(Date.now() - 3600000).toISOString());
  if (quota.error) throw new CaptureError("No se pudo preparar la captura. Verifica la migración de DEV.", 503);
  if ((quota.count ?? 0) >= 60) throw new CaptureError("Se alcanzó el límite de 60 capturas por hora. Intenta más tarde.", 429);
  // Collect expired, abandoned staging files for this actor only. Saved photos
  // are managed by the existing document lifecycle, never by this cleanup.
  const expired = await context.admin.from("guide_ocr_captures").select("id,original_path").eq("created_by", context.actor).is("guide_id", null).lt("expires_at", new Date().toISOString()).limit(10);
  for (const row of expired.data ?? []) {
    const removal = await context.admin.storage.from(BUCKET).remove([row.original_path]);
    if (!removal.error) await context.admin.from("guide_ocr_captures").delete().eq("id", row.id).is("guide_id", null);
  }
  const id = randomUUID(), path = `${context.project.id}/${context.actor}/${id}/original`;
  const insert = await context.admin.from("guide_ocr_captures").insert({ id, project_id: context.project.id, dispatch_id: context.dispatch.id, created_by: context.actor,
    original_path: path, original_name: name, original_mime: input.mimeType, original_size: input.size });
  if (insert.error) throw new CaptureError("No se pudo preparar la captura.", 503);
  const signed = await context.admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data) {
    await context.admin.from("guide_ocr_captures").delete().eq("id", id);
    throw new CaptureError("No se pudo preparar la carga segura.", 503);
  }
  return { captureId: id, bucket: BUCKET, path, token: signed.data.token };
}

export async function extractCapture(context: Context, id: string, image: File, adjustments: unknown, manual = false) {
  const capture = await ownedCapture(context, id);
  if (capture.status === "EXTRACTED") return { captureId: id, draft: capture.extraction?.catalogDraft ?? capture.extraction, variants: capture.extraction?.variants, rawText: capture.raw_text, project: context.project, imageRotation: capture.extraction?.imageRotation ?? 0 };
  if (context.dispatch.status !== "IN_EXECUTION" || capture.status !== "PREPARED") throw new CaptureError("La captura está procesándose o ya se guardó.", 409);
  if (image.size > 3 * 1024 * 1024) throw new CaptureError("El recorte debe pesar menos de 3 MiB.", 413);
  const lock = await context.admin.from("guide_ocr_captures").update({ status: "PROCESSING" }).eq("id", id).eq("status", "PREPARED").select("id");
  if (lock.error || !lock.data?.length) throw new CaptureError("La captura está procesándose.", 409);
  try {
    const original = await context.admin.storage.from(BUCKET).download(capture.original_path);
    if (original.error || !original.data) throw new CaptureError("No se recibió la foto original. Vuelve a cargarla.");
    const bytes = new Uint8Array(await original.data.arrayBuffer());
    if (bytes.length !== capture.original_size || !hasValidImageSignature(bytes, capture.original_mime)) throw new CaptureError("La foto original no es válida.");
    const result = manual ? { text: "", imageRotation: 0, guideDraft: { guideNumber: "", arrivalTime: "", departureTime: "", details: emptyGuideDetails(), lines: [], rawTimes: { loading: "", arrival: "", departure: "" }, confidence: {}, warnings: ["Captura completada manualmente desde la fotografía. No se ejecutó Google Vision."] } as GuideOcrDraft }
      : await extractDocumentText(image, "DISPATCH_GUIDE", null);
    const catalog = await projectCatalog(context);
    const matchDraft = (value: GuideOcrDraft) => ({ ...value, lines: value.lines.map((line) => matchGuideCatalog(line, catalog, context.unit)) });
    const draft = matchDraft(result.guideDraft);
    const variants = "guideVariants" in result ? Object.fromEntries(Object.entries(result.guideVariants).map(([key, value]) => [key, matchDraft(value)])) as Record<VisionTemplateType, GuideOcrDraft> : undefined;
    const saved = await context.admin.from("guide_ocr_captures").update({ status: "EXTRACTED", original_sha256: hash(bytes),
      processed_sha256: hash(new Uint8Array(await image.arrayBuffer())), raw_text: result.text, extraction: { ...result.guideDraft, catalogDraft: draft, variants, imageRotation: result.imageRotation }, image_adjustments: { source: manual ? "PHOTO_MANUAL" : "GOOGLE_VISION", settings: adjustments } }).eq("id", id).eq("status", "PROCESSING");
    if (saved.error) throw new CaptureError("No se pudo conservar la lectura. Intenta nuevamente.", 503);
    return { captureId: id, draft, variants, rawText: result.text, project: context.project, imageRotation: result.imageRotation };
  } catch (error) {
    await context.admin.from("guide_ocr_captures").update({ status: "PREPARED" }).eq("id", id).eq("status", "PROCESSING");
    if (error instanceof VisionOcrError) throw new CaptureError(error.publicMessage, error.status);
    throw error;
  }
}

export async function saveCapture(context: Context, id: string, input: unknown, expectedVersion: number) {
  const capture = await ownedCapture(context, id);
  let reviewHash = "";
  if (!capture.guide_id) {
    const validation = validateOcrReview(input);
    if (validation) throw new CaptureError(validation);
    const draft = input as GuideOcrDraft;
    // Read project/address/order values are reviewable source data. The active
    // project and dispatch are enforced by captureContext and ownedCapture.
    const catalog = await projectCatalog(context);
    const lines = draft.lines.map((line) => {
      const match = matchGuideCatalog(line, catalog, context.unit);
      const selection = line.catalogItemId ? match.candidates.find((item) => item.id === line.catalogItemId && item.type === line.type) : undefined;
      if (match.candidates.length && !selection) throw new CaptureError(`Selecciona la variante de ${line.productCode} antes de guardar.`);
      if (line.catalogItemId && !selection) throw new CaptureError("La selección de la cotización cambió o pertenece a otro proyecto.");
      return { quantity: Number(line.quantity), unit_code: line.unit, catalog_type: line.type, catalog_item_id: selection?.id ?? null,
        product_code: line.productCode.trim(), product_description: line.description.trim() || null };
    });
    const payload = { casting_element: draft.resident!.castingElement, laboratory_applied: draft.resident!.laboratoryApplied, guide_number: draft.guideNumber.trim(), guide_date: normalizeGuideDate(draft.details.guideDate), arrival: draft.arrivalTime, departure: draft.departureTime,
      details: { ...draft.details, loadingTime: draft.details.loadingTime ? normalizeGuideTime(draft.details.loadingTime) : "" }, lines, identity_checks: [], parser_version: "guides-controls-v3" };
    reviewHash = hash(JSON.stringify(payload));
    const approval = await context.admin.from("guide_ocr_captures").update({ review_payload: payload, review_hash: reviewHash }).eq("id", id).eq("status", "EXTRACTED").is("guide_id", null).select("id");
    if (approval.error || !approval.data?.length) throw new CaptureError("Recarga la captura antes de guardar.", 409);
  }
  const saved = await context.db.rpc("commit_vision_ocr_guide", { p_capture_id: id, p_expected_version: expectedVersion, p_review_hash: reviewHash });
  if (saved.error) {
    const message = saved.error.message;
    throw new CaptureError(message.includes("VERSION_CONFLICT") ? "El despacho cambió. Cierra y vuelve a abrir la guía antes de guardar."
      : message.includes("NUMBER_ALREADY_EXISTS") ? "Este número de guía ya está registrado en el despacho."
      : message.includes("VARIANT_REQUIRED") ? "El código ya está en la cotización. Selecciona su variante."
      : message.includes("UNIT_MISMATCH") ? "Revisa la UM de las líneas contra su cotización y programación."
      : message.includes("GUIDE_CATALOG_INCIDENT_TYPE_INACTIVE") ? "El tipo de incidencia para códigos fuera de la cotización está inactivo. Solicita su activación antes de guardar."
      : "No se pudo guardar la guía. Revisa sus campos e intenta nuevamente.", 409);
  }
  const result = saved.data as { guide_id: string; dispatch_version: number; upload: NonNullable<Capture["prepared_upload"]> };
  try {
    if (!capture.evidence_attached_at) {
      const target = await context.db.from("document_versions").select("upload_status,upload_expires_at").eq("id", result.upload.versionId).eq("document_id", result.upload.documentId).single();
      if (target.error) throw Error("DOCUMENT_UNAVAILABLE");
      let uploaded = target.data.upload_status === "UPLOADED";
      if (!uploaded && new Date(target.data.upload_expires_at).valueOf() < Date.now()) {
        const prepared = await context.db.rpc("prepare_guide_document_upload", { p_guide_id: result.guide_id, p_file_name: capture.original_name, p_mime_type: capture.original_mime,
          p_file_size: capture.original_size, p_purpose: "DISPATCH_GUIDE", p_document_id: result.upload.documentId });
        const fresh = prepared.data?.[0]; if (prepared.error || !fresh) throw Error("RETRY_PREPARE_FAILED");
        result.upload = { documentId: fresh.document_id, versionId: fresh.version_id, bucket: fresh.storage_bucket, path: fresh.storage_path };
        const updated = await context.admin.from("guide_ocr_captures").update({ prepared_upload: result.upload }).eq("id", id);
        if (updated.error) throw Error("RETRY_TARGET_FAILED");
        uploaded = false;
      }
      const copied = uploaded ? { error: true } : await context.admin.storage.from(BUCKET).copy(capture.original_path, result.upload.path, { destinationBucket: result.upload.bucket });
      if (copied.error) {
        // A previous request may have copied the original before losing its
        // response. Verify its hash rather than accepting arbitrary contents.
        const existing = await context.admin.storage.from(result.upload.bucket).download(result.upload.path);
        if (existing.error || !existing.data || hash(new Uint8Array(await existing.data.arrayBuffer())) !== capture.original_sha256) throw Error("COPY_FAILED");
      }
      if (!uploaded) {
        const finalized = await context.db.rpc("finalize_document_upload", { p_document_id: result.upload.documentId, p_version_id: result.upload.versionId });
        if (finalized.error) throw Error("FINALIZE_FAILED");
      }
      const attached = await context.admin.from("guide_ocr_captures").update({ evidence_attached_at: new Date().toISOString() }).eq("id", id);
      if (attached.error) throw Error("ATTACH_FAILED");
      await context.admin.storage.from(BUCKET).remove([capture.original_path]);
    }
  } catch {
    throw new CaptureError("La guía se guardó, pero falta adjuntar su foto. Pulsa Reintentar foto; no se creará otra guía.", 503, result.guide_id);
  }
  return { guideId: result.guide_id, newVersion: result.dispatch_version };
}

export async function discardCapture(context: Context, id: string) {
  const capture = await ownedCapture(context, id);
  if (capture.guide_id || capture.status === "PROCESSING") return;
  const removed = await context.admin.storage.from(BUCKET).remove([capture.original_path]);
  if (!removed.error) await context.admin.from("guide_ocr_captures").delete().eq("id", id).is("guide_id", null);
}

export async function savedGuideCapture(context: Context, guideId: string) {
  if (!UUID.test(guideId)) throw new CaptureError("Guía inválida.");
  const result = await context.db.from("guide_ocr_captures").select("id,created_by,review_payload,extraction,raw_text,prepared_upload,evidence_attached_at,original_path").eq("guide_id", guideId).eq("project_id", context.project.id).eq("dispatch_id", context.dispatch.id).maybeSingle();
  if (result.error) throw new CaptureError("No se pudo consultar la lectura.", 503);
  if (!result.data) return null;
  const capture = result.data as unknown as Capture;
  const upload = capture.prepared_upload;
  const preview = await context.admin.storage.from(capture.evidence_attached_at && upload ? upload.bucket : BUCKET).createSignedUrl(capture.evidence_attached_at && upload ? upload.path : capture.original_path, 300);
  return { captureId: capture.id, canRetry: capture.created_by === context.actor && !capture.evidence_attached_at, details: capture.review_payload?.details, extraction: capture.extraction, rawText: capture.raw_text, originalUrl: preview.data?.signedUrl ?? null };
}
