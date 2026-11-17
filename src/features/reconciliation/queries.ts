import "server-only";
import { serviceReconciliationSummary } from "@/features/invoices/service-reconciliation";

import { formatProgrammingCode } from "@/features/batches/formatters";
import { resolveReconciliationQuantityBasis, selectValidProgrammedQuantity } from "@/features/invoices/reconciliation-quantity";
import { createClient } from "@/lib/supabase/server";
import { getDispatchBillingCompletion } from "@/features/dispatches/billing-completion-queries";
import { dashboardBillingStatus } from "@/features/dashboard/reconciliation";
import { requiresServiceInvoice } from "@/features/programming/invoice-policy";

import type { GlobalReconciliationData } from "./types";

function numeric(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }

async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await query(from, from + 499);
    if (error) throw new Error(`No fue posible cargar Conciliación. ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

export async function getGlobalReconciliation(projectId: string): Promise<GlobalReconciliationData> {
  const supabase = await createClient();
  const [reconciliations, batchRows, relationRows, dispatchRows, supplierRows, programmingRows, incidents, attempts, completion] = await Promise.all([
    readAll((from, to) => supabase.from("dispatch_reconciliations").select("id, dispatch_id, status, current_product_invoice_id, current_service_invoice_id, service_status, service_comparison").eq("project_id", projectId).order("updated_at", { ascending: false }).order("id").range(from, to)),
    readAll((from, to) => supabase.from("batches").select("id, code").eq("project_id", projectId).order("period_start", { ascending: false }).order("id").range(from, to)),
    readAll((from, to) => supabase.from("batch_dispatches").select("batch_id, dispatch_id").eq("project_id", projectId).is("removed_at", null).order("id").range(from, to)),
    readAll((from, to) => supabase.from("dispatches").select("id, programming_id, supplier_id, order_number, real_volume, real_unit_code, result").eq("project_id", projectId).order("created_at", { ascending: false }).order("id").range(from, to)),
    readAll((from, to) => supabase.from("suppliers").select("id, name").order("id").range(from, to)),
    readAll((from, to) => supabase.from("programming").select("id, requested_quantity, confirmed_quantity, unit_code, delivery_modes").eq("project_id", projectId).order("id").range(from, to)),
    readAll((from, to) => supabase.from("dispatch_incidents").select("dispatch_id").eq("project_id", projectId).order("id").range(from, to)),
    readAll((from, to) => supabase.from("dispatch_reconciliation_attempts").select("dispatch_id, expected_real_volume, expected_unit_code, comparison_quantity, comparison_unit_code, comparison_basis, difference").eq("project_id", projectId).order("executed_at", { ascending: false }).order("id").range(from, to)),
    getDispatchBillingCompletion([projectId]),
  ]);
  const batches = new Map(batchRows.map(row => [row.id, row.code]));
  const relations = new Map<string, Set<string>>();
  for (const row of relationRows) {
    if (!relations.has(row.dispatch_id)) relations.set(row.dispatch_id, new Set());
    relations.get(row.dispatch_id)!.add(row.batch_id);
  }
  const reconciliationByDispatch = new Map<string, (typeof reconciliations)[number]>();
  for (const row of reconciliations) if (!reconciliationByDispatch.has(row.dispatch_id)) reconciliationByDispatch.set(row.dispatch_id, row);
  const suppliers = new Map(supplierRows.map(row => [row.id, row.name]));
  const programming = new Map(programmingRows.map(row => [row.id, row]));
  const incidentCounts = new Map<string, number>();
  for (const incident of incidents) {
    incidentCounts.set(incident.dispatch_id, (incidentCounts.get(incident.dispatch_id) ?? 0) + 1);
  }
  const latestDifference = new Map<string, number | null>();
  const latestAttempts = new Map<string, {
    comparisonQuantity: number;
    comparisonUnitCode: string;
    source: "REAL_VOLUME" | "PROGRAMMED_QUANTITY";
  }>();
  for (const attempt of attempts) {
    if (latestDifference.has(attempt.dispatch_id)) continue;
    latestDifference.set(attempt.dispatch_id, attempt.difference === null ? null : numeric(attempt.difference));
    latestAttempts.set(attempt.dispatch_id, {
      comparisonQuantity: numeric(attempt.comparison_quantity ?? attempt.expected_real_volume),
      comparisonUnitCode: attempt.comparison_unit_code ?? attempt.expected_unit_code ?? "—",
      source: attempt.comparison_basis === "PROGRAMMED_QUANTITY" ? "PROGRAMMED_QUANTITY" : "REAL_VOLUME",
    });
  }
  return {
    batches: batchRows,
    items: dispatchRows.map((dispatch) => {
      const row = reconciliationByDispatch.get(dispatch.id);
      // One row per dispatch, including those still missing invoices or a batch.
      const batchIds = batchRows.filter(batch => relations.get(dispatch.id)?.has(batch.id)).map(batch => batch.id);
      const batchId = batchIds[0] ?? "";
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
      return {
        id: dispatch.id, dispatchId: dispatch.id,
        programmingCode: formatProgrammingCode(dispatch.programming_id),
        batchId, batchIds, batchCode: batches.get(batchId) ?? "Sin lote",
        billingStatus: dashboardBillingStatus(row, programmingItem?.delivery_modes, completion[dispatch.id] === true),
        requiresServiceInvoice: requiresServiceInvoice(programmingItem?.delivery_modes),
        orderNumber: dispatch.order_number ?? "Pendiente",
        supplierName: suppliers.get(dispatch.supplier_id) ?? "Proveedor no disponible",
        realVolume: numeric(dispatch.real_volume), unitCode: dispatch.real_unit_code ?? "—",
        comparisonQuantity: latestAttempt?.comparisonQuantity ?? configuredBasis.quantity,
        comparisonUnitCode: latestAttempt?.comparisonUnitCode ?? configuredBasis.unitCode ?? "—",
        comparisonSource: latestAttempt?.source ?? configuredBasis.source,
        invoiceCount: Number(Boolean(row?.current_product_invoice_id)) + Number(Boolean(row?.current_service_invoice_id)),
        hasProductInvoice: Boolean(row?.current_product_invoice_id),
        hasServiceInvoice: Boolean(row?.current_service_invoice_id),
        reconciliationStatus: row?.status ?? "NOT_STARTED",
        serviceReconciliation: serviceReconciliationSummary(row ?? {}),
        difference: latestDifference.get(dispatch.id) ?? null,
      };
    }),
  };
}
