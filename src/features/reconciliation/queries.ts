import "server-only";

import { formatProgrammingCode } from "@/features/batches/formatters";
import { resolveReconciliationQuantityBasis, selectValidProgrammedQuantity } from "@/features/invoices/reconciliation-quantity";
import { createClient } from "@/lib/supabase/server";

import type { GlobalReconciliationData } from "./types";

function numeric(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }

export async function getGlobalReconciliation(projectId: string): Promise<GlobalReconciliationData> {
  const supabase = await createClient();
  const [reconciliationsResult, batchesResult, relationsResult, dispatchesResult, suppliersResult, programmingResult, incidentsResult] = await Promise.all([
    supabase.from("dispatch_reconciliations").select("id, dispatch_id, status, current_product_invoice_id, current_service_invoice_id").eq("project_id", projectId).order("updated_at", { ascending: false }),
    supabase.from("batches").select("id, code").eq("project_id", projectId).order("period_start", { ascending: false }),
    supabase.from("batch_dispatches").select("batch_id, dispatch_id").eq("project_id", projectId).is("removed_at", null),
    supabase.from("dispatches").select("id, programming_id, supplier_id, order_number, real_volume, real_unit_code, result").eq("project_id", projectId),
    supabase.from("suppliers").select("id, name"),
    supabase.from("programming").select("id, requested_quantity, confirmed_quantity, unit_code").eq("project_id", projectId),
    supabase.from("dispatch_incidents").select("dispatch_id").eq("project_id", projectId),
  ]);
  const error = reconciliationsResult.error ?? batchesResult.error ?? relationsResult.error ?? dispatchesResult.error ?? suppliersResult.error ?? programmingResult.error ?? incidentsResult.error;
  if (error) throw new Error(`No fue posible cargar Conciliación. ${error.message}`);
  const dispatchIds = (reconciliationsResult.data ?? []).map((row) => row.dispatch_id);
  const attemptsResult = dispatchIds.length ? await supabase.from("dispatch_reconciliation_attempts").select("dispatch_id, expected_real_volume, expected_unit_code, comparison_quantity, comparison_unit_code, comparison_basis, difference").eq("project_id", projectId).in("dispatch_id", dispatchIds).order("executed_at", { ascending: false }) : { data: [], error: null };
  if (attemptsResult.error) throw new Error("No fue posible cargar los intentos de conciliación.");
  const batches = new Map((batchesResult.data ?? []).map((row) => [row.id, row.code]));
  const relations = new Map((relationsResult.data ?? []).map((row) => [row.dispatch_id, row.batch_id]));
  const dispatches = new Map((dispatchesResult.data ?? []).map((row) => [row.id, row]));
  const suppliers = new Map((suppliersResult.data ?? []).map((row) => [row.id, row.name]));
  const programming = new Map((programmingResult.data ?? []).map((row) => [row.id, row]));
  const incidentCounts = new Map<string, number>();
  for (const incident of incidentsResult.data ?? []) {
    incidentCounts.set(incident.dispatch_id, (incidentCounts.get(incident.dispatch_id) ?? 0) + 1);
  }
  const latestDifference = new Map<string, number | null>();
  const latestAttempts = new Map<string, {
    comparisonQuantity: number;
    comparisonUnitCode: string;
    source: "REAL_VOLUME" | "PROGRAMMED_QUANTITY";
  }>();
  for (const attempt of attemptsResult.data ?? []) {
    if (latestDifference.has(attempt.dispatch_id)) continue;
    latestDifference.set(attempt.dispatch_id, attempt.difference === null ? null : numeric(attempt.difference));
    latestAttempts.set(attempt.dispatch_id, {
      comparisonQuantity: numeric(attempt.comparison_quantity ?? attempt.expected_real_volume),
      comparisonUnitCode: attempt.comparison_unit_code ?? attempt.expected_unit_code ?? "—",
      source: attempt.comparison_basis === "PROGRAMMED_QUANTITY" ? "PROGRAMMED_QUANTITY" : "REAL_VOLUME",
    });
  }
  return {
    batches: batchesResult.data ?? [],
    items: (reconciliationsResult.data ?? []).flatMap((row) => {
      const dispatch = dispatches.get(row.dispatch_id);
      const batchId = relations.get(row.dispatch_id);
      if (!dispatch || !batchId) return [];
      const programmingItem = programming.get(dispatch.programming_id);
      const programmedQuantity = selectValidProgrammedQuantity(
        programmingItem?.confirmed_quantity == null ? null : numeric(programmingItem.confirmed_quantity),
        programmingItem?.requested_quantity == null ? null : numeric(programmingItem.requested_quantity),
      );
      const configuredBasis = resolveReconciliationQuantityBasis({
        dispatchResult: dispatch.result,
        incidentCount: incidentCounts.get(dispatch.id) ?? 0,
        realVolume: dispatch.real_volume === null ? null : numeric(dispatch.real_volume),
        realUnitCode: dispatch.real_unit_code,
        programmedQuantity: programmedQuantity === null ? null : numeric(programmedQuantity),
        programmedUnitCode: programmingItem?.unit_code ?? null,
      });
      const latestAttempt = latestAttempts.get(dispatch.id);
      return [{
        id: row.id, dispatchId: dispatch.id,
        programmingCode: formatProgrammingCode(dispatch.programming_id),
        batchId, batchCode: batches.get(batchId) ?? "Lote",
        orderNumber: dispatch.order_number ?? "Pendiente",
        supplierName: suppliers.get(dispatch.supplier_id) ?? "Proveedor no disponible",
        realVolume: numeric(dispatch.real_volume), unitCode: dispatch.real_unit_code ?? "—",
        comparisonQuantity: latestAttempt?.comparisonQuantity ?? configuredBasis.quantity,
        comparisonUnitCode: latestAttempt?.comparisonUnitCode ?? configuredBasis.unitCode ?? "—",
        comparisonSource: latestAttempt?.source ?? configuredBasis.source,
        invoiceCount: Number(Boolean(row.current_product_invoice_id)) + Number(Boolean(row.current_service_invoice_id)),
        hasProductInvoice: Boolean(row.current_product_invoice_id),
        hasServiceInvoice: Boolean(row.current_service_invoice_id),
        reconciliationStatus: row.status,
        difference: latestDifference.get(dispatch.id) ?? null,
      }];
    }),
  };
}
