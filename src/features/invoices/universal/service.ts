import "server-only";

import { createHash } from "node:crypto";

import { extractMixtoListoInvoicePdf } from "@/features/batches/mixto-listo-extractor";
import { requireActiveProfile } from "@/features/auth/queries";
import { getOperationalProjectAccess } from "@/features/projects/queries";
import { addressesMatch } from "@/lib/address-identity";
import { normalizeBusinessIdentity, normalizeTaxIdentity } from "@/lib/business-identity";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { classifyInvoiceLines } from "../invoice-classification";
import { buildFiscalDocumentKey } from "../invoice-identity";
import {
  normalizeOperationalOrder,
  processExtractedInvoice,
  type InvoiceProcessingPayload,
} from "../invoice-processing";
import type { UniversalCommitResult, UniversalInvoiceResult } from "./types";

const MAX_PDF_SIZE = 10 * 1024 * 1024;
const REQUIRED_PERMISSIONS = [
  "invoice.universal",
  "invoice.view",
  "invoice.create",
  "invoice.match",
] as const;

type Selection = { projectId?: string | null; dispatchId?: string | null };
type InternalClassification = UniversalInvoiceResult & {
  payload: InvoiceProcessingPayload | null;
  fileSha256: string | null;
};

function result(
  file: File,
  input: Partial<InternalClassification> & Pick<InternalClassification, "status" | "message">,
): InternalClassification {
  return {
    status: input.status,
    message: input.message,
    fileName: file.name,
    fileSize: file.size,
    detectedType: input.detectedType ?? "UNKNOWN",
    invoiceNumber: input.invoiceNumber ?? null,
    orderNumber: input.orderNumber ?? null,
    projectId: input.projectId ?? null,
    projectLabel: input.projectLabel ?? null,
    dispatchId: input.dispatchId ?? null,
    dispatchLabel: input.dispatchLabel ?? null,
    batchId: input.batchId ?? null,
    batchLabel: input.batchLabel ?? null,
    candidateProjects: input.candidateProjects ?? [],
    candidateDispatches: input.candidateDispatches ?? [],
    warnings: input.warnings ?? [],
    payload: input.payload ?? null,
    fileSha256: input.fileSha256 ?? null,
  };
}

function publicResult(value: InternalClassification): UniversalInvoiceResult {
  return {
    status: value.status,
    message: value.message,
    fileName: value.fileName,
    fileSize: value.fileSize,
    detectedType: value.detectedType,
    invoiceNumber: value.invoiceNumber,
    orderNumber: value.orderNumber,
    projectId: value.projectId,
    projectLabel: value.projectLabel,
    dispatchId: value.dispatchId,
    dispatchLabel: value.dispatchLabel,
    batchId: value.batchId,
    batchLabel: value.batchLabel,
    candidateProjects: value.candidateProjects,
    candidateDispatches: value.candidateDispatches,
    warnings: value.warnings,
  };
}

function validPdf(file: File) {
  return file.size > 0 && file.size <= MAX_PDF_SIZE &&
    file.name.toLowerCase().endsWith(".pdf") &&
    (!file.type || file.type.toLowerCase() === "application/pdf");
}

async function authorizedScopes() {
  const profile = await requireActiveProfile();
  const scopes = await getOperationalProjectAccess(profile.id);
  return scopes.filter(({ project, permissions }) =>
    project.status === "ACTIVE" &&
    REQUIRED_PERMISSIONS.every((permission) => permissions.includes(permission)),
  );
}

async function classifyInternal(file: File, selection: Selection = {}): Promise<InternalClassification> {
  if (!validPdf(file)) {
    return result(file, { status: "INVALID_FILE", message: "Selecciona un PDF digital individual de hasta 10 MiB." });
  }
  const scopes = await authorizedScopes();
  if (!scopes.length) {
    return result(file, { status: "ERROR", message: "No tienes permisos para procesar Facturas Universal." });
  }

  let raw;
  let fileSha256: string;
  try {
    const buffer = await file.arrayBuffer();
    // unpdf may transfer (and detach) the ArrayBuffer while parsing it in its
    // worker. Read the bytes needed for the digest before handing it over.
    fileSha256 = createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
    raw = await extractMixtoListoInvoicePdf(buffer);
  } catch {
    return result(file, { status: "INVALID_FILE", message: "Formato no reconocido o PDF sin texto embebido." });
  }
  const detectedType = classifyInvoiceLines(raw.lines);
  const base = {
    detectedType,
    invoiceNumber: raw.invoice_number,
    orderNumber: normalizeOperationalOrder(raw.pca_original),
    fileSha256,
  };
  if (raw.detected_invoice_numbers.length > 1) {
    return result(file, { ...base, status: "INVALID_FILE", message: "El PDF contiene más de una factura." });
  }
  if (detectedType === "UNKNOWN") {
    return result(file, { ...base, status: "UNKNOWN_TYPE", message: "No fue posible clasificar la factura como Producto o Servicio." });
  }

  const addressMatches = scopes.filter(({ project }) =>
    addressesMatch(project.address, raw.shipping_address),
  );
  const namedMatches = addressMatches.filter(({ project }) =>
    normalizeBusinessIdentity(project.billingLegalName) ===
    normalizeBusinessIdentity(raw.billing_legal_name),
  );
  const candidates = (addressMatches.length > 1 && namedMatches.length === 1
    ? namedMatches
    : addressMatches);
  const selectedProject = selection.projectId
    ? addressMatches.find(({ project }) => project.id === selection.projectId)
    : candidates.length === 1 ? candidates[0] : null;
  const projectCandidates = addressMatches.map(({ project }) => ({
    id: project.id,
    label: `${project.code} · ${project.name}`,
  }));
  if (!selectedProject) {
    return result(file, {
      ...base,
      status: addressMatches.length ? "PROJECT_AMBIGUOUS" : "PROJECT_NOT_FOUND",
      message: addressMatches.length
        ? "Más de un proyecto autorizado coincide con la dirección. Selecciona uno."
        : "No existe un proyecto autorizado con esa Dirección exacta de Obra.",
      candidateProjects: projectCandidates,
    });
  }

  const project = selectedProject.project;
  const projectLabel = `${project.code} · ${project.name}`;
  const admin = createAdminClient();
  const fiscalDocumentKey = buildFiscalDocumentKey({
    issuerTaxId: raw.supplier_tax_id,
    authorizationNumber: raw.authorization_number,
    series: raw.series,
    invoiceNumber: raw.invoice_number,
  });
  if (fiscalDocumentKey) {
    const duplicate = await admin
      .from("invoices")
      .select("id, project_id, dispatch_id")
      .eq("fiscal_document_key", fiscalDocumentKey)
      .limit(1)
      .maybeSingle();
    if (duplicate.data) {
      return result(file, {
        ...base,
        projectId: project.id,
        projectLabel,
        status: "DUPLICATE",
        message: "Esta factura fiscal ya fue procesada anteriormente.",
      });
    }
  }
  const historicalInvoices = await admin
    .from("invoices")
    .select("id, supplier_id, status")
    .eq("invoice_number", raw.invoice_number)
    .is("fiscal_document_key", null)
    .limit(100);
  if (historicalInvoices.error) throw new Error("No fue posible verificar el historial fiscal.");
  const activeHistoricalInvoices = (historicalInvoices.data ?? []).filter((invoice) =>
    !["CANCELLED", "NON_PROCEEDING"].includes(String(invoice.status)),
  );
  if (activeHistoricalInvoices.length) {
    const historicalSupplierIds = [...new Set(activeHistoricalInvoices.map((invoice) => invoice.supplier_id))];
    const historicalSuppliers = await admin
      .from("suppliers")
      .select("id, tax_id")
      .in("id", historicalSupplierIds);
    if (historicalSuppliers.error) throw new Error("No fue posible verificar el emisor histórico.");
    const detectedIssuer = normalizeTaxIdentity(raw.supplier_tax_id);
    if ((historicalSuppliers.data ?? []).some((supplier) =>
      detectedIssuer && normalizeTaxIdentity(supplier.tax_id) === detectedIssuer,
    )) {
      return result(file, {
        ...base,
        projectId: project.id,
        projectLabel,
        status: "DUPLICATE",
        message: "Esta factura coincide con un registro fiscal histórico y requiere revisión.",
      });
    }
  }

  if (!base.orderNumber) {
    return result(file, { ...base, projectId: project.id, projectLabel, status: "DISPATCH_NOT_FOUND", message: "No se detectó un PCA con pedido válido." });
  }
  const dispatchResult = await admin
    .from("dispatches")
    .select("id, programming_id, supplier_id, order_number, real_volume, real_unit_code, status")
    .eq("project_id", project.id)
    .eq("status", "COMPLETED")
    .limit(2000);
  if (dispatchResult.error) throw new Error("No fue posible consultar los despachos autorizados.");
  const dispatchMatches = (dispatchResult.data ?? []).filter((dispatch) =>
    normalizeOperationalOrder(dispatch.order_number) === base.orderNumber,
  );
  const selectedDispatch = selection.dispatchId
    ? dispatchMatches.find((dispatch) => dispatch.id === selection.dispatchId)
    : dispatchMatches.length === 1 ? dispatchMatches[0] : null;
  const dispatchCandidates = dispatchMatches.map((dispatch) => ({
    id: dispatch.id,
    label: `Pedido ${dispatch.order_number ?? base.orderNumber} · ${dispatch.id.slice(0, 8)}`,
  }));
  if (!selectedDispatch) {
    return result(file, {
      ...base,
      projectId: project.id,
      projectLabel,
      candidateProjects: projectCandidates,
      candidateDispatches: dispatchCandidates,
      status: dispatchMatches.length ? "DISPATCH_AMBIGUOUS" : "DISPATCH_NOT_FOUND",
      message: dispatchMatches.length
        ? "Más de un despacho coincide con el pedido. Selecciona uno."
        : "No se encontró un despacho completado para el pedido detectado.",
    });
  }

  const relations = await admin
    .from("batch_dispatches")
    .select("batch_id")
    .eq("project_id", project.id)
    .eq("dispatch_id", selectedDispatch.id)
    .is("removed_at", null);
  const batchIds = [...new Set((relations.data ?? []).map((row) => row.batch_id))];
  const batches = batchIds.length
    ? await admin.from("batches").select("id, code, accounting_period, status").in("id", batchIds).eq("status", "OPEN")
    : { data: [], error: null };
  const openBatches = batches.data ?? [];
  if (openBatches.length !== 1) {
    return result(file, {
      ...base,
      projectId: project.id,
      projectLabel,
      dispatchId: selectedDispatch.id,
      dispatchLabel: `Pedido ${selectedDispatch.order_number}`,
      status: openBatches.length ? "DISPATCH_AMBIGUOUS" : "NO_ACTIVE_BATCH",
      message: openBatches.length
        ? "El despacho tiene más de un lote abierto activo y requiere revisión."
        : "El despacho no pertenece a un lote abierto activo.",
    });
  }
  const batch = openBatches[0];
  const supplier = await admin.from("suppliers").select("name, tax_id").eq("id", selectedDispatch.supplier_id).maybeSingle();
  if (!supplier.data) throw new Error("No se encontró el proveedor del despacho.");
  const processed = processExtractedInvoice(raw, {
    expectedType: detectedType,
    orderNumber: selectedDispatch.order_number ?? "",
    supplierName: supplier.data.name,
    supplierTaxId: supplier.data.tax_id,
    billingLegalName: project.billingLegalName,
    billingTaxId: project.billingTaxId,
    projectAddress: project.address,
    accountingPeriod: batch.accounting_period,
    realVolume: selectedDispatch.real_volume === null ? null : Number(selectedDispatch.real_volume),
    realUnitCode: selectedDispatch.real_unit_code,
  });
  if (processed.status === "error") {
    return result(file, {
      ...base,
      projectId: project.id,
      projectLabel,
      dispatchId: selectedDispatch.id,
      dispatchLabel: `Pedido ${selectedDispatch.order_number}`,
      batchId: batch.id,
      batchLabel: batch.code,
      status: "ERROR",
      message: [processed.message, ...processed.details].join(" "),
    });
  }
  return result(file, {
    ...base,
    projectId: project.id,
    projectLabel,
    dispatchId: selectedDispatch.id,
    dispatchLabel: `Pedido ${selectedDispatch.order_number}`,
    batchId: batch.id,
    batchLabel: batch.code,
    status: processed.payload.warnings.length ? "READY_WITH_DIFFERENCES" : "READY",
    message: processed.payload.warnings.length ? "Lista con observaciones." : "Lista para conciliar.",
    warnings: processed.payload.warnings,
    payload: { ...processed.payload, file_sha256: fileSha256 } as InvoiceProcessingPayload,
  });
}

export async function classifyUniversalInvoice(file: File, selection?: Selection) {
  return publicResult(await classifyInternal(file, selection));
}

export async function commitUniversalInvoice(file: File, selection?: Selection): Promise<UniversalCommitResult> {
  const classified = await classifyInternal(file, selection);
  if (!classified.payload || !classified.projectId || !classified.dispatchId || !classified.batchId ||
      !["READY", "READY_WITH_DIFFERENCES"].includes(classified.status)) {
    return { ...publicResult(classified), saved: false };
  }
  const supabase = await createClient();
  const prepared = await supabase.rpc("prepare_dispatch_invoice_upload_v2", {
    p_batch_id: classified.batchId,
    p_dispatch_id: classified.dispatchId,
    p_invoice_type: classified.detectedType,
    p_payload: classified.payload,
    p_file_name: file.name,
    p_file_size: file.size,
    p_replaces_invoice_id: null,
  });
  const row = prepared.data?.[0];
  if (prepared.error || !row) {
    const duplicate = prepared.error?.message.toUpperCase().includes("FISCAL_DOCUMENT_ALREADY_EXISTS");
    return { ...publicResult(classified), status: duplicate ? "DUPLICATE" : "ERROR", message: duplicate ? "Esta factura fiscal ya fue procesada anteriormente." : "No fue posible preparar la factura.", saved: false };
  }
  const admin = createAdminClient();
  const upload = await admin.storage.from(row.storage_bucket).upload(row.storage_path, file, { contentType: "application/pdf", upsert: false });
  if (upload.error) {
    await supabase.rpc("fail_document_upload", { p_document_id: row.document_id, p_version_id: row.version_id, p_reason: upload.error.message.slice(0, 500) });
    await supabase.rpc("fail_dispatch_invoice_processing", { p_invoice_id: row.invoice_id, p_reason: upload.error.message.slice(0, 500) });
    return { ...publicResult(classified), status: "ERROR", message: "No fue posible guardar el PDF.", saved: false };
  }
  const finalized = await supabase.rpc("finalize_document_upload", { p_document_id: row.document_id, p_version_id: row.version_id });
  if (finalized.error) {
    await admin.storage.from(row.storage_bucket).remove([row.storage_path]);
    await supabase.rpc("fail_dispatch_invoice_processing", { p_invoice_id: row.invoice_id, p_reason: finalized.error.message.slice(0, 500) });
    return { ...publicResult(classified), status: "ERROR", message: "No fue posible finalizar el documento.", saved: false };
  }
  const completed = await supabase.rpc("complete_dispatch_invoice_processing", {
    p_invoice_id: row.invoice_id,
    p_document_version_id: row.version_id,
    p_payload: classified.payload,
  });
  if (completed.error) {
    await supabase.rpc("fail_dispatch_invoice_processing", { p_invoice_id: row.invoice_id, p_reason: completed.error.message.slice(0, 500) });
    return { ...publicResult(classified), status: "ERROR", message: "El PDF se guardó, pero no pudo procesarse.", saved: false };
  }
  let reconciliationStatus: string | undefined;
  const warnings = [...classified.warnings];
  if (classified.detectedType === "PRODUCT") {
    const reconciled = await supabase.rpc("reconcile_dispatch", { p_dispatch_id: classified.dispatchId });
    if (reconciled.error) warnings.push("La factura se guardó, pero la conciliación debe reintentarse.");
    else reconciliationStatus = String(reconciled.data);
  }
  return {
    ...publicResult(classified),
    message: classified.detectedType === "PRODUCT"
      ? reconciliationStatus === "PENDING_REINVOICING"
        ? "Factura guardada; se detectaron diferencias y pasó automáticamente a refacturación."
        : "Factura guardada y conciliación ejecutada."
      : "Factura de Servicio guardada.",
    warnings,
    saved: true,
    invoiceId: String(row.invoice_id),
    reconciliationStatus,
  };
}
