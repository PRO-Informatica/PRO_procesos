"use server";

import { revalidatePath } from "next/cache";

import { requireActiveProfile } from "@/features/auth/queries";
import { getProjectContext } from "@/features/projects/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { extractMixtoListoInvoicePdf } from "./mixto-listo-extractor";
import { orderNumberFromMixtoListoPca } from "./mixto-listo-parser";
import type {
  BatchMutationState,
  InvoiceExtractionPayload,
  InvoiceUploadLine,
  InvoiceUploadResult,
  InvoiceType,
  MixtoListoExtractionPreview,
  MixtoListoInvoiceLine,
  MixtoListoUploadResult,
} from "./types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  )
    return null;
  return context;
}

function batchError(message: string) {
  const value = message.toUpperCase();
  if (
    value.includes("BATCH_WEEK_ALREADY_EXISTS") ||
    value.includes("BATCH_WEEK_OR_CODE_ALREADY_EXISTS")
  )
    return "Ya existe un lote para esa semana o código.";
  if (value.includes("BATCH_PERIOD_MUST_BE_MONDAY_TO_SUNDAY"))
    return "La semana debe iniciar lunes y finalizar domingo.";
  if (value.includes("BATCH_GUIDE_DATE_OUTSIDE_WEEK"))
    return "La fecha de la guía no pertenece a la semana del lote.";
  if (value.includes("BATCH_GUIDE_OPERATION_NOT_DISPATCHED"))
    return "Una operación no despachada no puede agregarse al lote.";
  if (value.includes("GUIDE_ALREADY_IN_ACTIVE_BATCH"))
    return "La guía ya tiene una relación activa con otro lote.";
  if (value.includes("BATCH_NOT_EDITABLE"))
    return "El lote ya no permite cambios manuales.";
  if (value.includes("BATCH_GUIDE_REMOVAL_REASON_INVALID"))
    return "Indica un motivo válido para remover la guía.";
  if (value.includes("WEEKLY_BATCH_ROLLOVER_STATE_INVALID"))
    return "Solo un lote en preparación puede cerrar su semana.";
  if (value.includes("PERMISSION_DENIED"))
    return "No tienes permiso para realizar esta operación.";
  return "No fue posible completar la operación del lote.";
}

function refresh(batchId?: string) {
  revalidatePath("/batches");
  if (batchId) revalidatePath(`/batches/${batchId}`);
  revalidatePath("/dispatches");
}

function refreshOrder(batchId: string, orderId?: string) {
  refresh(batchId);
  if (orderId) revalidatePath(`/batches/${batchId}/orders/${orderId}`);
}

function invoiceError(message: string) {
  const value = message.toUpperCase();
  if (
    value.includes("UQ_INVOICE_SUPPLIER_SERIES_NUMBER") ||
    value.includes("DUPLICATE KEY VALUE")
  )
    return "Ese número de factura ya está registrado para el proveedor. Elimina este intento pendiente y carga la factura correcta.";
  if (value.includes("MIXTO_LISTO_ORDER_MISMATCH"))
    return "La factura cargada corresponde a otro Pedido. Carga la factura correcta o corrige el PCA si la extracción fue incorrecta.";
  if (
    value.includes("MIXTO_LISTO_INVOICE_PDF_REQUIRED") ||
    value.includes("INVOICE_DOCUMENT_PDF_REQUIRED")
  )
    return "El intake de facturas Mixto Listo acepta únicamente archivos PDF.";
  if (value.includes("MIXTO_LISTO_PCA_ORDER_NOT_DETECTED"))
    return "No fue posible detectar el Pedido desde el PCA. Corrige la extracción antes de confirmar.";
  if (value.includes("MIXTO_LISTO_PCA_CORRECTION_REASON_REQUIRED"))
    return "Para cambiar el PCA selecciona un motivo de corrección de PCA o campo no detectado.";
  if (value.includes("EXTRACTION_CORRECTION_COMMENT_REQUIRED"))
    return "Describe la corrección cuando seleccionas Otro.";
  if (value.includes("ACCOUNTING_PERIOD"))
    return "La fecha de factura debe pertenecer al período contable del lote.";
  if (value.includes("GUIDE_BATCH_CONTEXT"))
    return "Las guías deben estar activas en este lote y pertenecer al mismo proveedor.";
  if (value.includes("EXTRACTION_CORRECTION_REASON_REQUIRED"))
    return "Selecciona un motivo y explica la corrección de extracción.";
  if (value.includes("EXTRACTION_NOT_CONFIRMED"))
    return "Confirma o corrige primero la extracción documental.";
  if (value.includes("NOT_READY_FOR_RECONCILIATION"))
    return "La factura todavía no está lista para conciliar.";
  if (value.includes("PERMISSION_DENIED"))
    return "No tienes permiso para gestionar esta factura.";
  if (value.includes("RECONCILIATION_ORDER_ALREADY_COMPLETED"))
    return "El Pedido ya está completado y no admite nuevas facturas.";
  if (value.includes("SERVICE_INVOICE_CONTEXT_INVALID"))
    return "La factura de servicio no pertenece a este Pedido.";
  if (
    value.includes("INVOICE_TOTALS") ||
    value.includes("INVOICE_EXTRACTION_FIELDS")
  )
    return "Revisa número, moneda y totales de la factura.";
  if (value.includes("INVOICE_LINES") || value.includes("INVOICE_LINE"))
    return "Agrega al menos una línea válida con cantidad mayor que cero.";
  return "No fue posible completar la operación de factura.";
}

export type PrepareMixtoListoInvoiceInput = {
  projectId: string;
  batchId: string;
  orderId: string;
  invoiceType: InvoiceType;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  subtotal: number;
  total: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  replacesInvoiceId?: string;
};

export async function inspectMixtoListoInvoicePdf(
  projectId: string,
  orderId: string,
  formData: FormData,
) {
  if (!UUID.test(projectId) || !UUID.test(orderId)) {
    return {
      status: "error" as const,
      message: "Selecciona un pedido válido.",
    };
  }
  if (!(await authorize(projectId, "invoice.create"))) {
    return {
      status: "error" as const,
      message: "No tienes permiso para registrar facturas.",
    };
  }
  const file = formData.get("file");
  if (
    !(file instanceof File) ||
    file.type.toLowerCase() !== "application/pdf" ||
    !file.name.toLowerCase().endsWith(".pdf") ||
    file.size <= 0 ||
    file.size > 10 * 1024 * 1024
  ) {
    return {
      status: "error" as const,
      message: "Selecciona un PDF Mixto Listo de hasta 10 MiB.",
    };
  }
  const orderResult = await createAdminClient()
    .from("reconciliation_orders")
    .select("normalized_order_number")
    .eq("id", orderId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (orderResult.error || !orderResult.data) {
    return {
      status: "error" as const,
      message: "No fue posible validar el Pedido actual.",
    };
  }
  try {
    const extracted = await extractMixtoListoInvoicePdf(
      await file.arrayBuffer(),
    );
    if (
      !extracted.invoice_number ||
      !extracted.invoice_date ||
      !extracted.currency ||
      !(extracted.subtotal && extracted.subtotal > 0) ||
      !(extracted.total && extracted.total > 0)
    ) {
      return {
        status: "error" as const,
        message:
          "No se pudieron extraer número, fecha, moneda y total del PDF Mixto Listo.",
      };
    }
    const detectedOrderNumber = orderNumberFromMixtoListoPca(
      extracted.pca_original,
    );
    return {
      status: "success" as const,
      metadata: {
        invoiceType: "PRODUCT" as InvoiceType,
        invoiceNumber: extracted.invoice_number,
        invoiceDate: extracted.invoice_date,
        currency: extracted.currency,
        subtotal: extracted.subtotal,
        total: extracted.total,
        pcaOriginal: extracted.pca_original,
        detectedOrderNumber,
        expectedOrderNumber: orderResult.data.normalized_order_number,
      },
    };
  } catch {
    return {
      status: "error" as const,
      message: "No fue posible leer el contenido del PDF Mixto Listo.",
    };
  }
}

export async function prepareMixtoListoInvoiceUpload(
  input: PrepareMixtoListoInvoiceInput,
): Promise<MixtoListoUploadResult> {
  if (
    ![input.projectId, input.batchId, input.orderId].every((value) =>
      UUID.test(value),
    ) ||
    (input.replacesInvoiceId && !UUID.test(input.replacesInvoiceId))
  ) {
    return { status: "error", message: "Selecciona un pedido válido." };
  }
  if (
    input.mimeType.toLowerCase() !== "application/pdf" ||
    !input.fileName.toLowerCase().endsWith(".pdf")
  ) {
    return {
      status: "error",
      message:
        "El intake de facturas Mixto Listo acepta únicamente archivos PDF.",
    };
  }
  if (
    !Number.isInteger(input.fileSize) ||
    input.fileSize <= 0 ||
    input.fileSize > 10 * 1024 * 1024
  ) {
    return { status: "error", message: "Selecciona un PDF de hasta 10 MiB." };
  }
  if (!(await authorize(input.projectId, "invoice.create"))) {
    return {
      status: "error",
      message: "No tienes permiso para registrar facturas.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "prepare_mixto_listo_invoice_intake",
    {
      p_reconciliation_order_id: input.orderId,
      p_invoice_type: input.invoiceType,
      p_invoice_number: input.invoiceNumber,
      p_invoice_date: input.invoiceDate,
      p_currency: input.currency,
      p_subtotal: input.subtotal,
      p_total: input.total,
      p_file_name: input.fileName,
      p_file_size: input.fileSize,
      p_replaces_invoice_id: input.replacesInvoiceId || null,
    },
  );
  if (error || !data?.[0]) {
    return {
      status: "error",
      message: invoiceError(error?.message ?? "MIXTO_LISTO_PREPARE_FAILED"),
    };
  }
  const prepared = data[0];
  const signed = await createAdminClient()
    .storage.from(prepared.storage_bucket)
    .createSignedUploadUrl(prepared.storage_path, { upsert: false });
  if (signed.error || !signed.data?.token) {
    await supabase.rpc("fail_mixto_listo_invoice_upload", {
      p_intake_id: prepared.intake_id,
      p_document_id: prepared.document_id,
      p_version_id: prepared.version_id,
      p_reason: "No fue posible crear la URL firmada de factura.",
    });
    return {
      status: "error",
      message: "No fue posible preparar la carga privada.",
    };
  }
  return {
    status: "success",
    intakeId: prepared.intake_id,
    upload: {
      documentId: prepared.document_id,
      versionId: prepared.version_id,
      bucket: prepared.storage_bucket,
      path: prepared.storage_path,
      token: signed.data.token,
    },
  };
}

export async function failMixtoListoInvoiceUpload(input: {
  projectId: string;
  intakeId: string;
  documentId: string;
  versionId: string;
  reason: string;
}) {
  if (
    ![input.projectId, input.intakeId, input.documentId, input.versionId].every(
      (value) => UUID.test(value),
    ) ||
    !(await authorize(input.projectId, "invoice.create"))
  )
    return;
  await (
    await createClient()
  ).rpc("fail_mixto_listo_invoice_upload", {
    p_intake_id: input.intakeId,
    p_document_id: input.documentId,
    p_version_id: input.versionId,
    p_reason: input.reason.slice(0, 500),
  });
}

export async function finalizeAndExtractMixtoListoInvoice(input: {
  projectId: string;
  batchId: string;
  orderId: string;
  intakeId: string;
  documentId: string;
  versionId: string;
}): Promise<
  | { status: "success"; preview: MixtoListoExtractionPreview }
  | { status: "error"; message: string }
> {
  if (
    ![
      input.projectId,
      input.batchId,
      input.orderId,
      input.intakeId,
      input.documentId,
      input.versionId,
    ].every((value) => UUID.test(value))
  ) {
    return { status: "error", message: "Carga de factura inválida." };
  }
  if (!(await authorize(input.projectId, "invoice.create"))) {
    return {
      status: "error",
      message: "No tienes permiso para registrar facturas.",
    };
  }
  const supabase = await createClient();
  const { error: finalizeError } = await supabase.rpc(
    "finalize_mixto_listo_invoice_upload",
    {
      p_intake_id: input.intakeId,
      p_document_id: input.documentId,
      p_version_id: input.versionId,
    },
  );
  if (finalizeError)
    return { status: "error", message: invoiceError(finalizeError.message) };

  const admin = createAdminClient();
  const [intakeResult, versionResult] = await Promise.all([
    admin
      .from("mixto_listo_invoice_intakes")
      .select("id, project_id, reconciliation_order_id")
      .eq("id", input.intakeId)
      .eq("project_id", input.projectId)
      .eq("reconciliation_order_id", input.orderId)
      .eq("document_id", input.documentId)
      .maybeSingle(),
    admin
      .from("document_versions")
      .select("storage_bucket, storage_path")
      .eq("id", input.versionId)
      .eq("document_id", input.documentId)
      .eq("upload_status", "UPLOADED")
      .eq("is_current", true)
      .maybeSingle(),
  ]);
  if (
    intakeResult.error ||
    !intakeResult.data ||
    versionResult.error ||
    !versionResult.data
  ) {
    return {
      status: "error",
      message: "El PDF quedó seguro, pero el intake no pudo verificarse.",
    };
  }
  const downloaded = await admin.storage
    .from(versionResult.data.storage_bucket)
    .download(versionResult.data.storage_path);
  if (downloaded.error || !downloaded.data) {
    return {
      status: "error",
      message: "El PDF quedó seguro, pero no pudo leerse para extracción.",
    };
  }

  let extracted: {
    observations_raw: string | null;
    pca_original: string | null;
    lines: MixtoListoInvoiceLine[];
  };
  try {
    extracted = await extractMixtoListoInvoicePdf(
      await downloaded.data.arrayBuffer(),
    );
  } catch {
    extracted = { observations_raw: null, pca_original: null, lines: [] };
  }
  const registration = await admin.rpc(
    "register_mixto_listo_invoice_extraction",
    {
      p_intake_id: input.intakeId,
      p_document_version_id: input.versionId,
      p_extracted_payload: extracted,
      p_provider_key: "MIXTO_LISTO_PDF_TEXT_V1",
    },
  );
  if (registration.error || !registration.data) {
    return {
      status: "error",
      message:
        "El PDF quedó seguro, pero no se pudo registrar la extracción Mixto Listo.",
    };
  }
  const { data: intake, error: previewError } = await admin
    .from("mixto_listo_invoice_intakes")
    .select(
      "status, observations_raw, pca_original, detected_order_number, reconciliation_orders!inner(normalized_order_number)",
    )
    .eq("id", input.intakeId)
    .eq("project_id", input.projectId)
    .eq("reconciliation_order_id", input.orderId)
    .single();
  if (previewError || !intake)
    return {
      status: "error",
      message: "La extracción se registró, pero no pudo cargarse el preview.",
    };
  const orderRelation = Array.isArray(intake.reconciliation_orders)
    ? intake.reconciliation_orders[0]
    : intake.reconciliation_orders;
  return {
    status: "success",
    preview: {
      intakeId: input.intakeId,
      extractionId: String(registration.data),
      expectedOrderNumber: String(orderRelation?.normalized_order_number ?? ""),
      status: intake.status,
      observationsRaw: intake.observations_raw,
      pcaOriginal: intake.pca_original,
      detectedOrderNumber: intake.detected_order_number,
      lines: extracted.lines,
    },
  };
}

export async function confirmMixtoListoInvoice(input: {
  projectId: string;
  batchId: string;
  orderId: string;
  intakeId: string;
  pcaOriginal: string;
  lines: MixtoListoInvoiceLine[];
  correctionReasonId?: string;
  correctionNotes?: string;
}) {
  if (
    ![input.projectId, input.batchId, input.orderId, input.intakeId].every(
      (value) => UUID.test(value),
    ) ||
    (input.correctionReasonId && !UUID.test(input.correctionReasonId))
  ) {
    return {
      status: "error" as const,
      message: "Confirmación de factura inválida.",
    };
  }
  if (!(await authorize(input.projectId, "invoice.match"))) {
    return {
      status: "error" as const,
      message: "No tienes permiso para confirmar la extracción.",
    };
  }
  if (
    !input.pcaOriginal.trim() ||
    !input.lines.length ||
    input.lines.some(
      (line) =>
        !(line.quantity > 0) ||
        !line.unit_code.trim() ||
        !line.code.trim() ||
        !line.description.trim(),
    )
  ) {
    return {
      status: "error" as const,
      message:
        "Completa PCA, cantidad, medida, código y descripción antes de confirmar.",
    };
  }
  const { data, error } = await (
    await createClient()
  ).rpc("confirm_mixto_listo_invoice_intake", {
    p_intake_id: input.intakeId,
    p_pca_original: input.pcaOriginal,
    p_lines: input.lines,
    p_correction_reason_id: input.correctionReasonId || null,
    p_correction_notes: input.correctionNotes?.trim() || null,
  });
  if (error)
    return { status: "error" as const, message: invoiceError(error.message) };
  refreshOrder(input.batchId, input.orderId);
  return { status: "success" as const, invoiceId: String(data) };
}

export async function discardMixtoListoInvoiceIntake(input: {
  projectId: string;
  batchId: string;
  orderId: string;
  intakeId: string;
}) {
  if (
    ![input.projectId, input.batchId, input.orderId, input.intakeId].every(
      (value) => UUID.test(value),
    )
  ) {
    return {
      status: "error" as const,
      message: "La factura pendiente seleccionada no es válida.",
    };
  }
  if (!(await authorize(input.projectId, "invoice.create"))) {
    return {
      status: "error" as const,
      message: "No tienes permiso para eliminar facturas pendientes.",
    };
  }

  const { error } = await (
    await createClient()
  ).rpc("discard_mixto_listo_invoice_intake", {
    p_intake_id: input.intakeId,
    p_reason: "Factura pendiente eliminada por el usuario desde el Pedido.",
  });
  if (error) {
    const value = error.message.toUpperCase();
    if (value.includes("CONFIRMED_INTAKE_NOT_DISCARDABLE")) {
      return {
        status: "error" as const,
        message: "La factura ya fue confirmada y no puede eliminarse.",
      };
    }
    if (value.includes("MIXTO_LISTO_INTAKE_NOT_FOUND")) {
      return {
        status: "error" as const,
        message: "La factura pendiente ya no existe.",
      };
    }
    if (value.includes("PERMISSION_DENIED")) {
      return {
        status: "error" as const,
        message: "No tienes permiso para eliminar esta factura pendiente.",
      };
    }
    return {
      status: "error" as const,
      message: "No fue posible eliminar la factura pendiente.",
    };
  }

  refreshOrder(input.batchId, input.orderId);
  return { status: "success" as const };
}

export type PrepareInvoiceUploadInput = {
  projectId: string;
  batchId: string;
  invoiceType: InvoiceType;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  subtotal: number;
  total: number;
  orderId?: string;
  guideIds?: string[];
  lines: InvoiceUploadLine[];
  fileName: string;
  mimeType: string;
  fileSize: number;
  replacesInvoiceId?: string;
  pcaOriginal?: string;
};

export async function prepareInvoiceUpload(
  input: PrepareInvoiceUploadInput,
): Promise<InvoiceUploadResult> {
  if (
    !UUID.test(input.projectId) ||
    !UUID.test(input.batchId) ||
    (!input.orderId && !input.guideIds?.length) ||
    (input.orderId && !UUID.test(input.orderId))
  ) {
    return { status: "error", message: "Selecciona un pedido válido." };
  }
  if (!(await authorize(input.projectId, "invoice.create"))) {
    return {
      status: "error",
      message: "No tienes permiso para registrar facturas.",
    };
  }
  const supabase = await createClient();
  const request = input.orderId
    ? await supabase.rpc("prepare_order_invoice_upload", {
        p_reconciliation_order_id: input.orderId,
        p_invoice_type: input.invoiceType,
        p_invoice_number: input.invoiceNumber,
        p_invoice_date: input.invoiceDate,
        p_currency: input.currency,
        p_subtotal: input.subtotal,
        p_total: input.total,
        p_lines: input.lines,
        p_file_name: input.fileName,
        p_mime_type: input.mimeType,
        p_file_size: input.fileSize,
        p_pca_original: input.pcaOriginal || null,
        p_replaces_invoice_id: input.replacesInvoiceId || null,
      })
    : await supabase.rpc("prepare_batch_invoice_upload", {
        p_batch_id: input.batchId,
        p_invoice_type: input.invoiceType,
        p_invoice_number: input.invoiceNumber,
        p_invoice_date: input.invoiceDate,
        p_currency: input.currency,
        p_subtotal: input.subtotal,
        p_total: input.total,
        p_guide_ids: input.guideIds ?? [],
        p_lines: input.lines,
        p_file_name: input.fileName,
        p_mime_type: input.mimeType,
        p_file_size: input.fileSize,
        p_replaces_invoice_id: input.replacesInvoiceId || null,
      });
  const { data, error } = request;
  if (error || !data?.[0])
    return {
      status: "error",
      message: invoiceError(error?.message ?? "INVOICE_PREPARE_FAILED"),
    };
  const prepared = data[0];
  const signed = await createAdminClient()
    .storage.from(prepared.storage_bucket)
    .createSignedUploadUrl(prepared.storage_path, { upsert: false });
  if (signed.error || !signed.data?.token) {
    await supabase.rpc("fail_document_upload", {
      p_document_id: prepared.document_id,
      p_version_id: prepared.version_id,
      p_reason: "No fue posible crear la URL firmada de factura.",
    });
    return {
      status: "error",
      message: "No fue posible preparar la carga privada.",
    };
  }
  return {
    status: "success",
    invoiceId: prepared.invoice_id,
    upload: {
      documentId: prepared.document_id,
      versionId: prepared.version_id,
      bucket: prepared.storage_bucket,
      path: prepared.storage_path,
      token: signed.data.token,
    },
  };
}

export async function finalizeInvoiceUpload(input: {
  projectId: string;
  batchId: string;
  invoiceId: string;
  documentId: string;
  versionId: string;
  proposal: InvoiceExtractionPayload;
}) {
  if (
    ![
      input.projectId,
      input.batchId,
      input.invoiceId,
      input.documentId,
      input.versionId,
    ].every((value) => UUID.test(value))
  ) {
    return { status: "error" as const, message: "Carga de factura inválida." };
  }
  if (!(await authorize(input.projectId, "invoice.create")))
    return {
      status: "error" as const,
      message: "Sin permiso para registrar facturas.",
    };
  const supabase = await createClient();
  const finalized = await supabase.rpc("finalize_document_upload", {
    p_document_id: input.documentId,
    p_version_id: input.versionId,
  });
  if (finalized.error)
    return {
      status: "error" as const,
      message: "El archivo subió, pero no pudo validarse.",
    };
  const extraction = await createAdminClient().rpc(
    "register_invoice_extraction_proposal",
    {
      p_invoice_id: input.invoiceId,
      p_document_version_id: input.versionId,
      p_normalized_payload: input.proposal,
      p_provider_key: "MANUAL_ASSISTED",
    },
  );
  if (extraction.error)
    return {
      status: "error" as const,
      message:
        "El documento quedó seguro, pero no se creó la propuesta de extracción.",
    };
  refresh(input.batchId);
  return { status: "success" as const, extractionId: String(extraction.data) };
}

export async function failInvoiceUpload(
  projectId: string,
  documentId: string,
  versionId: string,
  reason: string,
) {
  if (
    ![projectId, documentId, versionId].every((value) => UUID.test(value)) ||
    !(await authorize(projectId, "invoice.create"))
  )
    return;
  await (
    await createClient()
  ).rpc("fail_document_upload", {
    p_document_id: documentId,
    p_version_id: versionId,
    p_reason: reason.slice(0, 500),
  });
}

export async function startOrderValidation(input: {
  projectId: string;
  batchId: string;
  orderId: string;
}) {
  if (
    ![input.projectId, input.batchId, input.orderId].every((value) =>
      UUID.test(value),
    ) ||
    !(await authorize(input.projectId, "invoice.match"))
  )
    return {
      status: "error" as const,
      message: "No tienes permiso para validar este Pedido.",
    };
  const { error } = await (await createClient()).rpc(
    "start_reconciliation_order_validation",
    { p_reconciliation_order_id: input.orderId },
  );
  if (error)
    return { status: "error" as const, message: invoiceError(error.message) };
  refreshOrder(input.batchId, input.orderId);
  return { status: "success" as const };
}

export async function prepareOrderServiceInvoiceUpload(input: {
  projectId: string;
  batchId: string;
  orderId: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  subtotal: number;
  total: number;
  fileName: string;
  fileSize: number;
  replacesInvoiceId?: string;
}): Promise<InvoiceUploadResult> {
  if (
    ![input.projectId, input.batchId, input.orderId].every((value) =>
      UUID.test(value),
    ) ||
    (input.replacesInvoiceId && !UUID.test(input.replacesInvoiceId)) ||
    !input.fileName.toLowerCase().endsWith(".pdf") ||
    !Number.isInteger(input.fileSize) ||
    input.fileSize <= 0 ||
    input.fileSize > 10 * 1024 * 1024
  )
    return { status: "error", message: "Selecciona un PDF válido de hasta 10 MiB." };
  if (!(await authorize(input.projectId, "invoice.create")))
    return { status: "error", message: "No tienes permiso para registrar facturas." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "prepare_order_service_invoice_upload",
    {
      p_reconciliation_order_id: input.orderId,
      p_invoice_number: input.invoiceNumber,
      p_invoice_date: input.invoiceDate,
      p_currency: input.currency,
      p_subtotal: input.subtotal,
      p_total: input.total,
      p_file_name: input.fileName,
      p_file_size: input.fileSize,
      p_replaces_invoice_id: input.replacesInvoiceId || null,
    },
  );
  if (error || !data?.[0])
    return { status: "error", message: invoiceError(error?.message ?? "SERVICE_PREPARE_FAILED") };
  const prepared = data[0];
  const signed = await createAdminClient()
    .storage.from(prepared.storage_bucket)
    .createSignedUploadUrl(prepared.storage_path, { upsert: false });
  if (signed.error || !signed.data?.token) {
    await supabase.rpc("fail_document_upload", {
      p_document_id: prepared.document_id,
      p_version_id: prepared.version_id,
      p_reason: "No fue posible crear la URL firmada de factura de servicio.",
    });
    return { status: "error", message: "No fue posible preparar la carga privada." };
  }
  return {
    status: "success",
    invoiceId: prepared.invoice_id,
    upload: {
      documentId: prepared.document_id,
      versionId: prepared.version_id,
      bucket: prepared.storage_bucket,
      path: prepared.storage_path,
      token: signed.data.token,
    },
  };
}

export async function finalizeOrderServiceInvoiceUpload(input: {
  projectId: string;
  batchId: string;
  orderId: string;
  invoiceId: string;
  documentId: string;
  versionId: string;
}) {
  if (
    !Object.values(input).every((value) => UUID.test(value)) ||
    !(await authorize(input.projectId, "invoice.create"))
  )
    return { status: "error" as const, message: "Carga de servicio inválida." };
  const { error } = await (await createClient()).rpc(
    "finalize_order_service_invoice_upload",
    {
      p_invoice_id: input.invoiceId,
      p_document_id: input.documentId,
      p_version_id: input.versionId,
    },
  );
  if (error)
    return { status: "error" as const, message: invoiceError(error.message) };
  refreshOrder(input.batchId, input.orderId);
  return { status: "success" as const };
}

export async function requestOrderProductReinvoicing(input: {
  projectId: string;
  batchId: string;
  orderId: string;
  invoiceId: string;
}) {
  if (
    !Object.values(input).every((value) => UUID.test(value)) ||
    !(await authorize(input.projectId, "invoice.match"))
  )
    return { status: "error" as const, message: "No tienes permiso para solicitar refacturación." };
  const { error } = await (await createClient()).rpc(
    "request_order_product_reinvoicing",
    {
      p_reconciliation_order_id: input.orderId,
      p_invoice_id: input.invoiceId,
    },
  );
  if (error)
    return { status: "error" as const, message: invoiceError(error.message) };
  refreshOrder(input.batchId, input.orderId);
  return { status: "success" as const };
}

export async function getInvoiceDownloadUrl(
  projectId: string,
  documentId: string,
) {
  if (
    !UUID.test(projectId) ||
    !UUID.test(documentId) ||
    !(await authorize(projectId, "invoice.view"))
  ) {
    return {
      status: "error" as const,
      message: "No tienes acceso a este documento.",
    };
  }
  const { data, error } = await createAdminClient()
    .from("document_versions")
    .select("storage_bucket, storage_path")
    .eq("document_id", documentId)
    .eq("upload_status", "UPLOADED")
    .eq("is_current", true)
    .maybeSingle();
  if (error || !data)
    return {
      status: "error" as const,
      message: "No hay una versión disponible.",
    };
  const signed = await createAdminClient()
    .storage.from(data.storage_bucket)
    .createSignedUrl(data.storage_path, 300);
  if (signed.error || !signed.data)
    return {
      status: "error" as const,
      message: "No fue posible preparar la descarga.",
    };
  return { status: "success" as const, url: signed.data.signedUrl };
}

export async function confirmInvoiceExtraction(input: {
  projectId: string;
  batchId: string;
  orderId?: string;
  invoiceId?: string;
  orderNumber?: string;
  pcaOriginal?: string;
  extractionId: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  subtotal: number;
  total: number;
  lines: InvoiceUploadLine[];
  correctionReasonId?: string;
  correctionNotes?: string;
}) {
  if (
    ![input.projectId, input.batchId, input.extractionId].every((value) =>
      UUID.test(value),
    ) ||
    !(await authorize(input.projectId, "invoice.match"))
  ) {
    return {
      status: "error" as const,
      message: "No tienes permiso para confirmar la extracción.",
    };
  }
  const { data, error } = await (
    await createClient()
  ).rpc("confirm_invoice_extraction", {
    p_extraction_id: input.extractionId,
    p_invoice_number: input.invoiceNumber,
    p_invoice_date: input.invoiceDate,
    p_currency: input.currency,
    p_subtotal: input.subtotal,
    p_total: input.total,
    p_lines: input.lines,
    p_correction_reason_id: input.correctionReasonId || null,
    p_correction_notes: input.correctionNotes || null,
  });
  if (error)
    return { status: "error" as const, message: invoiceError(error.message) };
  if (input.invoiceId && input.orderNumber) {
    const assigned = await (
      await createClient()
    ).rpc("assign_invoice_to_reconciliation_order", {
      p_invoice_id: input.invoiceId,
      p_batch_id: input.batchId,
      p_order_reference: input.orderNumber,
      p_pca_original: input.pcaOriginal || null,
    });
    if (assigned.error)
      return {
        status: "error" as const,
        message: invoiceError(assigned.error.message),
      };
  }
  refreshOrder(input.batchId, input.orderId);
  return { status: "success" as const, verificationStatus: String(data) };
}

export async function reconcileInvoice(
  projectId: string,
  batchId: string,
  invoiceId: string,
) {
  if (
    ![projectId, batchId, invoiceId].every((value) => UUID.test(value)) ||
    !(await authorize(projectId, "invoice.match"))
  ) {
    return {
      status: "error" as const,
      message: "No tienes permiso para conciliar facturas.",
    };
  }
  const { data, error } = await (
    await createClient()
  ).rpc("reconcile_batch_invoice", {
    p_batch_id: batchId,
    p_invoice_id: invoiceId,
  });
  if (error)
    return { status: "error" as const, message: invoiceError(error.message) };
  refresh(batchId);
  return {
    status: "success" as const,
    result: data as Record<string, unknown>,
  };
}

export async function recalculateOrder(input: {
  projectId: string;
  batchId: string;
  orderId: string;
  invoiceId: string;
}) {
  if (
    ![input.projectId, input.batchId, input.orderId, input.invoiceId].every(
      (value) => UUID.test(value),
    ) ||
    !(await authorize(input.projectId, "invoice.match"))
  ) {
    return {
      status: "error" as const,
      message: "No tienes permiso para conciliar el pedido.",
    };
  }
  const { data, error } = await (
    await createClient()
  ).rpc("reconcile_batch_invoice", {
    p_batch_id: input.batchId,
    p_invoice_id: input.invoiceId,
  });
  if (error)
    return { status: "error" as const, message: invoiceError(error.message) };
  refreshOrder(input.batchId, input.orderId);
  return {
    status: "success" as const,
    result: data as Record<string, unknown>,
  };
}

export async function closeReconciliationOrder(input: {
  projectId: string;
  batchId: string;
  orderId: string;
  expectedVersion: number;
}) {
  if (
    ![input.projectId, input.batchId, input.orderId].every((value) =>
      UUID.test(value),
    ) ||
    !(await authorize(input.projectId, "invoice.match"))
  ) {
    return {
      status: "error" as const,
      message: "No tienes permiso para cerrar el expediente del pedido.",
    };
  }
  const { data, error } = await (
    await createClient()
  ).rpc("close_reconciliation_order", {
    p_reconciliation_order_id: input.orderId,
    p_expected_version: input.expectedVersion,
  });
  if (error) {
    const conflict = error.message.includes(
      "RECONCILIATION_ORDER_VERSION_CONFLICT",
    );
    return {
      status: "error" as const,
      message: conflict
        ? "El pedido cambió. Recarga antes de cerrar para no sobrescribir cambios."
        : invoiceError(error.message),
      conflict,
    };
  }
  refreshOrder(input.batchId, input.orderId);
  return { status: "success" as const, version: Number(data) };
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
    return {
      status: "error",
      message: "Completa el código y la semana del lote.",
    };
  }
  if (!(await authorize(projectId, "batch.create"))) {
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
  return {
    status: "success",
    batchId,
    message: "Lote semanal creado correctamente.",
  };
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
  if (!(await authorize(projectId, "batch.add_guide"))) {
    return {
      status: "error",
      message: "No tienes permiso para agregar guías.",
    };
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
  if (
    ![projectId, batchId, guideId].every((value) => UUID.test(value)) ||
    !reason
  ) {
    return {
      status: "error",
      message: "Indica un motivo para remover la guía.",
    };
  }
  if (!(await authorize(projectId, "batch.modify"))) {
    return {
      status: "error",
      message: "No tienes permiso para modificar el lote.",
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_guide_from_batch", {
    p_batch_id: batchId,
    p_guide_id: guideId,
    p_reason: reason,
  });
  if (error) return { status: "error", message: batchError(error.message) };
  refresh(batchId);
  return {
    status: "success",
    batchId,
    message: "Guía removida; el historial se conservó.",
  };
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
  if (!(await authorize(projectId, "batch.modify"))) {
    return {
      status: "error",
      message: "No tienes permiso para cerrar la semana.",
    };
  }
  const userClient = await createClient();
  const { data: batch } = await userClient
    .from("batches")
    .select("id, project_id, status")
    .eq("id", batchId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!batch || batch.status !== "ASSEMBLING") {
    return {
      status: "error",
      message: "El lote ya no está disponible para rollover.",
    };
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
