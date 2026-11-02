import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { readInvoiceIdentityRows } from "../dispatch-invoice-identity-queries";
import { serviceReconciliationSummary } from "../service-reconciliation";
import { compareProductInvoice, compareServiceInvoice, comparisonFromServiceSummary } from "./reconciliation-comparison";

// All IDs must come from the server's already authorized project/dispatch or
// stored invoice lookup. Previewing never writes an invoice or reconciliation.
export async function previewServiceInvoiceComparison(client: SupabaseClient, projectId: string, dispatchId: string, total: number, currency: string) {
  const guides = await readInvoiceIdentityRows((from, to) => client.from("dispatch_guides").select("id")
    .eq("project_id", projectId).eq("dispatch_id", dispatchId).order("id").range(from, to));
  const lines = [];
  for (let index = 0; index < guides.length; index += 100) {
    lines.push(...await readInvoiceIdentityRows((from, to) => client.from("dispatch_guide_lines")
      .select("id, unit_price, estimated_subtotal::text, currency").eq("project_id", projectId)
      .in("guide_id", guides.slice(index, index + 100).map((guide) => guide.id))
      .eq("catalog_type", "SERVICE").order("id").range(from, to)));
  }
  return compareServiceInvoice(lines, total, currency);
}

export async function storedInvoiceReconciliation(client: SupabaseClient, projectId: string, dispatchId: string, invoiceId: string, type: "PRODUCT" | "SERVICE") {
  const slot = type === "SERVICE" ? "current_service_invoice_id" : "current_product_invoice_id";
  const reconciliation = await client.from("dispatch_reconciliations")
    .select("status, service_status, service_comparison, current_product_invoice_id, current_service_invoice_id")
    .eq("project_id", projectId).eq("dispatch_id", dispatchId).eq(slot, invoiceId).maybeSingle();
  if (reconciliation.error) throw new Error("No fue posible consultar el resultado de conciliación de la factura.");
  if (!reconciliation.data) return null; // Never display a newer invoice's result for an older PDF.
  if (type === "SERVICE") {
    return { status: reconciliation.data.service_status as string, comparison: comparisonFromServiceSummary(serviceReconciliationSummary(reconciliation.data)) };
  }
  const attempt = await client.from("dispatch_reconciliation_attempts")
    .select("comparison_quantity, comparison_unit_code, comparison_basis, invoiced_quantity, invoice_unit_code, difference")
    .eq("project_id", projectId).eq("dispatch_id", dispatchId).eq("product_invoice_id", invoiceId)
    .order("attempt_number", { ascending: false }).limit(1).maybeSingle();
  if (attempt.error) throw new Error("No fue posible consultar la diferencia de Producto.");
  return {
    status: reconciliation.data.status as string,
    comparison: attempt.data ? compareProductInvoice({
      comparison_basis: attempt.data.comparison_basis,
      comparison_quantity: attempt.data.comparison_quantity === null ? null : Number(attempt.data.comparison_quantity),
      comparison_unit_code: attempt.data.comparison_unit_code,
      invoiced_quantity: Number(attempt.data.invoiced_quantity), normalized_unit: attempt.data.invoice_unit_code,
      difference: attempt.data.difference === null ? null : Number(attempt.data.difference),
    }) : null,
  };
}
