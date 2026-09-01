import "server-only";

import { createClient } from "@/lib/supabase/server";
import { canCreateDispatchForProgramming } from "@/features/programming/availability";

import type {
  DispatchBatchRelation,
  DispatchDetail,
  DispatchDocument,
  DispatchGuideLine,
  DispatchIncident,
  DispatchInvoiceRelation,
  DispatchListItem,
  DispatchPageData,
  DispatchResult,
  DispatchStatus,
  EligibleProgramming,
} from "./types";

type DispatchRow = {
  id: string;
  project_id: string;
  supplier_id: string;
  programming_id: string;
  status: DispatchStatus;
  result: DispatchResult | null;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type GuideRow = {
  id: string;
  dispatch_id: string;
  template_version_id: string | null;
  guide_number: string;
  order_number: string | null;
  guide_date: string;
  quantity: number | string;
  dispatched_quantity: number | string;
  received_quantity: number | string;
  returned_quantity: number | string;
  unit_code: string;
  load_at: string | null;
  arrival_at: string | null;
  departure_at: string | null;
  received_by_name: string;
  provider_extra_data: Record<string, unknown>;
};

type ProgrammingRow = {
  id: string;
  supplier_id: string;
  status: string;
  scheduled_at: string;
  requested_quantity: number | string;
  confirmed_quantity: number | string | null;
  unit_code: string;
};

type IncidentRow = {
  id: string;
  dispatch_id: string;
  incident_type_id: string;
  responsibility: string;
  charge_applicability: string;
  notes: string | null;
  reported_by: string;
  created_at: string;
};

function numeric(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function programmingCode(id: string) {
  return `PRG-${id.slice(0, 8).toUpperCase()}`;
}

function emptyResult<T>() {
  return Promise.resolve({ data: [] as T[], error: null });
}

export async function getDispatchPageData(projectId: string): Promise<DispatchPageData> {
  const supabase = await createClient();
  const [dispatchesResult, eligibleResult, unitsResult] = await Promise.all([
    supabase
      .from("dispatches")
      .select(
        "id, project_id, supplier_id, programming_id, status, result, version, created_by, created_at, updated_at",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("programming")
      .select(
        "id, supplier_id, status, scheduled_at, requested_quantity, confirmed_quantity, unit_code",
      )
      .eq("project_id", projectId)
      .in("status", ["CONFIRMED", "IN_EXECUTION"])
      .order("scheduled_at"),
    supabase
      .from("units_of_measure")
      .select("code, name")
      .eq("active", true)
      .order("code"),
  ]);

  const rootError = dispatchesResult.error ?? eligibleResult.error ?? unitsResult.error;
  if (rootError) {
    throw new Error(`No fue posible cargar los despachos. ${rootError.message}`);
  }

  const dispatches = (dispatchesResult.data ?? []) as DispatchRow[];
  const eligible = (eligibleResult.data ?? []) as ProgrammingRow[];
  const allProgrammingIds = [
    ...new Set([...dispatches.map((row) => row.programming_id), ...eligible.map((row) => row.id)]),
  ];
  const eligibleIds = eligible.map((row) => row.id);
  const listDispatchIds = dispatches.map((row) => row.id);

  const [programmingResult, eligibleDispatchesResult, linesResult, incidentsResult] =
    await Promise.all([
      allProgrammingIds.length
        ? supabase
            .from("programming")
            .select(
              "id, supplier_id, status, scheduled_at, requested_quantity, confirmed_quantity, unit_code",
            )
            .eq("project_id", projectId)
            .in("id", allProgrammingIds)
        : emptyResult<ProgrammingRow>(),
      eligibleIds.length
        ? supabase
            .from("dispatches")
            .select("id, project_id, supplier_id, programming_id, status, result, version, created_by, created_at, updated_at")
            .eq("project_id", projectId)
            .in("programming_id", eligibleIds)
        : emptyResult<DispatchRow>(),
      eligibleIds.length
        ? supabase
            .from("programming_lines")
            .select("programming_id")
            .eq("project_id", projectId)
            .in("programming_id", eligibleIds)
        : emptyResult<{ programming_id: string }>(),
      listDispatchIds.length
        ? supabase
            .from("dispatch_incidents")
            .select("id, dispatch_id")
            .eq("project_id", projectId)
            .in("dispatch_id", listDispatchIds)
        : emptyResult<{ id: string; dispatch_id: string }>(),
    ]);

  const relationError = [
    programmingResult.error,
    eligibleDispatchesResult.error,
    linesResult.error,
    incidentsResult.error,
  ].find(Boolean);
  if (relationError) {
    throw new Error(`No fue posible resolver las relaciones de despacho. ${relationError.message}`);
  }

  const programmingRows = (programmingResult.data ?? []) as ProgrammingRow[];
  const programmingById = new Map(programmingRows.map((row) => [row.id, row]));
  const allDispatchesById = new Map<string, DispatchRow>();
  for (const row of dispatches) allDispatchesById.set(row.id, row);
  for (const row of (eligibleDispatchesResult.data ?? []) as DispatchRow[]) {
    allDispatchesById.set(row.id, row);
  }
  const allDispatches = [...allDispatchesById.values()];
  const allDispatchIds = allDispatches.map((row) => row.id);
  const supplierIds = [
    ...new Set([
      ...dispatches.map((row) => row.supplier_id),
      ...programmingRows.map((row) => row.supplier_id),
    ]),
  ];

  const [guidesResult, suppliersResult] = await Promise.all([
    allDispatchIds.length
      ? supabase
          .from("dispatch_guides")
          .select(
            "id, dispatch_id, template_version_id, guide_number, order_number, guide_date, quantity, dispatched_quantity, received_quantity, returned_quantity, unit_code, load_at, arrival_at, departure_at, received_by_name, provider_extra_data",
          )
          .eq("project_id", projectId)
          .in("dispatch_id", allDispatchIds)
      : emptyResult<GuideRow>(),
    supplierIds.length
      ? supabase.from("suppliers").select("id, name").in("id", supplierIds)
      : emptyResult<{ id: string; name: string }>(),
  ]);

  const nestedError = guidesResult.error ?? suppliersResult.error;
  if (nestedError) {
    throw new Error(`No fue posible resolver guías y proveedores. ${nestedError.message}`);
  }

  const guidesByDispatch = new Map(
    ((guidesResult.data ?? []) as GuideRow[]).map((row) => [row.dispatch_id, row]),
  );
  const supplierNames = new Map(
    (suppliersResult.data ?? []).map((row) => [row.id, row.name]),
  );
  const incidentCount = new Map<string, number>();
  for (const row of incidentsResult.data ?? []) {
    incidentCount.set(row.dispatch_id, (incidentCount.get(row.dispatch_id) ?? 0) + 1);
  }
  const lineCount = new Map<string, number>();
  for (const row of linesResult.data ?? []) {
    lineCount.set(row.programming_id, (lineCount.get(row.programming_id) ?? 0) + 1);
  }
  const dispatchesByProgramming = new Map<string, DispatchRow[]>();
  for (const row of allDispatches) {
    const current = dispatchesByProgramming.get(row.programming_id) ?? [];
    current.push(row);
    dispatchesByProgramming.set(row.programming_id, current);
  }

  const items: DispatchListItem[] = dispatches.map((row) => {
    const guide = guidesByDispatch.get(row.id);
    const programming = programmingById.get(row.programming_id);
    return {
      id: row.id,
      projectId: row.project_id,
      programmingId: row.programming_id,
      programmingCode: programmingCode(row.programming_id),
      supplierId: row.supplier_id,
      supplierName: supplierNames.get(row.supplier_id) ?? "Proveedor no disponible",
      status: row.status,
      result: row.result,
      guideId: guide?.id ?? null,
      guideNumber: guide?.guide_number ?? null,
      orderNumber: guide?.order_number ?? null,
      guideDate: guide?.guide_date ?? null,
      quantity: numeric(guide?.quantity),
      dispatchedQuantity: numeric(guide?.dispatched_quantity),
      receivedQuantity: numeric(guide?.received_quantity),
      returnedQuantity: numeric(guide?.returned_quantity),
      unitCode: guide?.unit_code ?? programming?.unit_code ?? null,
      receivedByName: guide?.received_by_name ?? null,
      incidentCount: incidentCount.get(row.id) ?? 0,
      createdAt: row.created_at,
    };
  });

  const availabilityNow = Date.now();
  const eligibleProgramming: EligibleProgramming[] = eligible.map((row) => {
    const related = dispatchesByProgramming.get(row.id) ?? [];
    const receivedTotal = related.reduce(
      (total, dispatch) =>
        total + (numeric(guidesByDispatch.get(dispatch.id)?.received_quantity) ?? 0),
      0,
    );
    const target = numeric(row.confirmed_quantity) ?? numeric(row.requested_quantity) ?? 0;
    return {
      id: row.id,
      status: row.status as EligibleProgramming["status"],
      scheduledAt: row.scheduled_at,
      supplierId: row.supplier_id,
      supplierName: supplierNames.get(row.supplier_id) ?? "Proveedor no disponible",
      requestedQuantity: numeric(row.requested_quantity) ?? 0,
      confirmedQuantity: numeric(row.confirmed_quantity),
      unitCode: row.unit_code,
      lineCount: lineCount.get(row.id) ?? 0,
      dispatchCount: related.length,
      receivedTotal,
      remaining: Math.max(target - receivedTotal, 0),
      excess: Math.max(receivedTotal - target, 0),
    };
  }).filter((programming) => canCreateDispatchForProgramming({
    status: programming.status,
    scheduledAt: programming.scheduledAt,
    operationStarted: programming.dispatchCount > 0,
    hasPermission: true,
  }, availabilityNow));

  return {
    items,
    eligibleProgramming,
    suppliers: [...supplierNames.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    units: (unitsResult.data ?? []).map((unit) => ({ code: unit.code, name: unit.name })),
  };
}

export async function getDispatchDetail(
  projectId: string,
  dispatchId: string,
): Promise<DispatchDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dispatches")
    .select(
      "id, project_id, supplier_id, programming_id, status, result, version, created_by, created_at, updated_at",
    )
    .eq("id", dispatchId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw new Error(`No fue posible cargar el despacho. ${error.message}`);
  if (!data) return null;
  const dispatch = data as DispatchRow;

  const [guideResult, programmingResult, supplierResult, incidentsResult, creatorResult] =
    await Promise.all([
      supabase
        .from("dispatch_guides")
        .select(
          "id, dispatch_id, template_version_id, guide_number, order_number, guide_date, quantity, dispatched_quantity, received_quantity, returned_quantity, unit_code, load_at, arrival_at, departure_at, received_by_name, provider_extra_data",
        )
        .eq("project_id", projectId)
        .eq("dispatch_id", dispatchId)
        .maybeSingle(),
      supabase
        .from("programming")
        .select(
          "id, supplier_id, status, scheduled_at, requested_quantity, confirmed_quantity, unit_code",
        )
        .eq("project_id", projectId)
        .eq("id", dispatch.programming_id)
        .maybeSingle(),
      supabase.from("suppliers").select("id, name").eq("id", dispatch.supplier_id).maybeSingle(),
      supabase
        .from("dispatch_incidents")
        .select(
          "id, dispatch_id, incident_type_id, responsibility, charge_applicability, notes, reported_by, created_at",
        )
        .eq("project_id", projectId)
        .eq("dispatch_id", dispatchId)
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name").eq("id", dispatch.created_by).maybeSingle(),
    ]);

  const rootError = [
    guideResult.error,
    programmingResult.error,
    supplierResult.error,
    incidentsResult.error,
    creatorResult.error,
  ].find(Boolean);
  if (rootError) {
    throw new Error(`No fue posible resolver el detalle del despacho. ${rootError.message}`);
  }

  const guide = guideResult.data as GuideRow | null;
  const programming = programmingResult.data as ProgrammingRow | null;
  const incidents = (incidentsResult.data ?? []) as IncidentRow[];
  const incidentTypeIds = [...new Set(incidents.map((row) => row.incident_type_id))];
  const reporterIds = [...new Set(incidents.map((row) => row.reported_by))];

  const [linesResult, linksResult, incidentLinksResult, batchLinksResult, invoiceLinksResult, typesResult, reportersResult, incidentTypesResult, unitsResult] =
    await Promise.all([
      guide
        ? supabase
            .from("dispatch_guide_lines")
            .select("id, position, product_code, product_description, quantity, unit_code")
            .eq("project_id", projectId)
            .eq("guide_id", guide.id)
            .order("position")
        : emptyResult<{
            id: string;
            position: number;
            product_code: string;
            product_description: string;
            quantity: number | string;
            unit_code: string;
          }>(),
      guide
        ? supabase
            .from("guide_documents")
            .select("guide_id, document_id, purpose")
            .eq("project_id", projectId)
            .eq("guide_id", guide.id)
        : emptyResult<{ guide_id: string; document_id: string; purpose: string }>(),
      incidents.length
        ? supabase
            .from("incident_documents")
            .select("incident_id, document_id, purpose")
            .eq("project_id", projectId)
            .in("incident_id", incidents.map((incident) => incident.id))
        : emptyResult<{ incident_id: string; document_id: string; purpose: string }>(),
      guide
        ? supabase
            .from("batch_guides")
            .select(
              "id, batch_id, assignment_source, added_at, removed_at, removal_reason",
            )
            .eq("project_id", projectId)
            .eq("guide_id", guide.id)
            .order("added_at", { ascending: false })
        : emptyResult<{
            id: string;
            batch_id: string;
            assignment_source: string;
            added_at: string;
            removed_at: string | null;
            removal_reason: string | null;
          }>(),
      guide
        ? supabase
            .from("guide_invoices")
            .select("invoice_id, linked_at")
            .eq("project_id", projectId)
            .eq("guide_id", guide.id)
        : emptyResult<{ invoice_id: string; linked_at: string }>(),
      incidentTypeIds.length
        ? supabase.from("incident_types").select("id, name").in("id", incidentTypeIds)
        : emptyResult<{ id: string; name: string }>(),
      reporterIds.length
        ? supabase.from("profiles").select("id, full_name").in("id", reporterIds)
        : emptyResult<{ id: string; full_name: string | null }>(),
      supabase
        .from("incident_types")
        .select("id, name")
        .eq("active", true)
        .order("name"),
      supabase
        .from("units_of_measure")
        .select("code, name")
        .eq("active", true)
        .order("code"),
    ]);

  const relationError = [
    linesResult.error,
    linksResult.error,
    incidentLinksResult.error,
    batchLinksResult.error,
    invoiceLinksResult.error,
    typesResult.error,
    reportersResult.error,
    incidentTypesResult.error,
    unitsResult.error,
  ].find(Boolean);
  if (relationError) {
    throw new Error(`No fue posible cargar las relaciones del despacho. ${relationError.message}`);
  }

  const documentLinks = [
    ...(linksResult.data ?? []).map((link) => ({
      document_id: link.document_id,
      purpose: link.purpose,
      context: "guide" as const,
      incident_id: null,
    })),
    ...(incidentLinksResult.data ?? []).map((link) => ({
      document_id: link.document_id,
      purpose: link.purpose,
      context: "incident" as const,
      incident_id: link.incident_id,
    })),
  ];
  const batchLinks = batchLinksResult.data ?? [];
  const invoiceLinks = invoiceLinksResult.data ?? [];
  const documentIds = documentLinks.map((row) => row.document_id);
  const batchIds = batchLinks.map((row) => row.batch_id);
  const invoiceIds = invoiceLinks.map((row) => row.invoice_id);

  const [documentsResult, versionsResult, batchesResult, invoicesResult] = await Promise.all([
    documentIds.length
      ? supabase
          .from("documents")
          .select("id, category, created_by, created_at")
          .eq("project_id", projectId)
          .in("id", documentIds)
      : emptyResult<{ id: string; category: string; created_by: string; created_at: string }>(),
    documentIds.length
      ? supabase
          .from("document_versions")
          .select("id, document_id, version, file_name, mime_type, upload_status, created_at")
          .in("document_id", documentIds)
          .order("version", { ascending: false })
      : emptyResult<{
          document_id: string;
          id: string;
          version: number;
          file_name: string;
          mime_type: string;
          upload_status: string;
          created_at: string;
        }>(),
    batchIds.length
      ? supabase
          .from("batches")
          .select("id, code, status, period_start, period_end, accounting_period")
          .eq("project_id", projectId)
          .in("id", batchIds)
      : emptyResult<{
          id: string;
          code: string;
          status: string;
          period_start: string;
          period_end: string;
          accounting_period: string;
        }>(),
    invoiceIds.length
      ? supabase
          .from("invoices")
          .select("id, invoice_number, invoice_date, invoice_type, status, total, currency")
          .eq("project_id", projectId)
          .in("id", invoiceIds)
      : emptyResult<{
          id: string;
          invoice_number: string;
          invoice_date: string;
          invoice_type: string;
          status: string;
          total: number | string;
          currency: string;
        }>(),
  ]);

  const nestedError = [
    documentsResult.error,
    versionsResult.error,
    batchesResult.error,
    invoicesResult.error,
  ].find(Boolean);
  if (nestedError) {
    throw new Error(`No fue posible resolver documentos, lotes o facturas. ${nestedError.message}`);
  }

  const documentCreatorIds = [
    ...new Set((documentsResult.data ?? []).map((document) => document.created_by)),
  ];
  const documentCreatorsResult = documentCreatorIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", documentCreatorIds)
    : { data: [], error: null };
  if (documentCreatorsResult.error) {
    throw new Error(`No fue posible resolver los autores de documentos. ${documentCreatorsResult.error.message}`);
  }

  const typeNames = new Map((typesResult.data ?? []).map((row) => [row.id, row.name]));
  const reporterNames = new Map(
    (reportersResult.data ?? []).map((row) => [row.id, row.full_name]),
  );
  const documentById = new Map((documentsResult.data ?? []).map((row) => [row.id, row]));
  const versionByDocument = new Map<
    string,
    NonNullable<typeof versionsResult.data>[number]
  >();
  for (const row of versionsResult.data ?? []) {
    if (!versionByDocument.has(row.document_id)) versionByDocument.set(row.document_id, row);
  }
  const documentCreatorNames = new Map(
    (documentCreatorsResult.data ?? []).map((profile) => [profile.id, profile.full_name]),
  );
  const batchById = new Map((batchesResult.data ?? []).map((row) => [row.id, row]));
  const invoiceById = new Map((invoicesResult.data ?? []).map((row) => [row.id, row]));

  const guideLines: DispatchGuideLine[] = (linesResult.data ?? []).map((row) => ({
    id: row.id,
    position: row.position,
    productCode: row.product_code,
    productDescription: row.product_description,
    quantity: numeric(row.quantity) ?? 0,
    unitCode: row.unit_code,
  }));
  const mappedIncidents: DispatchIncident[] = incidents.map((row) => ({
    id: row.id,
    typeName: typeNames.get(row.incident_type_id) ?? "Tipo no disponible",
    responsibility: row.responsibility,
    chargeApplicability: row.charge_applicability,
    notes: row.notes,
    reporterName: reporterNames.get(row.reported_by) || "Usuario no disponible",
    createdAt: row.created_at,
  }));
  const documents: DispatchDocument[] = documentLinks.flatMap((link) => {
    const document = documentById.get(link.document_id);
    if (!document) return [];
    const version = versionByDocument.get(link.document_id);
    return [{
      id: document.id,
      category: document.category,
      purpose: link.purpose,
      context: link.context,
      incidentId: link.incident_id,
      fileName: version?.file_name ?? null,
      mimeType: version?.mime_type ?? null,
      uploadStatus: version?.upload_status ?? null,
      versionId: version?.id ?? null,
      createdByName: documentCreatorNames.get(document.created_by) || "Usuario no disponible",
      createdAt: version?.created_at ?? document.created_at,
    }];
  });
  const batches: DispatchBatchRelation[] = batchLinks.flatMap((link) => {
    const batch = batchById.get(link.batch_id);
    if (!batch) return [];
    return [{
      relationId: link.id,
      batchId: batch.id,
      code: batch.code,
      status: batch.status,
      periodStart: batch.period_start,
      periodEnd: batch.period_end,
      accountingPeriod: batch.accounting_period,
      assignmentSource: link.assignment_source,
      addedAt: link.added_at,
      removedAt: link.removed_at,
      removalReason: link.removal_reason,
    }];
  });
  const invoices: DispatchInvoiceRelation[] = invoiceLinks.flatMap((link) => {
    const invoice = invoiceById.get(link.invoice_id);
    if (!invoice) return [];
    return [{
      id: invoice.id,
      number: invoice.invoice_number,
      invoiceDate: invoice.invoice_date,
      invoiceType: invoice.invoice_type,
      status: invoice.status,
      total: numeric(invoice.total) ?? 0,
      currency: invoice.currency,
      linkedAt: link.linked_at,
    }];
  });

  let orderContext: DispatchDetail["orderContext"] = null;
  const activeBatchLink = batchLinks.find((link) => !link.removed_at);
  const normalizeOrder = (value: string | null | undefined) => {
    let normalized = value?.trim() ?? "";
    if (!normalized) return null;
    if (normalized.toUpperCase().startsWith("PCA-")) normalized = normalized.replace(/^.*-/, "");
    if (/^[0-9]+$/.test(normalized)) return normalized.replace(/^0+/, "") || "0";
    return normalized.toUpperCase().replace(/\s+/g, "");
  };
  const normalizedOrder = normalizeOrder(guide?.order_number);
  if (activeBatchLink && normalizedOrder) {
    const orderResult = await supabase.from("reconciliation_orders")
      .select("id, batch_id, normalized_order_number, document_status, reconciliation_status")
      .eq("project_id", projectId).eq("batch_id", activeBatchLink.batch_id)
      .eq("normalized_order_number", normalizedOrder).maybeSingle();
    if (orderResult.error) throw new Error(`No fue posible resolver el Pedido del despacho. ${orderResult.error.message}`);
    if (orderResult.data) {
      const [orderInvoicesResult, activeRelationsResult] = await Promise.all([
        supabase.from("reconciliation_order_invoices").select("invoice_id").eq("project_id", projectId).eq("reconciliation_order_id", orderResult.data.id),
        supabase.from("batch_guides").select("guide_id").eq("project_id", projectId).eq("batch_id", activeBatchLink.batch_id).is("removed_at", null),
      ]);
      const contextError = orderInvoicesResult.error ?? activeRelationsResult.error;
      if (contextError) throw new Error(`No fue posible resumir el Pedido. ${contextError.message}`);
      const orderGuideIds = (activeRelationsResult.data ?? []).map((row) => row.guide_id);
      const orderGuidesResult = orderGuideIds.length ? await supabase.from("dispatch_guides").select("id, order_number").eq("project_id", projectId).in("id", orderGuideIds) : { data: [], error: null };
      if (orderGuidesResult.error) throw new Error(`No fue posible contar las guías del Pedido. ${orderGuidesResult.error.message}`);
      orderContext = {
        orderId: orderResult.data.id,
        batchId: activeBatchLink.batch_id,
        batchCode: batchById.get(activeBatchLink.batch_id)?.code ?? "Lote",
        orderNumber: orderResult.data.normalized_order_number,
        guideCount: (orderGuidesResult.data ?? []).filter((row) => normalizeOrder(row.order_number) === normalizedOrder).length,
        invoiceCount: (orderInvoicesResult.data ?? []).length,
        documentStatus: orderResult.data.document_status,
        reconciliationStatus: orderResult.data.reconciliation_status,
      };
    }
  }

  return {
    id: dispatch.id,
    projectId: dispatch.project_id,
    programmingId: dispatch.programming_id,
    programmingCode: programmingCode(dispatch.programming_id),
    supplierId: dispatch.supplier_id,
    supplierName: supplierResult.data?.name ?? "Proveedor no disponible",
    status: dispatch.status,
    result: dispatch.result,
    guideId: guide?.id ?? null,
    guideNumber: guide?.guide_number ?? null,
    orderNumber: guide?.order_number ?? null,
    guideDate: guide?.guide_date ?? null,
    quantity: numeric(guide?.quantity),
    dispatchedQuantity: numeric(guide?.dispatched_quantity),
    receivedQuantity: numeric(guide?.received_quantity),
    returnedQuantity: numeric(guide?.returned_quantity),
    unitCode: guide?.unit_code ?? programming?.unit_code ?? null,
    receivedByName: guide?.received_by_name ?? null,
    incidentCount: incidents.length,
    createdAt: dispatch.created_at,
    version: dispatch.version,
    programmingStatus: programming?.status ?? "No disponible",
    programmingScheduledAt: programming?.scheduled_at ?? dispatch.created_at,
    requestedQuantity: numeric(programming?.requested_quantity) ?? 0,
    confirmedQuantity: numeric(programming?.confirmed_quantity),
    guideOrderNumber: guide?.order_number ?? null,
    loadAt: guide?.load_at ?? null,
    arrivalAt: guide?.arrival_at ?? null,
    departureAt: guide?.departure_at ?? null,
    guideTemplateVersionId: guide?.template_version_id ?? null,
    guideProviderExtraData: guide?.provider_extra_data ?? {},
    createdByName: creatorResult.data?.full_name || "Usuario no disponible",
    updatedAt: dispatch.updated_at,
    guideLines,
    incidents: mappedIncidents,
    documents,
    batches,
    invoices,
    incidentTypes: (incidentTypesResult.data ?? []).map((row) => ({ id: row.id, name: row.name })),
    units: (unitsResult.data ?? []).map((row) => ({ code: row.code, name: row.name })),
    orderContext,
  };
}
