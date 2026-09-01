import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { formatProgrammingCode } from "./formatters";
import type {
  BatchInvoice,
  BatchDetail,
  BatchGuideRelation,
  BatchPageData,
  BatchRolloverPreview,
  BatchSource,
  BatchStatus,
  BatchSummary,
  EligibleBatchGuide,
  InvoiceCorrectionReason,
  InvoiceLineView,
  ReconciliationOrderSummary,
} from "./types";

type BatchRow = {
  id: string;
  project_id: string;
  code: string;
  period_start: string;
  period_end: string;
  accounting_period: string;
  status: BatchStatus;
  creation_source: BatchSource;
  created_at: string;
};

type RelationRow = {
  id: string;
  project_id: string;
  batch_id: string;
  guide_id: string;
  assignment_source: BatchSource;
  added_at: string;
  removed_at: string | null;
  removed_by: string | null;
  removal_reason: string | null;
  rolled_to_batch_id: string | null;
  removal_metadata: Record<string, unknown> | null;
};

type GuideRow = {
  id: string;
  dispatch_id: string;
  supplier_id: string;
  guide_number: string;
  guide_date: string;
  quantity: number | string;
  received_quantity: number | string;
  unit_code: string;
  order_number: string | null;
};

type ReconciliationOrderRow = {
  id: string;
  batch_id: string;
  normalized_order_number: string;
  supplier_id: string | null;
  document_status: ReconciliationOrderSummary["documentStatus"];
  reconciliation_status: ReconciliationOrderSummary["reconciliationStatus"];
  version: number;
};

export function normalizeOrderNumber(value: string | null | undefined) {
  let normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.toUpperCase().startsWith("PCA-"))
    normalized = normalized.replace(/^.*-/, "");
  normalized = normalized.trim();
  if (/^[0-9]+$/.test(normalized)) return normalized.replace(/^0+/, "") || "0";
  return normalized.toUpperCase().replace(/\s+/g, "");
}

type PreviewRow = {
  batch_guide_id: string;
  guide_id: string;
  dispatch_id: string;
  ready_for_review: boolean;
  rollover_action: "STAY" | "MOVE";
  rollover_reason: string;
  destination_batch_id: string | null;
  destination_period_start: string;
  destination_period_end: string;
  destination_accounting_period: string;
};

type InvoiceRow = {
  id: string;
  supplier_id: string;
  invoice_type: "PRODUCT" | "SERVICE";
  invoice_number: string;
  invoice_date: string;
  subtotal: number | string;
  total: number | string;
  currency: string;
  status: string;
  replaces_invoice_id: string | null;
  order_number: string | null;
  pca_original: string | null;
  created_by: string;
  created_at: string;
};

type InvoiceLineRow = {
  invoice_id: string;
  line_number: number;
  code: string | null;
  description: string;
  quantity: number | string;
  unit_code: string | null;
  unit_price: number | string | null;
  line_total: number | string | null;
};

type ExtractionRow = {
  id: string;
  processing_job_id: string;
  normalized_payload: Record<string, unknown>;
  corrected_payload: Record<string, unknown> | null;
  verification_status: "PENDING" | "CONFIRMED" | "CORRECTED";
};

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localDate(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: timezone,
    }).formatToParts(new Date());
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function previewsFor(batchIds: string[]) {
  const supabase = await createClient();
  const entries = await Promise.all(
    batchIds.map(async (batchId) => {
      const { data, error } = await supabase.rpc(
        "preview_weekly_batch_rollover",
        {
          p_batch_id: batchId,
        },
      );
      if (error)
        throw new Error(
          `No fue posible calcular la preparación del lote. ${error.message}`,
        );
      return [batchId, (data ?? []) as PreviewRow[]] as const;
    }),
  );
  return new Map(entries);
}

function summarize(
  batch: BatchRow,
  relations: RelationRow[],
  guideById: Map<string, GuideRow>,
  preview: PreviewRow[],
  today: string,
): BatchSummary {
  const active = relations.filter(
    (row) => row.batch_id === batch.id && !row.removed_at,
  );
  const received = new Map<string, number>();
  for (const relation of active) {
    const guide = guideById.get(relation.guide_id);
    if (!guide) continue;
    received.set(
      guide.unit_code,
      (received.get(guide.unit_code) ?? 0) + numeric(guide.received_quantity),
    );
  }
  const ready = preview.filter((row) => row.ready_for_review).length;
  return {
    id: batch.id,
    code: batch.code,
    periodStart: batch.period_start,
    periodEnd: batch.period_end,
    accountingPeriod: batch.accounting_period,
    status: batch.status,
    source: batch.creation_source,
    activeGuideCount: active.length,
    readyGuideCount: ready,
    pendingGuideCount: Math.max(0, preview.length - ready),
    rolloverCount: relations.filter(
      (row) => row.batch_id === batch.id && Boolean(row.rolled_to_batch_id),
    ).length,
    receivedByUnit: [...received.entries()]
      .map(([unitCode, quantity]) => ({ unitCode, quantity }))
      .sort((a, b) => a.unitCode.localeCompare(b.unitCode)),
    isCurrent: batch.period_start <= today && batch.period_end >= today,
  };
}

export async function getBatchPageData(
  projectId: string,
  timezone: string,
): Promise<BatchPageData> {
  const supabase = await createClient();
  const [batchesResult, relationsResult] = await Promise.all([
    supabase
      .from("batches")
      .select(
        "id, project_id, code, period_start, period_end, accounting_period, status, creation_source, created_at",
      )
      .eq("project_id", projectId)
      .order("period_start", { ascending: false })
      .limit(200),
    supabase
      .from("batch_guides")
      .select(
        "id, project_id, batch_id, guide_id, assignment_source, added_at, removed_at, removed_by, removal_reason, rolled_to_batch_id, removal_metadata",
      )
      .eq("project_id", projectId)
      .order("added_at", { ascending: false })
      .limit(2000),
  ]);
  const error = batchesResult.error ?? relationsResult.error;
  if (error)
    throw new Error(`No fue posible cargar los lotes. ${error.message}`);
  const batches = (batchesResult.data ?? []) as BatchRow[];
  const relations = (relationsResult.data ?? []) as RelationRow[];
  const guideIds = [...new Set(relations.map((row) => row.guide_id))];
  const guidesResult = guideIds.length
    ? await supabase
        .from("dispatch_guides")
        .select(
          "id, dispatch_id, supplier_id, guide_number, guide_date, quantity, received_quantity, unit_code, order_number",
        )
        .eq("project_id", projectId)
        .in("id", guideIds)
    : { data: [], error: null };
  if (guidesResult.error) {
    throw new Error(
      `No fue posible cargar las guías de los lotes. ${guidesResult.error.message}`,
    );
  }
  const guides = (guidesResult.data ?? []) as GuideRow[];
  const guideById = new Map(guides.map((row) => [row.id, row]));
  const previewByBatch = await previewsFor(batches.map((row) => row.id));
  const today = localDate(timezone);
  const summaries = batches.map((batch) =>
    summarize(
      batch,
      relations,
      guideById,
      previewByBatch.get(batch.id) ?? [],
      today,
    ),
  );
  return {
    current: summaries.find((row) => row.isCurrent) ?? null,
    history: summaries,
  };
}

export async function getBatchDetail(
  projectId: string,
  batchId: string,
  timezone: string,
): Promise<BatchDetail | null> {
  const supabase = await createClient();
  const [batchResult, relationsResult, allActiveResult] = await Promise.all([
    supabase
      .from("batches")
      .select(
        "id, project_id, code, period_start, period_end, accounting_period, status, creation_source, created_at",
      )
      .eq("project_id", projectId)
      .eq("id", batchId)
      .maybeSingle(),
    supabase
      .from("batch_guides")
      .select(
        "id, project_id, batch_id, guide_id, assignment_source, added_at, removed_at, removed_by, removal_reason, rolled_to_batch_id, removal_metadata",
      )
      .eq("project_id", projectId)
      .eq("batch_id", batchId)
      .order("added_at", { ascending: false }),
    supabase
      .from("batch_guides")
      .select("guide_id")
      .eq("project_id", projectId)
      .is("removed_at", null),
  ]);
  const error =
    batchResult.error ?? relationsResult.error ?? allActiveResult.error;
  if (error)
    throw new Error(
      `No fue posible cargar el detalle del lote. ${error.message}`,
    );
  if (!batchResult.data) return null;
  const batch = batchResult.data as BatchRow;
  const relations = (relationsResult.data ?? []) as RelationRow[];

  const registeredResult = await supabase
    .from("dispatches")
    .select("id, programming_id, supplier_id, status, result")
    .eq("project_id", projectId)
    .eq("status", "REGISTERED");
  if (registeredResult.error) {
    throw new Error(
      `No fue posible cargar las guías elegibles. ${registeredResult.error.message}`,
    );
  }
  const registeredDispatches = registeredResult.data ?? [];
  const relationGuideIds = relations.map((row) => row.guide_id);
  const registeredDispatchIds = registeredDispatches.map((row) => row.id);
  const guideQueryIds = [...new Set([...relationGuideIds])];
  const [relationGuidesResult, eligibleGuidesResult, previewResult] =
    await Promise.all([
      guideQueryIds.length
        ? createAdminClient()
            .from("dispatch_guides")
            .select(
              "id, dispatch_id, supplier_id, guide_number, guide_date, quantity, received_quantity, unit_code, order_number",
            )
            .eq("project_id", projectId)
            .in("id", guideQueryIds)
        : Promise.resolve({ data: [], error: null }),
      registeredDispatchIds.length
        ? supabase
            .from("dispatch_guides")
            .select(
              "id, dispatch_id, supplier_id, guide_number, guide_date, quantity, received_quantity, unit_code, order_number",
            )
            .eq("project_id", projectId)
            .in("dispatch_id", registeredDispatchIds)
            .gte("guide_date", batch.period_start)
            .lte("guide_date", batch.period_end)
        : Promise.resolve({ data: [], error: null }),
      supabase.rpc("preview_weekly_batch_rollover", { p_batch_id: batchId }),
    ]);
  const nestedError =
    relationGuidesResult.error ??
    eligibleGuidesResult.error ??
    previewResult.error;
  if (nestedError)
    throw new Error(
      `No fue posible resolver las guías del lote. ${nestedError.message}`,
    );
  const relationGuides = (relationGuidesResult.data ?? []) as GuideRow[];
  const eligibleGuideRows = (eligibleGuidesResult.data ?? []) as GuideRow[];
  const allGuides = [...relationGuides, ...eligibleGuideRows];
  const guideById = new Map(allGuides.map((row) => [row.id, row]));
  const dispatchIds = [...new Set(allGuides.map((row) => row.dispatch_id))];

  const [dispatchesResult, invoiceLinksResult, profilesResult] =
    await Promise.all([
      dispatchIds.length
        ? createAdminClient()
            .from("dispatches")
            .select("id, programming_id, supplier_id, status, result")
            .eq("project_id", projectId)
            .in("id", dispatchIds)
        : Promise.resolve({ data: [], error: null }),
      relationGuideIds.length
        ? supabase
            .from("guide_invoices")
            .select("guide_id, invoice_id")
            .eq("project_id", projectId)
            .in("guide_id", relationGuideIds)
        : Promise.resolve({ data: [], error: null }),
      relations.some((row) => row.removed_by)
        ? createAdminClient()
            .from("profiles")
            .select("id, full_name")
            .in(
              "id",
              relations.flatMap((row) =>
                row.removed_by ? [row.removed_by] : [],
              ),
            )
        : Promise.resolve({ data: [], error: null }),
    ]);
  const relationError =
    dispatchesResult.error ?? invoiceLinksResult.error ?? profilesResult.error;
  if (relationError)
    throw new Error(
      `No fue posible resolver las relaciones del lote. ${relationError.message}`,
    );
  const dispatches = dispatchesResult.data ?? [];
  const dispatchById = new Map(dispatches.map((row) => [row.id, row]));
  const programmingIds = [
    ...new Set(dispatches.map((row) => row.programming_id)),
  ];
  const supplierIds = [...new Set(dispatches.map((row) => row.supplier_id))];
  const invoiceLinks = invoiceLinksResult.data ?? [];
  const invoiceIds = [...new Set(invoiceLinks.map((row) => row.invoice_id))];

  const [
    programmingResult,
    suppliersResult,
    invoicesResult,
    correctionReasonsResult,
  ] = await Promise.all([
    programmingIds.length
      ? supabase
          .from("programming")
          .select("id")
          .eq("project_id", projectId)
          .in("id", programmingIds)
      : Promise.resolve({ data: [], error: null }),
    supplierIds.length
      ? supabase.from("suppliers").select("id, name").in("id", supplierIds)
      : Promise.resolve({ data: [], error: null }),
    invoiceIds.length
      ? supabase
          .from("invoices")
          .select(
            "id, supplier_id, invoice_type, invoice_number, invoice_date, subtotal, total, currency, status, replaces_invoice_id, order_number, pca_original, created_by, created_at",
          )
          .eq("project_id", projectId)
          .in("id", invoiceIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("extraction_correction_reasons")
      .select("id, code, name")
      .eq("active", true)
      .order("name"),
  ]);
  const leafError =
    programmingResult.error ??
    suppliersResult.error ??
    invoicesResult.error ??
    correctionReasonsResult.error;
  if (leafError)
    throw new Error(
      `No fue posible cargar proveedores o facturas. ${leafError.message}`,
    );
  const supplierNames = new Map(
    (suppliersResult.data ?? []).map((row) => [row.id, row.name]),
  );
  const profileNames = new Map(
    (profilesResult.data ?? []).map((row) => [row.id, row.full_name]),
  );
  const invoiceRows = (invoicesResult.data ?? []) as InvoiceRow[];
  const invoiceCreatorIds = [
    ...new Set(invoiceRows.map((row) => row.created_by)),
  ];
  const invoiceCreatorsResult = invoiceCreatorIds.length
    ? await createAdminClient()
        .from("profiles")
        .select("id, full_name")
        .in("id", invoiceCreatorIds)
    : { data: [], error: null };
  if (invoiceCreatorsResult.error)
    throw new Error(
      `No fue posible resolver los autores de factura. ${invoiceCreatorsResult.error.message}`,
    );
  const invoiceCreatorNames = new Map(
    (invoiceCreatorsResult.data ?? []).map((row) => [row.id, row.full_name]),
  );
  const invoiceById = new Map(invoiceRows.map((row) => [row.id, row]));
  const invoicesByGuide = new Map<
    string,
    Array<{ invoice_type: string; status: string }>
  >();
  for (const link of invoiceLinks) {
    const invoice = invoiceById.get(link.invoice_id);
    if (!invoice) continue;
    const current = invoicesByGuide.get(link.guide_id) ?? [];
    current.push(invoice);
    invoicesByGuide.set(link.guide_id, current);
  }

  const relationView: BatchGuideRelation[] = relations.flatMap((relation) => {
    const guide = guideById.get(relation.guide_id);
    const dispatch = guide ? dispatchById.get(guide.dispatch_id) : null;
    if (!guide || !dispatch) return [];
    const invoices = invoicesByGuide.get(guide.id) ?? [];
    return [
      {
        relationId: relation.id,
        active: !relation.removed_at,
        assignmentSource: relation.assignment_source,
        addedAt: relation.added_at,
        removedAt: relation.removed_at,
        removedByName: relation.removed_by
          ? (profileNames.get(relation.removed_by) ?? "Usuario")
          : null,
        removalReason: relation.removal_reason,
        removalSource:
          typeof relation.removal_metadata?.source === "string"
            ? relation.removal_metadata.source
            : null,
        rolledToBatchId: relation.rolled_to_batch_id,
        guideId: guide.id,
        guideNumber: guide.guide_number,
        orderNumber: guide.order_number,
        guideDate: guide.guide_date,
        quantity: numeric(guide.quantity),
        receivedQuantity: numeric(guide.received_quantity),
        unitCode: guide.unit_code,
        supplierName:
          supplierNames.get(dispatch.supplier_id) ?? "Proveedor no disponible",
        programmingId: dispatch.programming_id,
        programmingCode: formatProgrammingCode(dispatch.programming_id),
        dispatchId: dispatch.id,
        dispatchStatus: dispatch.status,
        result: dispatch.result,
        productInvoiceStatus:
          invoices.find(
            (row) =>
              row.invoice_type === "PRODUCT" &&
              !["SUPERSEDED", "CANCELLED"].includes(row.status),
          )?.status ?? null,
        serviceInvoiceStatus:
          invoices.find(
            (row) =>
              row.invoice_type === "SERVICE" &&
              !["SUPERSEDED", "CANCELLED"].includes(row.status),
          )?.status ?? null,
      },
    ];
  });

  const activeGuideIds = new Set(
    (allActiveResult.data ?? []).map((row) => row.guide_id),
  );
  const eligibleGuides: EligibleBatchGuide[] = eligibleGuideRows.flatMap(
    (guide) => {
      if (activeGuideIds.has(guide.id)) return [];
      const dispatch = dispatchById.get(guide.dispatch_id);
      if (!dispatch || dispatch.status !== "REGISTERED") return [];
      return [
        {
          guideId: guide.id,
          guideNumber: guide.guide_number,
          guideDate: guide.guide_date,
          supplierName:
            supplierNames.get(dispatch.supplier_id) ??
            "Proveedor no disponible",
          programmingCode: formatProgrammingCode(dispatch.programming_id),
          dispatchId: dispatch.id,
          receivedQuantity: numeric(guide.received_quantity),
          unitCode: guide.unit_code,
          result: dispatch.result,
        },
      ];
    },
  );

  const previewRows = (previewResult.data ?? []) as PreviewRow[];
  const preview: BatchRolloverPreview[] = previewRows.flatMap((row) => {
    const guide = guideById.get(row.guide_id);
    if (!guide) return [];
    return [
      {
        batchGuideId: row.batch_guide_id,
        guideId: row.guide_id,
        dispatchId: row.dispatch_id,
        guideNumber: guide.guide_number,
        unitCode: guide.unit_code,
        receivedQuantity: numeric(guide.received_quantity),
        ready: row.ready_for_review,
        action: row.rollover_action,
        reason: row.rollover_reason,
        destinationBatchId: row.destination_batch_id,
        destinationPeriodStart: row.destination_period_start,
        destinationPeriodEnd: row.destination_period_end,
        destinationAccountingPeriod: row.destination_accounting_period,
      },
    ];
  });
  const summary = summarize(
    batch,
    relations,
    guideById,
    previewRows,
    localDate(timezone),
  );

  const [invoiceLinesResult, invoiceDocumentsResult] = await Promise.all([
    invoiceIds.length
      ? createAdminClient()
          .from("invoice_lines")
          .select(
            "invoice_id, line_number, code, description, quantity, unit_code, unit_price, line_total",
          )
          .in("invoice_id", invoiceIds)
          .order("line_number")
      : Promise.resolve({ data: [], error: null }),
    invoiceIds.length
      ? createAdminClient()
          .from("invoice_documents")
          .select("invoice_id, document_id")
          .eq("project_id", projectId)
          .in("invoice_id", invoiceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const invoiceDetailError =
    invoiceLinesResult.error ?? invoiceDocumentsResult.error;
  if (invoiceDetailError) {
    throw new Error(
      `No fue posible cargar el expediente de facturas. ${invoiceDetailError.message}`,
    );
  }
  const invoiceDocuments = invoiceDocumentsResult.data ?? [];
  const documentIds = invoiceDocuments.map((row) => row.document_id);
  const versionsResult = documentIds.length
    ? await createAdminClient()
        .from("document_versions")
        .select("id, document_id, file_name")
        .in("document_id", documentIds)
        .eq("upload_status", "UPLOADED")
        .eq("is_current", true)
    : { data: [], error: null };
  if (versionsResult.error) {
    throw new Error(
      `No fue posible cargar los documentos de factura. ${versionsResult.error.message}`,
    );
  }
  const versionIds = (versionsResult.data ?? []).map((row) => row.id);
  const jobsResult = versionIds.length
    ? await createAdminClient()
        .from("document_processing_jobs")
        .select("id, document_version_id")
        .in("document_version_id", versionIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (jobsResult.error) {
    throw new Error(
      `No fue posible cargar el procesamiento documental. ${jobsResult.error.message}`,
    );
  }
  const jobIds = (jobsResult.data ?? []).map((row) => row.id);
  const extractionsResult = jobIds.length
    ? await createAdminClient()
        .from("ocr_extractions")
        .select(
          "id, processing_job_id, normalized_payload, corrected_payload, verification_status",
        )
        .in("processing_job_id", jobIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (extractionsResult.error) {
    throw new Error(
      `No fue posible cargar las extracciones de factura. ${extractionsResult.error.message}`,
    );
  }

  const lineRows = (invoiceLinesResult.data ?? []) as InvoiceLineRow[];
  const linesByInvoice = new Map<string, InvoiceLineView[]>();
  for (const row of lineRows) {
    const current = linesByInvoice.get(row.invoice_id) ?? [];
    current.push({
      code: row.code,
      description: row.description,
      quantity: numeric(row.quantity),
      unitCode: row.unit_code,
      unitPrice: row.unit_price === null ? null : numeric(row.unit_price),
      lineTotal: row.line_total === null ? null : numeric(row.line_total),
    });
    linesByInvoice.set(row.invoice_id, current);
  }
  const documentByInvoice = new Map(
    invoiceDocuments.map((row) => [row.invoice_id, row.document_id]),
  );
  const versionByDocument = new Map(
    (versionsResult.data ?? []).map((row) => [row.document_id, row]),
  );
  const jobByVersion = new Map<
    string,
    { id: string; document_version_id: string }
  >();
  for (const row of jobsResult.data ?? [])
    if (!jobByVersion.has(row.document_version_id))
      jobByVersion.set(row.document_version_id, row);
  const extractionByJob = new Map<string, ExtractionRow>();
  for (const row of (extractionsResult.data ?? []) as ExtractionRow[])
    if (!extractionByJob.has(row.processing_job_id))
      extractionByJob.set(row.processing_job_id, row);
  const guideRelationById = new Map(
    relationView.map((row) => [row.guideId, row]),
  );
  const linksByInvoice = new Map<string, string[]>();
  for (const link of invoiceLinks) {
    const current = linksByInvoice.get(link.invoice_id) ?? [];
    current.push(link.guide_id);
    linksByInvoice.set(link.invoice_id, current);
  }

  const invoices: BatchInvoice[] = invoiceRows.map((invoice) => {
    const linkedGuideIds = linksByInvoice.get(invoice.id) ?? [];
    const linkedGuides = linkedGuideIds.flatMap((id) => {
      const relation = guideRelationById.get(id);
      return relation ? [relation] : [];
    });
    const lines = linesByInvoice.get(invoice.id) ?? [];
    const guideUnits = new Set(linkedGuides.map((row) => row.unitCode));
    const invoiceUnits = new Set(
      lines.flatMap((row) => (row.unitCode ? [row.unitCode] : [])),
    );
    const guideQuantity = linkedGuides.reduce(
      (sum, row) => sum + row.receivedQuantity,
      0,
    );
    const invoiceQuantity = lines.reduce((sum, row) => sum + row.quantity, 0);
    const comparable =
      invoice.invoice_type === "PRODUCT" &&
      guideUnits.size === 1 &&
      invoiceUnits.size === 1 &&
      [...guideUnits][0] === [...invoiceUnits][0];
    const documentId = documentByInvoice.get(invoice.id) ?? null;
    const version = documentId ? versionByDocument.get(documentId) : undefined;
    const job = version ? jobByVersion.get(version.id) : undefined;
    const extraction = job ? extractionByJob.get(job.id) : undefined;
    return {
      id: invoice.id,
      type: invoice.invoice_type,
      number: invoice.invoice_number,
      date: invoice.invoice_date,
      supplierName:
        supplierNames.get(invoice.supplier_id) ?? "Proveedor no disponible",
      subtotal: numeric(invoice.subtotal),
      total: numeric(invoice.total),
      currency: invoice.currency,
      status: invoice.status,
      orderNumber: invoice.order_number,
      pcaOriginal: invoice.pca_original,
      replacesInvoiceId: invoice.replaces_invoice_id,
      replacedByInvoiceId:
        invoiceRows.find((row) => row.replaces_invoice_id === invoice.id)?.id ??
        null,
      guideIds: linkedGuideIds,
      guideNumbers: linkedGuides.map((row) => row.guideNumber),
      lines,
      documentId,
      fileName: version?.file_name ?? null,
      extractionId: extraction?.id ?? null,
      extractionStatus: extraction?.verification_status ?? null,
      extractionPayload: (extraction?.corrected_payload ??
        extraction?.normalized_payload ??
        null) as Record<string, unknown> | null,
      guideQuantity,
      invoiceQuantity,
      difference: comparable ? invoiceQuantity - guideQuantity : null,
      unitCode: comparable ? [...guideUnits][0] : null,
      quantityMatch: comparable
        ? invoiceQuantity === guideQuantity
        : invoice.invoice_type === "SERVICE"
          ? null
          : false,
      createdByName:
        invoiceCreatorNames.get(invoice.created_by) || "Usuario no disponible",
      createdAt: invoice.created_at,
    };
  });
  const activeGuideIdsForBatch = relationView
    .filter((row) => row.active)
    .map((row) => row.guideId);
  const activeInvoiceTypesByGuide = new Map<string, Set<string>>();
  for (const link of invoiceLinks) {
    const invoice = invoiceById.get(link.invoice_id);
    if (
      !invoice ||
      invoice.status === "SUPERSEDED" ||
      invoice.status === "CANCELLED"
    )
      continue;
    const types =
      activeInvoiceTypesByGuide.get(link.guide_id) ?? new Set<string>();
    types.add(invoice.invoice_type);
    activeInvoiceTypesByGuide.set(link.guide_id, types);
  }
  const correctionReasons: InvoiceCorrectionReason[] = (
    correctionReasonsResult.data ?? []
  ).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
  }));
  const ordersResult = await supabase
    .from("reconciliation_orders")
    .select(
      "id, batch_id, normalized_order_number, supplier_id, document_status, reconciliation_status, version",
    )
    .eq("project_id", projectId)
    .eq("batch_id", batchId)
    .order("normalized_order_number");
  if (ordersResult.error)
    throw new Error(
      `No fue posible cargar los pedidos conciliables. ${ordersResult.error.message}`,
    );
  const orderRows = (ordersResult.data ?? []) as ReconciliationOrderRow[];
  const orderIds = orderRows.map((row) => row.id);
  const orderInvoicesResult = orderIds.length
    ? await supabase
        .from("reconciliation_order_invoices")
        .select("reconciliation_order_id, invoice_id")
        .eq("project_id", projectId)
        .in("reconciliation_order_id", orderIds)
    : { data: [], error: null };
  if (orderInvoicesResult.error)
    throw new Error(
      `No fue posible contar las facturas por pedido. ${orderInvoicesResult.error.message}`,
    );
  const activeGuideRows = relationView.filter((row) => row.active);
  const orders: ReconciliationOrderSummary[] = orderRows.map((order) => {
    const orderGuides = activeGuideRows.filter(
      (relation) =>
        normalizeOrderNumber(guideById.get(relation.guideId)?.order_number) ===
        order.normalized_order_number,
    );
    const quantities = new Map<string, number>();
    for (const guide of orderGuides) {
      quantities.set(
        guide.unitCode,
        (quantities.get(guide.unitCode) ?? 0) + guide.quantity,
      );
    }
    return {
      id: order.id,
      batchId: order.batch_id,
      orderNumber: order.normalized_order_number,
      supplierName: order.supplier_id
        ? (supplierNames.get(order.supplier_id) ?? "Proveedor no disponible")
        : "Proveedor por revisar",
      documentStatus: order.document_status,
      reconciliationStatus: order.reconciliation_status,
      version: order.version,
      guideCount: orderGuides.length,
      invoiceCount: (orderInvoicesResult.data ?? []).filter(
        (relation) => relation.reconciliation_order_id === order.id,
      ).length,
      quantitiesByUnit: [...quantities.entries()]
        .map(([unitCode, quantity]) => ({ unitCode, quantity }))
        .sort((a, b) => a.unitCode.localeCompare(b.unitCode)),
    };
  });
  return {
    ...summary,
    projectId,
    activeRelations: relationView.filter((row) => row.active),
    removedRelations: relationView.filter((row) => !row.active),
    eligibleGuides,
    preview,
    invoices,
    correctionReasons,
    orders,
    invoiceSummary: {
      total: invoices.length,
      pending: invoices.filter(
        (row) =>
          row.extractionStatus === "PENDING" || row.status === "REGISTERED",
      ).length,
      approved: invoices.filter(
        (row) => row.status === "APPROVED" || row.status === "MATCHED",
      ).length,
      reinvoicing: invoices.filter((row) => row.status === "REINVOICING")
        .length,
      guidesWithoutProduct: activeGuideIdsForBatch.filter(
        (id) => !activeInvoiceTypesByGuide.get(id)?.has("PRODUCT"),
      ).length,
      guidesWithoutService: activeGuideIdsForBatch.filter(
        (id) => !activeInvoiceTypesByGuide.get(id)?.has("SERVICE"),
      ).length,
    },
  };
}
