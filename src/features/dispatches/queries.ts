import "server-only";

import { createClient } from "@/lib/supabase/server";

import { formatIdentifier } from "./formatters";
import type {
  DispatchBatchRelation,
  DispatchDetail,
  DispatchDocument,
  DispatchGuide,
  DispatchGuideLine,
  DispatchIncident,
  DispatchPageData,
  DispatchResult,
  DispatchStatus,
  ProgrammingDispatchItem,
  ProgrammingDispatchStatus,
} from "./types";

type ProgrammingRow = {
  id: string;
  supplier_id: string;
  status: ProgrammingDispatchStatus;
  scheduled_at: string;
  requested_quantity: number | string;
  confirmed_quantity: number | string | null;
  unit_code: string;
};
type DispatchRow = {
  id: string;
  project_id: string;
  supplier_id: string;
  programming_id: string;
  status: DispatchStatus;
  result: DispatchResult | null;
  version: number;
  arrival_at: string | null;
  departure_at: string | null;
  received_by_name: string | null;
  order_number: string | null;
  real_volume: number | string | null;
  real_unit_code: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type GuideRow = {
  id: string;
  dispatch_id: string;
  guide_number: string;
  guide_date: string;
  quantity: number | string;
  unit_code: string;
};
type LineRow = {
  id: string;
  guide_id: string;
  position: number;
  product_code: string;
  product_description: string;
  quantity: number | string;
  unit_code: string;
};

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assertNoError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context} ${error.message}`);
}

function buildGuides(guides: GuideRow[], lines: LineRow[]) {
  const linesByGuide = new Map<string, DispatchGuideLine[]>();
  for (const line of lines) {
    const values = linesByGuide.get(line.guide_id) ?? [];
    values.push({
      id: line.id,
      position: line.position,
      productCode: line.product_code,
      productDescription: line.product_description,
      quantity: numberValue(line.quantity),
      unitCode: line.unit_code,
    });
    linesByGuide.set(line.guide_id, values);
  }
  return guides.map<DispatchGuide>((guide) => {
    const guideLines = (linesByGuide.get(guide.id) ?? []).sort(
      (left, right) => left.position - right.position,
    );
    return {
      id: guide.id,
      guideNumber: guide.guide_number,
      guideDate: guide.guide_date,
      quantity: numberValue(guide.quantity),
      unitCode: guide.unit_code,
      productCount: guideLines.length,
      lines: guideLines,
    };
  });
}

export async function getDispatchPageData(
  projectId: string,
): Promise<DispatchPageData> {
  const supabase = await createClient();
  const [programmingResult, dispatchResult, unitsResult] = await Promise.all([
    supabase
      .from("programming")
      .select(
        "id, supplier_id, status, scheduled_at, requested_quantity, confirmed_quantity, unit_code",
      )
      .eq("project_id", projectId)
      .in("status", ["CONFIRMED", "IN_EXECUTION"])
      .order("scheduled_at"),
    supabase
      .from("dispatches")
      .select(
        "id, project_id, supplier_id, programming_id, status, result, version, arrival_at, departure_at, received_by_name, order_number, real_volume, real_unit_code, completed_at, created_by, created_at, updated_at",
      )
      .eq("project_id", projectId),
    supabase
      .from("units_of_measure")
      .select("code, name")
      .eq("active", true)
      .order("code"),
  ]);
  assertNoError(programmingResult.error, "No fue posible cargar las programaciones.");
  assertNoError(dispatchResult.error, "No fue posible cargar los despachos.");
  assertNoError(unitsResult.error, "No fue posible cargar las unidades.");

  const programming = (programmingResult.data ?? []) as ProgrammingRow[];
  const dispatches = (dispatchResult.data ?? []) as DispatchRow[];
  const dispatchIds = dispatches.map((row) => row.id);
  const supplierIds = [...new Set(programming.map((row) => row.supplier_id))];
  const [guidesResult, suppliersResult] = await Promise.all([
    dispatchIds.length
      ? supabase
          .from("dispatch_guides")
          .select("id, dispatch_id, guide_number, guide_date, quantity, unit_code")
          .eq("project_id", projectId)
          .in("dispatch_id", dispatchIds)
          .order("guide_date")
      : Promise.resolve({ data: [], error: null }),
    supplierIds.length
      ? supabase.from("suppliers").select("id, name").in("id", supplierIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  assertNoError(guidesResult.error, "No fue posible cargar las guías.");
  assertNoError(suppliersResult.error, "No fue posible cargar los proveedores.");
  const guideRows = (guidesResult.data ?? []) as GuideRow[];
  const guideIds = guideRows.map((row) => row.id);
  const linesResult = guideIds.length
    ? await supabase
        .from("dispatch_guide_lines")
        .select(
          "id, guide_id, position, product_code, product_description, quantity, unit_code",
        )
        .eq("project_id", projectId)
        .in("guide_id", guideIds)
    : { data: [], error: null };
  assertNoError(linesResult.error, "No fue posible cargar los productos.");

  const dispatchByProgramming = new Map(
    dispatches.map((row) => [row.programming_id, row]),
  );
  const supplierNames = new Map(
    (suppliersResult.data ?? []).map((row) => [row.id, row.name]),
  );
  const allGuides = buildGuides(guideRows, (linesResult.data ?? []) as LineRow[]);
  const guidesByDispatch = new Map<string, DispatchGuide[]>();
  for (const guide of allGuides) {
    const dispatchId = guideRows.find((row) => row.id === guide.id)?.dispatch_id;
    if (!dispatchId) continue;
    const values = guidesByDispatch.get(dispatchId) ?? [];
    values.push(guide);
    guidesByDispatch.set(dispatchId, values);
  }

  const items = programming.map<ProgrammingDispatchItem>((row) => {
    const dispatch = dispatchByProgramming.get(row.id);
    const guides = dispatch ? (guidesByDispatch.get(dispatch.id) ?? []) : [];
    return {
      programmingId: row.id,
      programmingCode: formatIdentifier("PRG", row.id),
      programmingStatus: row.status,
      scheduledAt: row.scheduled_at,
      supplierId: row.supplier_id,
      supplierName: supplierNames.get(row.supplier_id) ?? "Proveedor no disponible",
      programmedVolume:
        row.confirmed_quantity === null
          ? numberValue(row.requested_quantity)
          : numberValue(row.confirmed_quantity),
      unitCode: row.unit_code,
      dispatchId: dispatch?.id ?? null,
      dispatchStatus: dispatch?.status ?? null,
      result: dispatch?.result ?? null,
      realVolume:
        dispatch?.real_volume === null || dispatch?.real_volume === undefined
          ? null
          : numberValue(dispatch.real_volume),
      realUnitCode: dispatch?.real_unit_code ?? null,
      version: dispatch?.version ?? null,
      guideCount: guides.length,
      guideTotal: guides.reduce((total, guide) => total + guide.quantity, 0),
      guides,
    };
  });

  return {
    items,
    units: (unitsResult.data ?? []).map((row) => ({
      code: row.code,
      name: row.name,
    })),
  };
}

export async function getDispatchDetail(
  projectId: string,
  dispatchId: string,
): Promise<DispatchDetail | null> {
  const supabase = await createClient();
  const dispatchResult = await supabase
    .from("dispatches")
    .select(
      "id, project_id, supplier_id, programming_id, status, result, version, arrival_at, departure_at, received_by_name, order_number, real_volume, real_unit_code, completed_at, created_by, created_at, updated_at",
    )
    .eq("project_id", projectId)
    .eq("id", dispatchId)
    .maybeSingle();
  assertNoError(dispatchResult.error, "No fue posible cargar el despacho.");
  if (!dispatchResult.data) return null;
  const dispatch = dispatchResult.data as DispatchRow;

  const [programmingResult, supplierResult, guidesResult, incidentsResult, unitsResult, typesResult] =
    await Promise.all([
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
        .from("dispatch_guides")
        .select("id, dispatch_id, guide_number, guide_date, quantity, unit_code")
        .eq("project_id", projectId)
        .eq("dispatch_id", dispatchId)
        .order("guide_date"),
      supabase
        .from("dispatch_incidents")
        .select(
          "id, incident_type_id, responsibility, charge_applicability, notes, reported_by, created_at",
        )
        .eq("project_id", projectId)
        .eq("dispatch_id", dispatchId)
        .order("created_at", { ascending: false }),
      supabase.from("units_of_measure").select("code, name").eq("active", true).order("code"),
      supabase.from("incident_types").select("id, name").eq("active", true).order("name"),
    ]);
  const errors = [
    programmingResult.error,
    supplierResult.error,
    guidesResult.error,
    incidentsResult.error,
    unitsResult.error,
    typesResult.error,
  ].find(Boolean);
  assertNoError(errors ?? null, "No fue posible resolver el detalle del despacho.");
  if (!programmingResult.data) return null;
  const programming = programmingResult.data as ProgrammingRow;
  const guideRows = (guidesResult.data ?? []) as GuideRow[];
  const guideIds = guideRows.map((row) => row.id);
  const rawIncidents = incidentsResult.data ?? [];
  const incidentIds = rawIncidents.map((row) => row.id);

  const [linesResult, dispatchDocsResult, guideDocsResult, incidentDocsResult, batchLinksResult, reconciliationResult, invoicesResult] =
    await Promise.all([
      guideIds.length
        ? supabase
            .from("dispatch_guide_lines")
            .select(
              "id, guide_id, position, product_code, product_description, quantity, unit_code",
            )
            .eq("project_id", projectId)
            .in("guide_id", guideIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("dispatch_documents")
        .select("document_id, dispatch_id, purpose")
        .eq("project_id", projectId)
        .eq("dispatch_id", dispatchId),
      guideIds.length
        ? supabase
            .from("guide_documents")
            .select("document_id, guide_id, purpose")
            .eq("project_id", projectId)
            .in("guide_id", guideIds)
        : Promise.resolve({ data: [], error: null }),
      incidentIds.length
        ? supabase
            .from("incident_documents")
            .select("document_id, incident_id, purpose")
            .eq("project_id", projectId)
            .in("incident_id", incidentIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("batch_dispatches")
        .select("id, dispatch_id, batch_id, removed_at")
        .eq("project_id", projectId)
        .eq("dispatch_id", dispatchId),
      supabase
        .from("dispatch_reconciliations")
        .select("status")
        .eq("project_id", projectId)
        .eq("dispatch_id", dispatchId)
        .maybeSingle(),
      supabase
        .from("invoices")
        .select("invoice_type, invoice_number, status, created_at")
        .eq("project_id", projectId)
        .eq("dispatch_id", dispatchId)
        .order("created_at", { ascending: false }),
    ]);
  const relationError = [
    linesResult.error,
    dispatchDocsResult.error,
    guideDocsResult.error,
    incidentDocsResult.error,
    batchLinksResult.error,
    reconciliationResult.error,
    invoicesResult.error,
  ].find(Boolean);
  assertNoError(relationError ?? null, "No fue posible cargar las relaciones del despacho.");

  const guides = buildGuides(guideRows, (linesResult.data ?? []) as LineRow[]);
  const reporterIds = [...new Set(rawIncidents.map((row) => row.reported_by))];
  const profileIds = [...new Set([dispatch.created_by, ...reporterIds])];
  const typeIds = [...new Set(rawIncidents.map((row) => row.incident_type_id))];
  const documentLinks = [
    ...(dispatchDocsResult.data ?? []).map((row) => ({
      documentId: row.document_id,
      context: "dispatch" as const,
      contextId: row.dispatch_id,
      purpose: row.purpose,
    })),
    ...(guideDocsResult.data ?? []).map((row) => ({
      documentId: row.document_id,
      context: "guide" as const,
      contextId: row.guide_id,
      purpose: row.purpose,
    })),
    ...(incidentDocsResult.data ?? []).map((row) => ({
      documentId: row.document_id,
      context: "incident" as const,
      contextId: row.incident_id,
      purpose: row.purpose,
    })),
  ];
  const documentIds = [...new Set(documentLinks.map((row) => row.documentId))];
  const batchIds = [...new Set((batchLinksResult.data ?? []).map((row) => row.batch_id))];
  const [profilesResult, incidentNamesResult, documentsResult, versionsResult, batchesResult] =
    await Promise.all([
      profileIds.length
        ? supabase.from("profiles").select("id, full_name").in("id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      typeIds.length
        ? supabase.from("incident_types").select("id, name").in("id", typeIds)
        : Promise.resolve({ data: [], error: null }),
      documentIds.length
        ? supabase
            .from("documents")
            .select("id, category, created_by, created_at")
            .in("id", documentIds)
        : Promise.resolve({ data: [], error: null }),
      documentIds.length
        ? supabase
            .from("document_versions")
            .select("id, document_id, file_name, mime_type, upload_status")
            .in("document_id", documentIds)
            .eq("is_current", true)
        : Promise.resolve({ data: [], error: null }),
      batchIds.length
        ? supabase
            .from("batches")
            .select("id, code, status, period_start, period_end")
            .in("id", batchIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
  const nestedError = [
    profilesResult.error,
    incidentNamesResult.error,
    documentsResult.error,
    versionsResult.error,
    batchesResult.error,
  ].find(Boolean);
  assertNoError(nestedError ?? null, "No fue posible cargar los datos relacionados.");

  const documentCreatorIds = [
    ...new Set(
      (documentsResult.data ?? [])
        .map((row) => row.created_by)
        .filter((id): id is string => Boolean(id) && !profileIds.includes(id)),
    ),
  ];
  const documentCreatorsResult = documentCreatorIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", documentCreatorIds)
    : { data: [], error: null };
  assertNoError(
    documentCreatorsResult.error,
    "No fue posible cargar los autores de las evidencias.",
  );
  const profileNames = new Map(
    [...(profilesResult.data ?? []), ...(documentCreatorsResult.data ?? [])].map(
      (row) => [row.id, row.full_name || "Usuario no disponible"],
    ),
  );
  const incidentNames = new Map(
    (incidentNamesResult.data ?? []).map((row) => [row.id, row.name]),
  );
  const incidents: DispatchIncident[] = rawIncidents.map((row) => ({
    id: row.id,
    typeName: incidentNames.get(row.incident_type_id) ?? "Incidencia",
    responsibility: row.responsibility,
    chargeApplicability: row.charge_applicability,
    notes: row.notes,
    reporterName: profileNames.get(row.reported_by) ?? "Usuario no disponible",
    createdAt: row.created_at,
  }));
  const documentsById = new Map((documentsResult.data ?? []).map((row) => [row.id, row]));
  const versionsByDocument = new Map(
    (versionsResult.data ?? []).map((row) => [row.document_id, row]),
  );
  const documents: DispatchDocument[] = documentLinks.map((link) => {
    const document = documentsById.get(link.documentId);
    const version = versionsByDocument.get(link.documentId);
    return {
      id: link.documentId,
      category: document?.category ?? "EVIDENCE",
      purpose: link.purpose,
      context: link.context,
      contextId: link.contextId,
      fileName: version?.file_name ?? null,
      mimeType: version?.mime_type ?? null,
      uploadStatus: version?.upload_status ?? null,
      versionId: version?.id ?? null,
      createdByName: profileNames.get(document?.created_by ?? "") ?? "Usuario no disponible",
      createdAt: document?.created_at ?? dispatch.created_at,
    };
  });
  const batchesById = new Map((batchesResult.data ?? []).map((row) => [row.id, row]));
  const batches: DispatchBatchRelation[] = (batchLinksResult.data ?? []).flatMap((link) => {
    const batch = batchesById.get(link.batch_id);
    if (!batch) return [];
    return [{
      relationId: link.id,
      batchId: batch.id,
      code: batch.code,
      status: batch.status,
      periodStart: batch.period_start,
      periodEnd: batch.period_end,
      removedAt: link.removed_at,
    }];
  });
  const activeInvoices = (invoicesResult.data ?? []).filter((invoice) => !["SUPERSEDED", "CANCELLED", "NON_PROCEEDING"].includes(invoice.status));
  const attemptsResult = reconciliationResult.data
    ? await supabase.from("dispatch_reconciliation_attempts").select("difference").eq("project_id", projectId).eq("dispatch_id", dispatchId).order("executed_at", { ascending: false }).limit(1)
    : { data: [], error: null };
  assertNoError(attemptsResult.error, "No fue posible cargar el último intento de conciliación.");
  const latestDifference = attemptsResult.data?.[0]?.difference;

  return {
    id: dispatch.id,
    projectId,
    programmingId: programming.id,
    programmingCode: formatIdentifier("PRG", programming.id),
    programmingStatus: programming.status,
    programmingScheduledAt: programming.scheduled_at,
    supplierId: dispatch.supplier_id,
    supplierName: supplierResult.data?.name ?? "Proveedor no disponible",
    programmedVolume:
      programming.confirmed_quantity === null
        ? numberValue(programming.requested_quantity)
        : numberValue(programming.confirmed_quantity),
    programmedUnitCode: programming.unit_code,
    status: dispatch.status,
    result: dispatch.result,
    version: dispatch.version,
    arrivalAt: dispatch.arrival_at,
    departureAt: dispatch.departure_at,
    receivedByName: dispatch.received_by_name,
    orderNumber: dispatch.order_number,
    realVolume: dispatch.real_volume === null ? null : numberValue(dispatch.real_volume),
    realUnitCode: dispatch.real_unit_code,
    completedAt: dispatch.completed_at,
    createdByName: profileNames.get(dispatch.created_by) ?? "Usuario no disponible",
    createdAt: dispatch.created_at,
    updatedAt: dispatch.updated_at,
    guideTotal: guides.reduce((total, guide) => total + guide.quantity, 0),
    guides,
    incidents,
    documents,
    batches,
    reconciliation: reconciliationResult.data ? {
      status: reconciliationResult.data.status,
      productInvoiceNumber: activeInvoices.find((invoice) => invoice.invoice_type === "PRODUCT")?.invoice_number ?? null,
      serviceInvoiceNumber: activeInvoices.find((invoice) => invoice.invoice_type === "SERVICE")?.invoice_number ?? null,
      latestDifference: latestDifference === null || latestDifference === undefined ? null : numberValue(latestDifference),
    } : null,
    incidentTypes: (typesResult.data ?? []).map((row) => ({ id: row.id, name: row.name })),
    units: (unitsResult.data ?? []).map((row) => ({ code: row.code, name: row.name })),
  };
}
