import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { formatProgrammingCode } from "./formatters";
import { getBatchDetail, normalizeOrderNumber } from "./queries";
import type {
  BatchInvoice,
  MixtoListoInvoiceLine,
  ReconciliationOrderDetail,
} from "./types";

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getReconciliationOrderDetail(
  projectId: string,
  batchId: string,
  orderId: string,
  timezone: string,
): Promise<ReconciliationOrderDetail | null> {
  const supabase = await createClient();
  const [batchDetail, orderResult] = await Promise.all([
    getBatchDetail(projectId, batchId, timezone),
    supabase
      .from("reconciliation_orders")
      .select(
        "id, batch_id, normalized_order_number, supplier_id, document_status, reconciliation_status, version",
      )
      .eq("project_id", projectId)
      .eq("batch_id", batchId)
      .eq("id", orderId)
      .maybeSingle(),
  ]);
  if (orderResult.error)
    throw new Error(
      `No fue posible cargar el pedido. ${orderResult.error.message}`,
    );
  if (!batchDetail || !orderResult.data) return null;
  const order = orderResult.data;
  const guideRelations = batchDetail.activeRelations.filter(
    (relation) =>
      normalizeOrderNumber(relation.orderNumber) ===
      order.normalized_order_number,
  );
  const guideIds = guideRelations.map((relation) => relation.guideId);
  const [
    guideLinesResult,
    guideDocumentsResult,
    orderInvoicesResult,
    reconciliationLinesResult,
    intakesResult,
  ] = await Promise.all([
    guideIds.length
      ? supabase
          .from("dispatch_guide_lines")
          .select(
            "id, guide_id, product_code, product_description, quantity, unit_code, position",
          )
          .eq("project_id", projectId)
          .in("guide_id", guideIds)
          .order("position")
      : Promise.resolve({ data: [], error: null }),
    guideIds.length
      ? createAdminClient()
          .from("guide_documents")
          .select("guide_id, document_id, purpose")
          .eq("project_id", projectId)
          .in("guide_id", guideIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("reconciliation_order_invoices")
      .select("invoice_id")
      .eq("project_id", projectId)
      .eq("reconciliation_order_id", orderId),
    supabase
      .from("reconciliation_order_lines")
      .select(
        "id, product_code, product_description, unit_code, dispatched_total, invoiced_total, difference, status, guide_count, invoice_count, secondary_discrepancies",
      )
      .eq("project_id", projectId)
      .eq("reconciliation_order_id", orderId)
      .order("product_code"),
    supabase
      .from("mixto_listo_invoice_intakes")
      .select(
        "id, invoice_type, invoice_number, status, observations_raw, pca_original, detected_order_number, extraction_id, replaces_invoice_id, created_at",
      )
      .eq("project_id", projectId)
      .eq("reconciliation_order_id", orderId)
      .in("status", ["READY_TO_CONFIRM", "ORDER_MISMATCH", "NEEDS_CORRECTION"])
      .order("created_at", { ascending: false }),
  ]);
  const error =
    guideLinesResult.error ??
    guideDocumentsResult.error ??
    orderInvoicesResult.error ??
    reconciliationLinesResult.error ??
    intakesResult.error;
  if (error)
    throw new Error(
      `No fue posible cargar la conciliación del pedido. ${error.message}`,
    );
  const guideDocumentLinks = guideDocumentsResult.data ?? [];
  const guideDocumentIds = guideDocumentLinks.map((row) => row.document_id);
  const [documentsResult, versionsResult] = await Promise.all([
    guideDocumentIds.length
      ? createAdminClient()
          .from("documents")
          .select("id, category, created_by, created_at")
          .eq("project_id", projectId)
          .in("id", guideDocumentIds)
      : Promise.resolve({ data: [], error: null }),
    guideDocumentIds.length
      ? createAdminClient()
          .from("document_versions")
          .select(
            "document_id, file_name, mime_type, upload_status, created_at",
          )
          .in("document_id", guideDocumentIds)
          .eq("is_current", true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (documentsResult.error ?? versionsResult.error)
    throw new Error(
      "No fue posible cargar los documentos de las guías del Pedido.",
    );
  const documentCreatorIds = [
    ...new Set((documentsResult.data ?? []).map((row) => row.created_by)),
  ];
  const documentCreatorsResult = documentCreatorIds.length
    ? await createAdminClient()
        .from("profiles")
        .select("id, full_name")
        .in("id", documentCreatorIds)
    : { data: [], error: null };
  if (documentCreatorsResult.error)
    throw new Error(
      "No fue posible resolver los autores de los documentos de guía.",
    );
  const documentById = new Map(
    (documentsResult.data ?? []).map((row) => [row.id, row]),
  );
  const versionByDocument = new Map(
    (versionsResult.data ?? []).map((row) => [row.document_id, row]),
  );
  const documentCreatorNames = new Map(
    (documentCreatorsResult.data ?? []).map((row) => [row.id, row.full_name]),
  );
  const intakeRows = intakesResult.data ?? [];
  const extractionIds = intakeRows.flatMap((intake) =>
    intake.extraction_id ? [intake.extraction_id] : [],
  );
  const extractionsResult = extractionIds.length
    ? await createAdminClient()
        .from("ocr_extractions")
        .select("id, normalized_payload")
        .in("id", extractionIds)
    : { data: [], error: null };
  if (extractionsResult.error)
    throw new Error(
      `No fue posible cargar los previews Mixto Listo. ${extractionsResult.error.message}`,
    );
  const payloadByExtraction = new Map(
    (extractionsResult.data ?? []).map((extraction) => [
      extraction.id,
      extraction.normalized_payload as Record<string, unknown>,
    ]),
  );
  const invoiceIds = new Set(
    (orderInvoicesResult.data ?? []).map((row) => row.invoice_id),
  );
  const invoices = batchDetail.invoices.filter((invoice) =>
    invoiceIds.has(invoice.id),
  );
  const currentInvoices = invoices.filter(
    (invoice) =>
      !["SUPERSEDED", "CANCELLED"].includes(invoice.status) &&
      !invoice.replacedByInvoiceId,
  );
  const guideById = new Map(
    guideRelations.map((relation) => [relation.guideId, relation]),
  );
  const guideLines = guideLinesResult.data ?? [];
  const quantitiesByUnit = new Map<string, number>();
  for (const relation of guideRelations) {
    quantitiesByUnit.set(
      relation.unitCode,
      (quantitiesByUnit.get(relation.unitCode) ?? 0) + relation.quantity,
    );
  }
  const sameKey = (
    code: string | null | undefined,
    unit: string | null | undefined,
    expectedCode: string,
    expectedUnit: string | null,
  ) =>
    (code?.trim().toUpperCase() || "__MISSING__") === expectedCode &&
    (unit || null) === expectedUnit;
  return {
    id: order.id,
    batchId: order.batch_id,
    orderNumber: order.normalized_order_number,
    supplierName: guideRelations[0]?.supplierName ?? "Proveedor por revisar",
    documentStatus: order.document_status,
    reconciliationStatus: order.reconciliation_status,
    version: order.version,
    guideCount: guideRelations.length,
    invoiceCount: invoices.length,
    quantitiesByUnit: [...quantitiesByUnit.entries()]
      .map(([unitCode, quantity]) => ({ unitCode, quantity }))
      .sort((left, right) => left.unitCode.localeCompare(right.unitCode)),
    projectId,
    batchCode: batchDetail.code,
    periodStart: batchDetail.periodStart,
    periodEnd: batchDetail.periodEnd,
    accountingPeriod: batchDetail.accountingPeriod,
    batchStatus: batchDetail.status,
    guides: guideRelations.map((relation) => ({
      guideId: relation.guideId,
      dispatchId: relation.dispatchId,
      guideNumber: relation.guideNumber,
      guideDate: relation.guideDate,
      supplierName: relation.supplierName,
      programmingId: relation.programmingId,
      programmingCode: relation.programmingCode,
      result: relation.result,
      quantity: relation.quantity,
      receivedQuantity: relation.receivedQuantity,
      unitCode: relation.unitCode,
      documents: guideDocumentLinks
        .filter((link) => link.guide_id === relation.guideId)
        .flatMap((link) => {
          const document = documentById.get(link.document_id);
          if (!document) return [];
          const version = versionByDocument.get(link.document_id);
          return [
            {
              id: document.id,
              category: document.category,
              purpose: link.purpose,
              fileName: version?.file_name ?? null,
              mimeType: version?.mime_type ?? null,
              uploadStatus: version?.upload_status ?? null,
              createdByName:
                documentCreatorNames.get(document.created_by) ||
                "Usuario no disponible",
              createdAt: version?.created_at ?? document.created_at,
            },
          ];
        }),
    })),
    invoices,
    lines: (reconciliationLinesResult.data ?? []).map((line) => ({
      id: line.id,
      productCode: line.product_code,
      productDescription: line.product_description,
      unitCode: line.unit_code,
      dispatchedTotal: numeric(line.dispatched_total),
      invoicedTotal: numeric(line.invoiced_total),
      difference: numeric(line.difference),
      status: line.status,
      guideCount: line.guide_count,
      invoiceCount: line.invoice_count,
      secondaryDiscrepancies: Array.isArray(line.secondary_discrepancies)
        ? line.secondary_discrepancies.map(String)
        : [],
      guideContributions: guideLines.flatMap((guideLine) => {
        if (
          !sameKey(
            guideLine.product_code,
            guideLine.unit_code,
            line.product_code,
            line.unit_code,
          )
        )
          return [];
        const guide = guideById.get(guideLine.guide_id);
        return guide
          ? [
              {
                guideId: guide.guideId,
                dispatchId: guide.dispatchId,
                guideNumber: guide.guideNumber,
                guideDate: guide.guideDate,
                programmingId: guide.programmingId,
                programmingCode: formatProgrammingCode(guide.programmingId),
                productCode: guideLine.product_code,
                description: guideLine.product_description,
                unitCode: guideLine.unit_code,
                quantity: numeric(guideLine.quantity),
              },
            ]
          : [];
      }),
      invoiceContributions: currentInvoices.flatMap((invoice: BatchInvoice) =>
        invoice.lines.flatMap((invoiceLine) =>
          sameKey(
            invoiceLine.code,
            invoiceLine.unitCode,
            line.product_code,
            line.unit_code,
          )
            ? [
                {
                  invoiceId: invoice.id,
                  invoiceNumber: invoice.number,
                  invoiceType: invoice.type,
                  productCode: invoiceLine.code,
                  description: invoiceLine.description,
                  unitCode: invoiceLine.unitCode,
                  quantity: invoiceLine.quantity,
                },
              ]
            : [],
        ),
      ),
    })),
    correctionReasons: batchDetail.correctionReasons,
    pendingMixtoListoIntakes: intakeRows.flatMap((intake) => {
      const payload = intake.extraction_id
        ? payloadByExtraction.get(intake.extraction_id)
        : undefined;
      const payloadLines = Array.isArray(payload?.lines) ? payload.lines : [];
      if (!intake.extraction_id) return [];
      return [
        {
          intakeId: intake.id,
          extractionId: intake.extraction_id,
          expectedOrderNumber: order.normalized_order_number,
          status: intake.status,
          observationsRaw: intake.observations_raw,
          pcaOriginal: intake.pca_original,
          detectedOrderNumber: intake.detected_order_number,
          lines: payloadLines.flatMap((value): MixtoListoInvoiceLine[] => {
            if (!value || typeof value !== "object") return [];
            const line = value as Record<string, unknown>;
            const quantity = Number(line.quantity);
            return [
              {
                quantity: Number.isFinite(quantity) ? quantity : 0,
                unit_code: String(line.unit_code ?? ""),
                code: String(line.code ?? ""),
                description: String(line.description ?? ""),
              },
            ];
          }),
          invoiceType: intake.invoice_type,
          invoiceNumber: intake.invoice_number,
          createdAt: intake.created_at,
          replacesInvoiceId: intake.replaces_invoice_id,
        },
      ];
    }),
  };
}
