import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizeOrderNumber } from "@/features/batches/queries";
import type { GlobalReconciliationData } from "./types";

function numeric(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }

export async function getGlobalReconciliation(projectId: string): Promise<GlobalReconciliationData> {
  const supabase = await createClient();
  const [ordersResult, batchesResult, suppliersResult, invoiceLinksResult, batchGuidesResult, linesResult] = await Promise.all([
    supabase.from("reconciliation_orders").select("id, batch_id, normalized_order_number, supplier_id, document_status, reconciliation_status").eq("project_id", projectId).order("updated_at", { ascending: false }),
    supabase.from("batches").select("id, code").eq("project_id", projectId).order("period_start", { ascending: false }),
    supabase.from("suppliers").select("id, name"),
    supabase.from("reconciliation_order_invoices").select("reconciliation_order_id, invoice_id").eq("project_id", projectId),
    supabase.from("batch_guides").select("batch_id, guide_id").eq("project_id", projectId).is("removed_at", null),
    supabase.from("reconciliation_order_lines").select("reconciliation_order_id, unit_code, difference").eq("project_id", projectId),
  ]);
  const error = ordersResult.error ?? batchesResult.error ?? suppliersResult.error ?? invoiceLinksResult.error ?? batchGuidesResult.error ?? linesResult.error;
  if (error) throw new Error(`No fue posible cargar Conciliación. ${error.message}`);
  const guideIds = [...new Set((batchGuidesResult.data ?? []).map((row) => row.guide_id))];
  const guidesResult = guideIds.length ? await supabase.from("dispatch_guides").select("id, order_number").eq("project_id", projectId).in("id", guideIds) : { data: [], error: null };
  if (guidesResult.error) throw new Error("No fue posible contar las Guides por Pedido.");
  const guides = new Map((guidesResult.data ?? []).map((row) => [row.id, row]));
  const batches = new Map((batchesResult.data ?? []).map((row) => [row.id, row.code]));
  const suppliers = new Map((suppliersResult.data ?? []).map((row) => [row.id, row.name]));
  return {
    batches: batchesResult.data ?? [],
    items: (ordersResult.data ?? []).map((order) => {
      const orderLines = (linesResult.data ?? []).filter((line) => line.reconciliation_order_id === order.id);
      return {
        id: order.id, batchId: order.batch_id, batchCode: batches.get(order.batch_id) ?? "Lote",
        orderNumber: order.normalized_order_number, supplierName: order.supplier_id ? suppliers.get(order.supplier_id) ?? "Proveedor no disponible" : "Proveedor por revisar",
        guideCount: (batchGuidesResult.data ?? []).filter((link) => link.batch_id === order.batch_id && normalizeOrderNumber(guides.get(link.guide_id)?.order_number) === order.normalized_order_number).length,
        invoiceCount: (invoiceLinksResult.data ?? []).filter((link) => link.reconciliation_order_id === order.id).length,
        documentStatus: order.document_status, reconciliationStatus: order.reconciliation_status,
        difference: orderLines.reduce((sum, line) => sum + Math.abs(numeric(line.difference)), 0),
        differenceUnits: [...new Set(orderLines.flatMap((line) => line.unit_code ? [line.unit_code] : []))],
      };
    }),
  };
}
