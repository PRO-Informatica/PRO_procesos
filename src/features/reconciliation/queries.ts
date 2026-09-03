import "server-only";

import { formatProgrammingCode } from "@/features/batches/formatters";
import { createClient } from "@/lib/supabase/server";

import type { GlobalReconciliationData } from "./types";

function numeric(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }

export async function getGlobalReconciliation(projectId: string): Promise<GlobalReconciliationData> {
  const supabase = await createClient();
  const [reconciliationsResult, batchesResult, relationsResult, dispatchesResult, suppliersResult] = await Promise.all([
    supabase.from("dispatch_reconciliations").select("id, dispatch_id, status, current_product_invoice_id, current_service_invoice_id").eq("project_id", projectId).order("updated_at", { ascending: false }),
    supabase.from("batches").select("id, code").eq("project_id", projectId).order("period_start", { ascending: false }),
    supabase.from("batch_dispatches").select("batch_id, dispatch_id").eq("project_id", projectId).is("removed_at", null),
    supabase.from("dispatches").select("id, programming_id, supplier_id, order_number, real_volume, real_unit_code").eq("project_id", projectId),
    supabase.from("suppliers").select("id, name"),
  ]);
  const error = reconciliationsResult.error ?? batchesResult.error ?? relationsResult.error ?? dispatchesResult.error ?? suppliersResult.error;
  if (error) throw new Error(`No fue posible cargar Conciliación. ${error.message}`);
  const dispatchIds = (reconciliationsResult.data ?? []).map((row) => row.dispatch_id);
  const attemptsResult = dispatchIds.length ? await supabase.from("dispatch_reconciliation_attempts").select("dispatch_id, difference").eq("project_id", projectId).in("dispatch_id", dispatchIds).order("executed_at", { ascending: false }) : { data: [], error: null };
  if (attemptsResult.error) throw new Error("No fue posible cargar los intentos de conciliación.");
  const batches = new Map((batchesResult.data ?? []).map((row) => [row.id, row.code]));
  const relations = new Map((relationsResult.data ?? []).map((row) => [row.dispatch_id, row.batch_id]));
  const dispatches = new Map((dispatchesResult.data ?? []).map((row) => [row.id, row]));
  const suppliers = new Map((suppliersResult.data ?? []).map((row) => [row.id, row.name]));
  const latestDifference = new Map<string, number | null>();
  for (const attempt of attemptsResult.data ?? []) if (!latestDifference.has(attempt.dispatch_id)) latestDifference.set(attempt.dispatch_id, attempt.difference === null ? null : numeric(attempt.difference));
  return {
    batches: batchesResult.data ?? [],
    items: (reconciliationsResult.data ?? []).flatMap((row) => {
      const dispatch = dispatches.get(row.dispatch_id);
      const batchId = relations.get(row.dispatch_id);
      if (!dispatch || !batchId) return [];
      return [{
        id: row.id, dispatchId: dispatch.id,
        programmingCode: formatProgrammingCode(dispatch.programming_id),
        batchId, batchCode: batches.get(batchId) ?? "Lote",
        orderNumber: dispatch.order_number ?? "Pendiente",
        supplierName: suppliers.get(dispatch.supplier_id) ?? "Proveedor no disponible",
        realVolume: numeric(dispatch.real_volume), unitCode: dispatch.real_unit_code ?? "—",
        invoiceCount: Number(Boolean(row.current_product_invoice_id)) + Number(Boolean(row.current_service_invoice_id)),
        reconciliationStatus: row.status,
        difference: latestDifference.get(dispatch.id) ?? null,
      }];
    }),
  };
}
