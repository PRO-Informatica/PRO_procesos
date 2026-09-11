import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { formatProgrammingCode } from "./formatters";
import type {
  BatchDetail, BatchDispatchRelation, BatchInvoice, BatchPageData,
  BatchRolloverPreview, BatchSecondaryData, BatchSource, BatchStatus, BatchSummary,
  EligibleBatchDispatch, ReconciliationAttempt, ReconciliationStatus,
  UniversalBatchProject,
} from "./types";
import type { ProjectAccessScope } from "@/features/projects/types";
import { getOperationalProjectAccess, getOperationalProjectAccessForProject } from "@/features/projects/queries";

type BatchRow = { id: string; project_id: string; code: string; period_start: string; period_end: string; accounting_period: string; status: BatchStatus; creation_source: BatchSource; created_at: string };
type RelationRow = { id: string; project_id: string; batch_id: string; dispatch_id: string; assignment_source: BatchSource; added_at: string; removed_at: string | null; removed_by: string | null; removal_reason: string | null; rolled_to_batch_id: string | null; removal_metadata: Record<string, unknown> | null };
type DispatchRow = { id: string; programming_id: string; supplier_id: string; order_number: string | null; status: "IN_EXECUTION" | "COMPLETED"; real_volume: number | string | null; real_unit_code: string | null };
type ReconciliationRow = { id: string; project_id?: string; dispatch_id: string; status: ReconciliationStatus; current_product_invoice_id: string | null; current_service_invoice_id: string | null };
type InvoiceRow = { id: string; dispatch_id: string; invoice_type: "PRODUCT" | "SERVICE"; invoice_number: string; invoice_date: string; status: string; total: number | string; currency: string; order_number: string | null; pca_original: string | null; replaces_invoice_id: string | null; created_at: string };
type RecipientExceptionRow = { id: string; invoice_id: string; status: "PENDING" | "APPROVED" | "REINVOICE_REQUESTED"; detected_billing_legal_name: string; detected_identity: string; decided_at: string | null };

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localDate(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).formatToParts(new Date());
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function summarize(batch: BatchRow, relations: RelationRow[], reconciliations: ReconciliationRow[], today: string): BatchSummary {
  const active = relations.filter((row) => row.batch_id === batch.id && !row.removed_at);
  const statusByDispatch = new Map(reconciliations.map((row) => [row.dispatch_id, row.status]));
  const reconciledCount = active.filter((row) => statusByDispatch.get(row.dispatch_id) === "RECONCILED").length;
  return {
    id: batch.id, code: batch.code, periodStart: batch.period_start,
    periodEnd: batch.period_end, accountingPeriod: batch.accounting_period,
    status: batch.status, source: batch.creation_source,
    activeDispatchCount: active.length, reconciledCount,
    pendingCount: active.length - reconciledCount,
    rolloverCount: relations.filter((row) => row.batch_id === batch.id && row.rolled_to_batch_id).length,
    isCurrent: batch.period_start <= today && batch.period_end >= today,
  };
}

export async function getUniversalBatchScopes(userId: string) {
  return (await getOperationalProjectAccess(userId)).filter(({ project, roleCodes, permissions }) =>
    project.status === "ACTIVE" &&
    permissions.includes("batch.view") &&
    roleCodes.some((role) => ["PURCHASING", "COMPANY_ADMIN"].includes(role)),
  );
}

export async function getUniversalBatchScope(userId: string, projectId: string) {
  const scope = await getOperationalProjectAccessForProject(userId, projectId);
  if (!scope || scope.project.status !== "ACTIVE" || !scope.permissions.includes("batch.view") ||
    !scope.roleCodes.some((role) => ["PURCHASING", "COMPANY_ADMIN"].includes(role))) return null;
  return scope;
}

export async function getBatchPageData(projectId: string, timezone: string): Promise<BatchPageData> {
  const supabase = await createClient();
  const [batchesResult, relationsResult, reconciliationsResult] = await Promise.all([
    supabase.from("batches").select("id, project_id, code, period_start, period_end, accounting_period, status, creation_source, created_at").eq("project_id", projectId).order("period_start", { ascending: false }).limit(200),
    supabase.from("batch_dispatches").select("id, project_id, batch_id, dispatch_id, assignment_source, added_at, removed_at, removed_by, removal_reason, rolled_to_batch_id, removal_metadata").eq("project_id", projectId).order("added_at", { ascending: false }).limit(2000),
    supabase.from("dispatch_reconciliations").select("id, dispatch_id, status, current_product_invoice_id, current_service_invoice_id").eq("project_id", projectId),
  ]);
  const error = batchesResult.error ?? relationsResult.error ?? reconciliationsResult.error;
  if (error) throw new Error(`No fue posible cargar los lotes. ${error.message}`);
  const batches = (batchesResult.data ?? []) as BatchRow[];
  const relations = (relationsResult.data ?? []) as RelationRow[];
  const reconciliations = (reconciliationsResult.data ?? []) as ReconciliationRow[];
  const summaries = batches.map((batch) => summarize(batch, relations, reconciliations, localDate(timezone)));
  return { current: summaries.find((row) => row.isCurrent) ?? null, history: summaries };
}

export async function getUniversalBatchOverview(
  scopes: ProjectAccessScope[],
): Promise<UniversalBatchProject[]> {
  if (!scopes.length) return [];
  const supabase = await createClient();
  const projectIds = scopes.map(({ project }) => project.id);
  const [batchesResult, relationsResult, reconciliationsResult] = await Promise.all([
    supabase.from("batches").select("id, project_id, code, period_start, period_end, accounting_period, status, creation_source, created_at").in("project_id", projectIds).order("period_start", { ascending: false }).limit(1000),
    supabase.from("batch_dispatches").select("id, project_id, batch_id, dispatch_id, assignment_source, added_at, removed_at, removed_by, removal_reason, rolled_to_batch_id, removal_metadata").in("project_id", projectIds).order("added_at", { ascending: false }).limit(10000),
    supabase.from("dispatch_reconciliations").select("id, project_id, dispatch_id, status, current_product_invoice_id, current_service_invoice_id").in("project_id", projectIds).limit(10000),
  ]);
  const error = batchesResult.error ?? relationsResult.error ?? reconciliationsResult.error;
  if (error) throw new Error(`No fue posible cargar Lotes Universal. ${error.message}`);

  const batches = (batchesResult.data ?? []) as BatchRow[];
  const relations = (relationsResult.data ?? []) as RelationRow[];
  const reconciliations = (reconciliationsResult.data ?? []) as ReconciliationRow[];
  const batchesByProject = new Map<string, BatchRow[]>();
  const relationsByBatch = new Map<string, RelationRow[]>();
  const reconciliationsByProject = new Map<string, ReconciliationRow[]>();
  for (const batch of batches) {
    const rows = batchesByProject.get(batch.project_id) ?? [];
    rows.push(batch);
    batchesByProject.set(batch.project_id, rows);
  }
  for (const relation of relations) {
    const rows = relationsByBatch.get(relation.batch_id) ?? [];
    rows.push(relation);
    relationsByBatch.set(relation.batch_id, rows);
  }
  for (const reconciliation of reconciliations) {
    if (!reconciliation.project_id) continue;
    const rows = reconciliationsByProject.get(reconciliation.project_id) ?? [];
    rows.push(reconciliation);
    reconciliationsByProject.set(reconciliation.project_id, rows);
  }

  return scopes
    .map(({ project, roleCodes, permissions }) => ({
      project,
      roleCodes,
      permissions,
      batches: (batchesByProject.get(project.id) ?? [])
        .map((batch) => summarize(
          batch,
          relationsByBatch.get(batch.id) ?? [],
          reconciliationsByProject.get(project.id) ?? [],
          localDate(project.timezone),
        )),
    }))
    .sort((left, right) => left.project.name.localeCompare(right.project.name));
}

export async function getBatchDetail(
  projectId: string,
  batchId: string,
  timezone: string,
  { includeSecondary = true }: { includeSecondary?: boolean } = {},
): Promise<BatchDetail | null> {
  const startedAt = performance.now();
  const supabase = await createClient();
  const admin = createAdminClient();
  const relationsQuery = supabase.from("batch_dispatches").select("id, project_id, batch_id, dispatch_id, assignment_source, added_at, removed_at, removed_by, removal_reason, rolled_to_batch_id, removal_metadata").eq("project_id", projectId).eq("batch_id", batchId).order("added_at", { ascending: false });
  const [batchResult, relationsResult, activeProjectRelationsResult, dispatchesResult, previewResult] = await Promise.all([
    supabase.from("batches").select("id, project_id, code, period_start, period_end, accounting_period, status, creation_source, created_at").eq("project_id", projectId).eq("id", batchId).maybeSingle(),
    includeSecondary ? relationsQuery : relationsQuery.is("removed_at", null),
    supabase.from("batch_dispatches").select("dispatch_id").eq("project_id", projectId).is("removed_at", null),
    supabase.from("dispatches").select("id, programming_id, supplier_id, order_number, status, real_volume, real_unit_code").eq("project_id", projectId).in("status", ["IN_EXECUTION", "COMPLETED"]),
    includeSecondary ? supabase.rpc("preview_weekly_batch_rollover", { p_batch_id: batchId }) : Promise.resolve({ data: [], error: null }),
  ]);
  const rootError = batchResult.error ?? relationsResult.error ?? activeProjectRelationsResult.error ?? dispatchesResult.error ?? previewResult.error;
  if (rootError) throw new Error(`No fue posible cargar el detalle del lote. ${rootError.message}`);
  if (!batchResult.data) return null;
  const batch = batchResult.data as BatchRow;
  const relations = (relationsResult.data ?? []) as RelationRow[];
  const dispatches = (dispatchesResult.data ?? []) as DispatchRow[];
  const dispatchIds = [...new Set(relations.map((row) => row.dispatch_id))];
  const programmingIds = [...new Set(dispatches.map((row) => row.programming_id))];
  const supplierIds = [...new Set(dispatches.map((row) => row.supplier_id))];

  const [programmingResult, suppliersResult, guidesResult, reconciliationsResult, invoicesResult, attemptsResult, exceptionsResult, profilesResult] = await Promise.all([
    programmingIds.length ? supabase.from("programming").select("id, scheduled_at").eq("project_id", projectId).in("id", programmingIds) : Promise.resolve({ data: [], error: null }),
    supplierIds.length ? supabase.from("suppliers").select("id, name").in("id", supplierIds) : Promise.resolve({ data: [], error: null }),
    dispatchIds.length ? supabase.from("dispatch_guides").select("id, dispatch_id").eq("project_id", projectId).in("dispatch_id", dispatchIds) : Promise.resolve({ data: [], error: null }),
    dispatchIds.length ? supabase.from("dispatch_reconciliations").select("id, dispatch_id, status, current_product_invoice_id, current_service_invoice_id").eq("project_id", projectId).in("dispatch_id", dispatchIds) : Promise.resolve({ data: [], error: null }),
    dispatchIds.length ? supabase.from("invoices").select("id, dispatch_id, invoice_type, invoice_number, invoice_date, status, total, currency, order_number, pca_original, replaces_invoice_id, created_at").eq("project_id", projectId).in("dispatch_id", dispatchIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    dispatchIds.length ? supabase.from("dispatch_reconciliation_attempts").select("id, dispatch_id, product_invoice_id, attempt_number, expected_order_number, detected_order_number, expected_real_volume, expected_unit_code, invoiced_quantity, invoice_unit_code, difference, validations, result, executed_by, executed_at").eq("project_id", projectId).in("dispatch_id", dispatchIds).order("executed_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    dispatchIds.length ? supabase.from("invoice_recipient_exceptions").select("id, invoice_id, status, detected_billing_legal_name, detected_identity, decided_at").eq("project_id", projectId).in("dispatch_id", dispatchIds) : Promise.resolve({ data: [], error: null }),
    includeSecondary && relations.some((row) => row.removed_by) ? admin.from("profiles").select("id, full_name").in("id", relations.flatMap((row) => row.removed_by ? [row.removed_by] : [])) : Promise.resolve({ data: [], error: null }),
  ]);
  const relatedError = programmingResult.error ?? suppliersResult.error ?? guidesResult.error ?? reconciliationsResult.error ?? invoicesResult.error ?? attemptsResult.error ?? exceptionsResult.error ?? profilesResult.error;
  if (relatedError) throw new Error(`No fue posible resolver los datos del lote. ${relatedError.message}`);
  const reconciliations = (reconciliationsResult.data ?? []) as ReconciliationRow[];
  const invoices = (invoicesResult.data ?? []) as InvoiceRow[];
  const exceptionByInvoice = new Map(((exceptionsResult.data ?? []) as RecipientExceptionRow[]).map((row) => [row.invoice_id, row]));

  const programmingById = new Map((programmingResult.data ?? []).map((row) => [row.id, row]));
  const supplierNames = new Map((suppliersResult.data ?? []).map((row) => [row.id, row.name]));
  const profileNames = new Map((profilesResult.data ?? []).map((row) => [row.id, row.full_name]));
  const guideCount = new Map<string, number>();
  for (const guide of guidesResult.data ?? []) guideCount.set(guide.dispatch_id, (guideCount.get(guide.dispatch_id) ?? 0) + 1);
  const invoiceViewById = new Map<string, BatchInvoice>();
  for (const invoice of invoices) {
    const recipientException = exceptionByInvoice.get(invoice.id);
    invoiceViewById.set(invoice.id, {
      id: invoice.id, dispatchId: invoice.dispatch_id, type: invoice.invoice_type,
      number: invoice.invoice_number, date: invoice.invoice_date,
      status: invoice.status, total: numeric(invoice.total), currency: invoice.currency,
      orderNumber: invoice.order_number, pcaOriginal: invoice.pca_original,
      replacesInvoiceId: invoice.replaces_invoice_id,
      replacedByInvoiceId: invoices.find((row) => row.replaces_invoice_id === invoice.id)?.id ?? null,
      documentId: null, fileName: null,
      extractionId: null, extractionPayload: null,
      createdAt: invoice.created_at,
      recipientException: recipientException ? {
        id: recipientException.id,
        invoiceId: recipientException.invoice_id,
        status: recipientException.status,
        detectedBillingLegalName: recipientException.detected_billing_legal_name,
        detectedIdentity: recipientException.detected_identity,
        decidedByName: null,
        decidedAt: recipientException.decided_at,
      } : null,
    });
  }
  const attempts = attemptsResult.data ?? [];
  const latestAttemptByDispatch = new Map<string, ReconciliationAttempt>();
  for (const attempt of attempts) if (!latestAttemptByDispatch.has(attempt.dispatch_id)) latestAttemptByDispatch.set(attempt.dispatch_id, {
    id: attempt.id, attemptNumber: attempt.attempt_number, productInvoiceId: attempt.product_invoice_id,
    expectedOrderNumber: attempt.expected_order_number, detectedOrderNumber: attempt.detected_order_number,
    expectedRealVolume: numeric(attempt.expected_real_volume), expectedUnitCode: attempt.expected_unit_code,
    invoicedQuantity: numeric(attempt.invoiced_quantity), invoiceUnitCode: attempt.invoice_unit_code,
    difference: attempt.difference === null ? null : numeric(attempt.difference),
    validations: attempt.validations as Record<string, boolean>, result: attempt.result,
    executedAt: attempt.executed_at, executedByName: "Usuario",
  });
  const reconciliationByDispatch = new Map(reconciliations.map((row) => [row.dispatch_id, row]));
  const dispatchById = new Map(dispatches.map((row) => [row.id, row]));
  const relationView: BatchDispatchRelation[] = relations.flatMap((relation) => {
    const dispatch = dispatchById.get(relation.dispatch_id);
    if (!dispatch) return [];
    const reconciliation = reconciliationByDispatch.get(dispatch.id);
    return [{
      relationId: relation.id, active: !relation.removed_at,
      assignmentSource: relation.assignment_source, addedAt: relation.added_at,
      removedAt: relation.removed_at,
      removedByName: relation.removed_by ? profileNames.get(relation.removed_by) ?? "Usuario" : null,
      removalReason: relation.removal_reason,
      removalSource: typeof relation.removal_metadata?.source === "string" ? relation.removal_metadata.source : null,
      rolledToBatchId: relation.rolled_to_batch_id, dispatchId: dispatch.id,
      programmingId: dispatch.programming_id, programmingCode: formatProgrammingCode(dispatch.programming_id),
      orderNumber: dispatch.order_number,
      supplierName: supplierNames.get(dispatch.supplier_id) ?? "Proveedor no disponible",
      scheduledAt: programmingById.get(dispatch.programming_id)?.scheduled_at ?? relation.added_at,
      operationalStatus: dispatch.status,
      realVolume: dispatch.real_volume === null ? null : numeric(dispatch.real_volume),
      realUnitCode: dispatch.real_unit_code, guideCount: guideCount.get(dispatch.id) ?? 0,
      reconciliationId: reconciliation?.id ?? null,
      reconciliationStatus: reconciliation?.status ?? "NOT_STARTED",
      productInvoice: reconciliation?.current_product_invoice_id ? invoiceViewById.get(reconciliation.current_product_invoice_id) ?? null : null,
      serviceInvoice: reconciliation?.current_service_invoice_id ? invoiceViewById.get(reconciliation.current_service_invoice_id) ?? null : null,
      latestAttempt: latestAttemptByDispatch.get(dispatch.id) ?? null,
    }];
  });
  const activeDispatchIds = new Set((activeProjectRelationsResult.data ?? []).map((row) => row.dispatch_id));
  const eligibleDispatches: EligibleBatchDispatch[] = dispatches.filter((dispatch) => !activeDispatchIds.has(dispatch.id)).map((dispatch) => ({
    dispatchId: dispatch.id, programmingCode: formatProgrammingCode(dispatch.programming_id),
    orderNumber: dispatch.order_number,
    supplierName: supplierNames.get(dispatch.supplier_id) ?? "Proveedor no disponible",
    scheduledAt: programmingById.get(dispatch.programming_id)?.scheduled_at ?? "",
    operationalStatus: dispatch.status,
    realVolume: dispatch.real_volume === null ? null : numeric(dispatch.real_volume),
    realUnitCode: dispatch.real_unit_code,
  }));
  const preview: BatchRolloverPreview[] = (previewResult.data ?? []).map((row: Record<string, unknown>) => ({
    batchDispatchId: String(row.batch_dispatch_id), dispatchId: String(row.dispatch_id),
    programmingCode: formatProgrammingCode(String(row.dispatch_id)),
    reconciled: Boolean(row.reconciled), action: row.rollover_action as "STAY" | "MOVE",
    reason: String(row.rollover_reason), destinationBatchId: row.destination_batch_id ? String(row.destination_batch_id) : null,
    destinationPeriodStart: String(row.destination_period_start), destinationPeriodEnd: String(row.destination_period_end),
    destinationAccountingPeriod: String(row.destination_accounting_period),
  }));
  const summary = summarize(batch, relations, reconciliations, localDate(timezone));
  const queryCount = 4 + (includeSecondary ? 1 : 0) +
    Number(programmingIds.length > 0) + Number(supplierIds.length > 0) +
    (dispatchIds.length > 0 ? 5 : 0) +
    Number(includeSecondary && relations.some((row) => row.removed_by));
  return {
    ...summary,
    projectId,
    activeRelations: relationView.filter((row) => row.active),
    removedRelations: relationView.filter((row) => !row.active),
    eligibleDispatches,
    preview,
    secondaryLoaded: includeSecondary,
    loadMetrics: {
      queryCount,
      stageCount: 2,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    },
  };
}

export async function getBatchSecondaryData(
  projectId: string,
  batchId: string,
): Promise<BatchSecondaryData | null> {
  const startedAt = performance.now();
  const supabase = await createClient();
  const admin = createAdminClient();
  const [batchResult, relationsResult, previewResult] = await Promise.all([
    supabase.from("batches").select("id").eq("project_id", projectId).eq("id", batchId).maybeSingle(),
    supabase.from("batch_dispatches").select("id, project_id, batch_id, dispatch_id, assignment_source, added_at, removed_at, removed_by, removal_reason, rolled_to_batch_id, removal_metadata").eq("project_id", projectId).eq("batch_id", batchId).not("removed_at", "is", null).order("removed_at", { ascending: false }),
    supabase.rpc("preview_weekly_batch_rollover", { p_batch_id: batchId }),
  ]);
  const rootError = batchResult.error ?? relationsResult.error ?? previewResult.error;
  if (rootError) throw new Error(`No fue posible cargar los datos secundarios del lote. ${rootError.message}`);
  if (!batchResult.data) return null;
  const relations = (relationsResult.data ?? []) as RelationRow[];
  const dispatchIds = [...new Set(relations.map((row) => row.dispatch_id))];
  const removedByIds = [...new Set(relations.flatMap((row) => row.removed_by ? [row.removed_by] : []))];
  const [dispatchesResult, profilesResult] = await Promise.all([
    dispatchIds.length ? supabase.from("dispatches").select("id, programming_id, supplier_id, order_number, status, real_volume, real_unit_code").eq("project_id", projectId).in("id", dispatchIds) : Promise.resolve({ data: [], error: null }),
    removedByIds.length ? admin.from("profiles").select("id, full_name").in("id", removedByIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (dispatchesResult.error ?? profilesResult.error) throw new Error("No fue posible resolver el historial removido.");
  const dispatches = (dispatchesResult.data ?? []) as DispatchRow[];
  const programmingIds = [...new Set(dispatches.map((row) => row.programming_id))];
  const supplierIds = [...new Set(dispatches.map((row) => row.supplier_id))];
  const [programmingResult, suppliersResult] = await Promise.all([
    programmingIds.length ? supabase.from("programming").select("id, scheduled_at").eq("project_id", projectId).in("id", programmingIds) : Promise.resolve({ data: [], error: null }),
    supplierIds.length ? supabase.from("suppliers").select("id, name").in("id", supplierIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (programmingResult.error ?? suppliersResult.error) throw new Error("No fue posible completar el historial removido.");
  const dispatchById = new Map(dispatches.map((row) => [row.id, row]));
  const programmingById = new Map((programmingResult.data ?? []).map((row) => [row.id, row]));
  const supplierNames = new Map((suppliersResult.data ?? []).map((row) => [row.id, row.name]));
  const profileNames = new Map((profilesResult.data ?? []).map((row) => [row.id, row.full_name]));
  const removedRelations: BatchDispatchRelation[] = relations.flatMap((relation) => {
    const dispatch = dispatchById.get(relation.dispatch_id);
    if (!dispatch) return [];
    return [{
      relationId: relation.id, active: false, assignmentSource: relation.assignment_source,
      addedAt: relation.added_at, removedAt: relation.removed_at,
      removedByName: relation.removed_by ? profileNames.get(relation.removed_by) ?? "Usuario" : null,
      removalReason: relation.removal_reason,
      removalSource: typeof relation.removal_metadata?.source === "string" ? relation.removal_metadata.source : null,
      rolledToBatchId: relation.rolled_to_batch_id, dispatchId: dispatch.id,
      programmingId: dispatch.programming_id, programmingCode: formatProgrammingCode(dispatch.programming_id),
      orderNumber: dispatch.order_number,
      supplierName: supplierNames.get(dispatch.supplier_id) ?? "Proveedor no disponible",
      scheduledAt: programmingById.get(dispatch.programming_id)?.scheduled_at ?? relation.added_at,
      operationalStatus: dispatch.status, realVolume: dispatch.real_volume === null ? null : numeric(dispatch.real_volume),
      realUnitCode: dispatch.real_unit_code, guideCount: 0, reconciliationId: null,
      reconciliationStatus: "NOT_STARTED", productInvoice: null, serviceInvoice: null, latestAttempt: null,
    }];
  });
  const preview: BatchRolloverPreview[] = (previewResult.data ?? []).map((row: Record<string, unknown>) => ({
    batchDispatchId: String(row.batch_dispatch_id), dispatchId: String(row.dispatch_id),
    programmingCode: formatProgrammingCode(String(row.dispatch_id)), reconciled: Boolean(row.reconciled),
    action: row.rollover_action as "STAY" | "MOVE", reason: String(row.rollover_reason),
    destinationBatchId: row.destination_batch_id ? String(row.destination_batch_id) : null,
    destinationPeriodStart: String(row.destination_period_start), destinationPeriodEnd: String(row.destination_period_end),
    destinationAccountingPeriod: String(row.destination_accounting_period),
  }));
  const queryCount = 3 + Number(dispatchIds.length > 0) + Number(removedByIds.length > 0) +
    Number(programmingIds.length > 0) + Number(supplierIds.length > 0);
  return {
    removedRelations,
    preview,
    loadMetrics: { queryCount, stageCount: 3, durationMs: Math.round((performance.now() - startedAt) * 10) / 10 },
  };
}
