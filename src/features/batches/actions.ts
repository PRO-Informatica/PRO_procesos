"use server";

import { revalidatePath } from "next/cache";

import { requireActiveProfile } from "@/features/auth/queries";
import { normalizeOperationalOrder, processInvoicePdf, type InvoiceProcessingContext } from "@/features/invoices/invoice-processing";
import { getProjectContext } from "@/features/projects/queries";
import { matchesFiscalIdentity } from "@/lib/business-identity";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { extractMixtoListoInvoicePdf } from "./mixto-listo-extractor";
import { orderNumberFromMixtoListoPca } from "./mixto-listo-parser";
import type { BatchMutationState, InvoiceInspection, InvoiceType } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PDF_SIZE = 10 * 1024 * 1024;

function value(formData: FormData, name: string) {
  const entry = formData.get(name);
  return typeof entry === "string" ? entry.trim() : "";
}

async function authorize(projectId: string, permission: string) {
  const profile = await requireActiveProfile();
  const context = await getProjectContext(profile.id);
  if (context.status !== "ready" || context.activeProject?.id !== projectId || !context.permissions.includes(permission)) return null;
  return { profile, context };
}

function refresh(batchId?: string, dispatchId?: string) {
  revalidatePath("/batches");
  revalidatePath("/invoices");
  revalidatePath("/reconciliation");
  if (batchId) revalidatePath(`/batches/${batchId}`);
  if (dispatchId) revalidatePath(`/dispatches/${dispatchId}`);
}

function batchError(message: string) {
  const error = message.toUpperCase();
  if (error.includes("DISPATCH_ALREADY_IN_ACTIVE_BATCH")) return "El despacho ya pertenece a un lote activo.";
  if (error.includes("DISPATCH_NOT_ELIGIBLE")) return "El despacho no es elegible para este lote.";
  if (error.includes("BATCH_NOT_EDITABLE")) return "El lote está cerrado y ya no permite cambios.";
  if (error.includes("REMOVAL_REASON")) return "Indica un motivo válido para remover el despacho.";
  if (error.includes("MONDAY_TO_SUNDAY")) return "La semana debe iniciar lunes y finalizar domingo.";
  if (error.includes("ALREADY_EXISTS") || error.includes("DUPLICATE")) return "Ya existe un lote para esa semana o código.";
  if (error.includes("PERMISSION_DENIED")) return "No tienes permiso para realizar esta operación.";
  return "No fue posible completar la operación del lote.";
}

function invoiceError(message: string) {
  const error = message.toUpperCase();
  if (error.includes("NOT_COMPLETED")) return "El despacho debe estar completado para recibir facturas.";
  if (error.includes("ACTIVE_DISPATCH_INVOICE")) return "Ya existe una factura activa de ese tipo para el despacho.";
  if (error.includes("TYPE_MISMATCH")) return "El tipo detectado no coincide con el tipo de factura seleccionado.";
  if (error.includes("CRITICAL_VALIDATION")) return "El PDF no corresponde al proyecto, proveedor o pedido del despacho.";
  if (error.includes("BOTH_DISPATCH_INVOICES")) return "Carga la factura de producto y la factura de servicio antes de conciliar.";
  if (error.includes("PERMISSION_DENIED")) return "No tienes permiso para gestionar facturas.";
  return "No fue posible completar el proceso de factura.";
}

function validPdf(file: FormDataEntryValue | null): file is File {
  return file instanceof File && file.size > 0 && file.size <= MAX_PDF_SIZE && file.type.toLowerCase() === "application/pdf" && file.name.toLowerCase().endsWith(".pdf");
}

type DispatchInvoiceContext = InvoiceProcessingContext & { projectId: string; batchId: string; dispatchId: string; operationalStatus: "IN_EXECUTION" | "COMPLETED"; productInvoiceId: string | null; serviceInvoiceId: string | null; reconciliationStatus: string };

async function invoiceContext(projectId: string, batchId: string, dispatchId: string): Promise<DispatchInvoiceContext | null> {
  const admin = createAdminClient();
  const [dispatchResult, batchResult, projectResult, reconciliationResult] = await Promise.all([
    admin.from("dispatches").select("id, project_id, supplier_id, order_number, real_volume, real_unit_code, status").eq("id", dispatchId).eq("project_id", projectId).maybeSingle(),
    admin.from("batches").select("id, project_id, accounting_period").eq("id", batchId).eq("project_id", projectId).maybeSingle(),
    admin.from("projects").select("id, billing_legal_name, billing_tax_id").eq("id", projectId).maybeSingle(),
    admin.from("dispatch_reconciliations").select("status, current_product_invoice_id, current_service_invoice_id").eq("dispatch_id", dispatchId).eq("project_id", projectId).maybeSingle(),
  ]);
  if (!dispatchResult.data || !batchResult.data || !projectResult.data) return null;
  const relationResult = await admin.from("batch_dispatches").select("id").eq("batch_id", batchId).eq("dispatch_id", dispatchId).is("removed_at", null).maybeSingle();
  if (!relationResult.data) return null;
  const supplierResult = await admin.from("suppliers").select("name, tax_id").eq("id", dispatchResult.data.supplier_id).maybeSingle();
  if (!supplierResult.data) return null;
  return {
    projectId, batchId, dispatchId,
    operationalStatus: dispatchResult.data.status,
    orderNumber: dispatchResult.data.order_number ?? "",
    supplierName: supplierResult.data.name,
    supplierTaxId: supplierResult.data.tax_id,
    billingLegalName: projectResult.data.billing_legal_name,
    billingTaxId: projectResult.data.billing_tax_id,
    accountingPeriod: batchResult.data.accounting_period,
    realVolume: dispatchResult.data.real_volume === null ? null : Number(dispatchResult.data.real_volume),
    realUnitCode: dispatchResult.data.real_unit_code,
    productInvoiceId: reconciliationResult.data?.current_product_invoice_id ?? null,
    serviceInvoiceId: reconciliationResult.data?.current_service_invoice_id ?? null,
    reconciliationStatus: reconciliationResult.data?.status ?? "PENDING_INVOICES",
  };
}

export async function createBatchAction(_previous: BatchMutationState, formData: FormData): Promise<BatchMutationState> {
  const projectId = value(formData, "projectId");
  if (!UUID.test(projectId) || !(await authorize(projectId, "batch.create"))) return { status: "error", message: "No tienes permiso para crear lotes." };
  const { data, error } = await (await createClient()).rpc("create_batch", { p_project_id: projectId, p_code: value(formData, "code"), p_period_start: value(formData, "periodStart"), p_period_end: value(formData, "periodEnd") });
  if (error || !data) return { status: "error", message: batchError(error?.message ?? "BATCH_CREATE_FAILED") };
  refresh(String(data));
  return { status: "success", message: "Lote creado correctamente.", batchId: String(data) };
}

export async function addDispatchToBatchAction(_previous: BatchMutationState, formData: FormData): Promise<BatchMutationState> {
  const projectId = value(formData, "projectId"), batchId = value(formData, "batchId"), dispatchId = value(formData, "dispatchId");
  if (![projectId, batchId, dispatchId].every((id) => UUID.test(id)) || !(await authorize(projectId, "batch.modify"))) return { status: "error", message: "No tienes permiso para modificar el lote." };
  const { error } = await (await createClient()).rpc("add_dispatch_to_batch", { p_batch_id: batchId, p_dispatch_id: dispatchId });
  if (error) return { status: "error", message: batchError(error.message) };
  refresh(batchId, dispatchId);
  return { status: "success", message: "Despacho agregado al lote." };
}

export async function removeDispatchFromBatchAction(_previous: BatchMutationState, formData: FormData): Promise<BatchMutationState> {
  const projectId = value(formData, "projectId"), batchId = value(formData, "batchId"), dispatchId = value(formData, "dispatchId");
  if (![projectId, batchId, dispatchId].every((id) => UUID.test(id)) || !(await authorize(projectId, "batch.modify"))) return { status: "error", message: "No tienes permiso para modificar el lote." };
  const { error } = await (await createClient()).rpc("remove_dispatch_from_batch", { p_batch_id: batchId, p_dispatch_id: dispatchId, p_reason: value(formData, "reason") });
  if (error) return { status: "error", message: batchError(error.message) };
  refresh(batchId, dispatchId);
  return { status: "success", message: "Despacho removido; el historial fue conservado." };
}

export async function rolloverBatchAction(_previous: BatchMutationState, formData: FormData): Promise<BatchMutationState> {
  const projectId = value(formData, "projectId"), batchId = value(formData, "batchId");
  if (![projectId, batchId].every((id) => UUID.test(id)) || !(await authorize(projectId, "batch.modify"))) return { status: "error", message: "No tienes permiso para cerrar el lote." };
  const { error } = await (await createClient()).rpc("rollover_weekly_batch", { p_batch_id: batchId });
  if (error) return { status: "error", message: batchError(error.message) };
  refresh(batchId);
  return { status: "success", message: "Semana cerrada y pendientes trasladados al siguiente lote." };
}

export async function inspectDispatchInvoicePdf(projectId: string, batchId: string, dispatchId: string, requestedType: InvoiceType, formData: FormData): Promise<InvoiceInspection> {
  const file = formData.get("file");
  if (![projectId, batchId, dispatchId].every((id) => UUID.test(id)) || !validPdf(file)) return { fileName: file instanceof File ? file.name : "", dispatchId, requestedType, status: "ERROR", message: "Selecciona un PDF digital individual de hasta 10 MiB.", payload: null, duplicate: false };
  if (!(await authorize(projectId, "invoice.create"))) return { fileName: file.name, dispatchId, requestedType, status: "ERROR", message: "No tienes permiso para registrar facturas.", payload: null, duplicate: false };
  const context = await invoiceContext(projectId, batchId, dispatchId);
  if (!context) return { fileName: file.name, dispatchId, requestedType, status: "DISPATCH_NOT_FOUND", message: "No se encontró el despacho dentro de este lote.", payload: null, duplicate: false };
  if (context.operationalStatus !== "COMPLETED") return { fileName: file.name, dispatchId, requestedType, status: "IN_EXECUTION", message: "El despacho continúa en ejecución y todavía no puede recibir facturas.", payload: null, duplicate: false };
  try {
    const processed = await processInvoicePdf(await file.arrayBuffer(), { ...context, expectedType: requestedType });
    if (processed.status === "error") return { fileName: file.name, dispatchId, requestedType, status: "ERROR", message: [processed.message, ...processed.details].join(" "), payload: null, duplicate: false };
    const duplicate = requestedType === "PRODUCT" ? Boolean(context.productInvoiceId) : Boolean(context.serviceInvoiceId);
    return { fileName: file.name, dispatchId, requestedType, status: processed.payload.warnings.length ? "WITH_DIFFERENCES" : "READY", message: processed.payload.warnings.join(" ") || "Factura lista para guardar.", payload: processed.payload, duplicate };
  } catch {
    return { fileName: file.name, dispatchId, requestedType, status: "ERROR", message: "No fue posible extraer texto del PDF digital.", payload: null, duplicate: false };
  }
}

export async function inspectBatchInvoicePdf(projectId: string, batchId: string, formData: FormData): Promise<InvoiceInspection> {
  const file = formData.get("file");
  if (![projectId, batchId].every((id) => UUID.test(id)) || !validPdf(file)) return { fileName: file instanceof File ? file.name : "", dispatchId: null, requestedType: null, status: "ERROR", message: "Selecciona un PDF digital individual de hasta 10 MiB.", payload: null, duplicate: false };
  if (!(await authorize(projectId, "invoice.create"))) return { fileName: file.name, dispatchId: null, requestedType: null, status: "ERROR", message: "No tienes permiso para registrar facturas.", payload: null, duplicate: false };
  try {
    const raw = await extractMixtoListoInvoicePdf(await file.arrayBuffer());
    if (raw.detected_invoice_numbers.length > 1) return { fileName: file.name, dispatchId: null, requestedType: null, status: "REQUIRES_REVIEW", message: "El PDF contiene más de una factura y no puede procesarse automáticamente.", payload: null, duplicate: false };
    const admin = createAdminClient();
    const project = await admin.from("projects").select("billing_legal_name, billing_tax_id").eq("id", projectId).maybeSingle();
    if (!project.data?.billing_legal_name?.trim()) return { fileName: file.name, dispatchId: null, requestedType: null, status: "ERROR", message: "El proyecto actual no tiene configurada su Razón Social de facturación.", payload: null, duplicate: false };
    if (!matchesFiscalIdentity({ expectedName: project.data.billing_legal_name, actualName: raw.billing_legal_name, expectedTaxId: project.data.billing_tax_id, actualTaxId: raw.billing_tax_id })) return { fileName: file.name, dispatchId: null, requestedType: null, status: "ERROR", message: "La factura no pertenece al proyecto actual. El receptor fiscal no coincide con los datos fiscales del proyecto.", payload: null, duplicate: false };
    const orderNumber = orderNumberFromMixtoListoPca(raw.pca_original);
    if (!orderNumber) return { fileName: file.name, dispatchId: null, requestedType: null, status: "ERROR", message: "No se detectó un PCA válido.", payload: null, duplicate: false };
    const relations = await admin.from("batch_dispatches").select("dispatch_id").eq("project_id", projectId).eq("batch_id", batchId).is("removed_at", null);
    const relationIds = (relations.data ?? []).map((row) => row.dispatch_id);
    const dispatches = relationIds.length ? await admin.from("dispatches").select("id, order_number").eq("project_id", projectId).in("id", relationIds) : { data: [], error: null };
    const matches = (dispatches.data ?? []).filter((row) => normalizeOperationalOrder(row.order_number) === orderNumber);
    if (matches.length !== 1) return { fileName: file.name, dispatchId: null, requestedType: null, status: matches.length > 1 ? "REQUIRES_REVIEW" : "DISPATCH_NOT_FOUND", message: matches.length > 1 ? "Más de un despacho coincide con el pedido; selecciona manualmente." : "No existe un despacho del lote para el pedido detectado.", payload: null, duplicate: false };
    const dispatchId = matches[0].id;
    const candidateType: InvoiceType = raw.lines.some((line) => /^\d+$/.test(line.code) && line.description.trim().toUpperCase().startsWith("CON")) ? "PRODUCT" : "SERVICE";
    const next = new FormData(); next.set("file", file);
    return inspectDispatchInvoicePdf(projectId, batchId, dispatchId, candidateType, next);
  } catch {
    return { fileName: file.name, dispatchId: null, requestedType: null, status: "ERROR", message: "Formato no reconocido o PDF sin texto embebido.", payload: null, duplicate: false };
  }
}

export async function saveDispatchInvoice(projectId: string, batchId: string, dispatchId: string, requestedType: InvoiceType, replacesInvoiceId: string | null, formData: FormData) {
  const file = formData.get("file");
  if (![projectId, batchId, dispatchId].every((id) => UUID.test(id)) || !validPdf(file) || (replacesInvoiceId && !UUID.test(replacesInvoiceId))) return { status: "error" as const, message: "La factura seleccionada no es válida." };
  if (!(await authorize(projectId, "invoice.create"))) return { status: "error" as const, message: "No tienes permiso para registrar facturas." };
  const context = await invoiceContext(projectId, batchId, dispatchId);
  if (!context || context.operationalStatus !== "COMPLETED") return { status: "error" as const, message: "El despacho debe estar completado y pertenecer al lote." };
  let processed;
  try { processed = await processInvoicePdf(await file.arrayBuffer(), { ...context, expectedType: requestedType }); }
  catch { return { status: "error" as const, message: "No fue posible leer el PDF digital." }; }
  if (processed.status === "error") return { status: "error" as const, message: [processed.message, ...processed.details].join(" ") };
  const supabase = await createClient();
  const prepared = await supabase.rpc("prepare_dispatch_invoice_upload", { p_batch_id: batchId, p_dispatch_id: dispatchId, p_invoice_type: requestedType, p_payload: processed.payload, p_file_name: file.name, p_file_size: file.size, p_replaces_invoice_id: replacesInvoiceId });
  const row = prepared.data?.[0];
  if (prepared.error || !row) return { status: "error" as const, message: invoiceError(prepared.error?.message ?? "INVOICE_PREPARE_FAILED") };
  const admin = createAdminClient();
  const upload = await admin.storage.from(row.storage_bucket).upload(row.storage_path, file, { contentType: "application/pdf", upsert: false });
  if (upload.error) {
    await supabase.rpc("fail_document_upload", { p_document_id: row.document_id, p_version_id: row.version_id, p_reason: upload.error.message.slice(0, 500) });
    await supabase.rpc("fail_dispatch_invoice_processing", { p_invoice_id: row.invoice_id, p_reason: upload.error.message.slice(0, 500) });
    return { status: "error" as const, message: "No fue posible guardar el PDF en Storage." };
  }
  const finalized = await supabase.rpc("finalize_document_upload", { p_document_id: row.document_id, p_version_id: row.version_id });
  if (finalized.error) {
    await admin.storage.from(row.storage_bucket).remove([row.storage_path]);
    await supabase.rpc("fail_dispatch_invoice_processing", { p_invoice_id: row.invoice_id, p_reason: finalized.error.message.slice(0, 500) });
    return { status: "error" as const, message: invoiceError(finalized.error.message) };
  }
  const completed = await supabase.rpc("complete_dispatch_invoice_processing", { p_invoice_id: row.invoice_id, p_document_version_id: row.version_id, p_payload: processed.payload });
  if (completed.error) {
    await supabase.rpc("fail_dispatch_invoice_processing", { p_invoice_id: row.invoice_id, p_reason: completed.error.message.slice(0, 500) });
    return { status: "error" as const, message: invoiceError(completed.error.message) };
  }
  refresh(batchId, dispatchId);
  return { status: "success" as const, message: "Factura guardada y procesada.", invoiceId: String(row.invoice_id), warnings: processed.payload.warnings };
}

export async function reconcileDispatchAction(projectId: string, batchId: string, dispatchId: string) {
  if (![projectId, batchId, dispatchId].every((id) => UUID.test(id)) || !(await authorize(projectId, "invoice.match"))) return { status: "error" as const, message: "No tienes permiso para conciliar." };
  const { data, error } = await (await createClient()).rpc("reconcile_dispatch", { p_dispatch_id: dispatchId });
  if (error) return { status: "error" as const, message: invoiceError(error.message) };
  refresh(batchId, dispatchId);
  return { status: "success" as const, reconciliationStatus: String(data) };
}

export async function requestDispatchReinvoicingAction(_previous: BatchMutationState, formData: FormData): Promise<BatchMutationState> {
  const projectId = value(formData, "projectId"), batchId = value(formData, "batchId"), dispatchId = value(formData, "dispatchId");
  if (![projectId, batchId, dispatchId].every((id) => UUID.test(id)) || !(await authorize(projectId, "invoice.review"))) return { status: "error", message: "No tienes permiso para solicitar refacturación." };
  const { error } = await (await createClient()).rpc("request_dispatch_reinvoicing", { p_dispatch_id: dispatchId, p_reason: value(formData, "reason") });
  if (error) return { status: "error", message: invoiceError(error.message) };
  refresh(batchId, dispatchId);
  return { status: "success", message: "Refacturación solicitada; la factura anterior se conserva." };
}

export async function getInvoiceDownloadUrl(projectId: string, documentId: string) {
  if (!UUID.test(projectId) || !UUID.test(documentId) || !(await authorize(projectId, "invoice.view"))) return { status: "error" as const, message: "No tienes permiso para consultar el documento." };
  const admin = createAdminClient();
  const version = await admin.from("document_versions").select("storage_bucket, storage_path").eq("document_id", documentId).eq("upload_status", "UPLOADED").eq("is_current", true).maybeSingle();
  if (!version.data) return { status: "error" as const, message: "No se encontró el PDF." };
  const signed = await admin.storage.from(version.data.storage_bucket).createSignedUrl(version.data.storage_path, 120);
  return signed.data?.signedUrl ? { status: "success" as const, url: signed.data.signedUrl } : { status: "error" as const, message: "No fue posible abrir el PDF." };
}
