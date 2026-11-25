import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { readInvoiceIdentityRows } from "../dispatch-invoice-identity-queries";
import type { UniversalInvoiceType } from "../invoice-classification";
import { serviceReconciliationSummary } from "../service-reconciliation";
import {
  combinedInvoiceComparison,
  compareMixedInvoice,
  compareProductInvoice,
  compareServiceInvoice,
  comparisonFromServiceSummary,
  type MixedInvoiceTotals,
} from "./reconciliation-comparison";

type ProductAttempt = {
  comparison_basis: "REAL_VOLUME" | "PROGRAMMED_QUANTITY";
  comparison_quantity: number | string | null;
  comparison_unit_code: string | null;
  invoiced_quantity: number | string;
  invoice_unit_code: string | null;
  difference: number | string | null;
  product_amount_comparison?: unknown;
};

// All IDs must come from the server's already authorized project/dispatch or
// stored invoice lookup. Previewing never writes an invoice or reconciliation.
async function readGuidePriceSnapshots(client: SupabaseClient, projectId: string, dispatchId: string, serviceOnly: boolean) {
  const guides = await readInvoiceIdentityRows((from, to) => client.from("dispatch_guides").select("id")
    .eq("project_id", projectId).eq("dispatch_id", dispatchId).order("id").range(from, to));
  const lines = [];
  for (let index = 0; index < guides.length; index += 100) {
    lines.push(...await readInvoiceIdentityRows((from, to) => {
      const query = client.from("dispatch_guide_lines")
        .select("id, catalog_type, unit_price, estimated_subtotal::text, currency").eq("project_id", projectId)
        .in("guide_id", guides.slice(index, index + 100).map((guide) => guide.id)).gt("quantity", 0);
      return (serviceOnly ? query.eq("catalog_type", "SERVICE") : query).order("id").range(from, to);
    }));
  }
  return lines;
}

export async function previewServiceInvoiceComparison(client: SupabaseClient, projectId: string, dispatchId: string, total: number, currency: string) {
  const lines = await readGuidePriceSnapshots(client, projectId, dispatchId, true);
  return compareServiceInvoice(lines, total, currency);
}

export async function previewMixedInvoiceComparison(client: SupabaseClient, projectId: string, dispatchId: string, totals: MixedInvoiceTotals, currency: string) {
  const lines = await readGuidePriceSnapshots(client, projectId, dispatchId, false);
  return compareMixedInvoice(totals, currency, {
    product: lines.filter((line) => line.catalog_type === "PRODUCT" || line.catalog_type === null),
    service: lines.filter((line) => line.catalog_type === "SERVICE"),
  });
}

export async function storedInvoiceReconciliation(client: SupabaseClient, projectId: string, dispatchId: string, invoiceId: string, type: Exclude<UniversalInvoiceType, "UNKNOWN">) {
  const slot = type === "SERVICE" ? "current_service_invoice_id" : "current_product_invoice_id";
  const reconciliation = await client.from("dispatch_reconciliations")
    .select("status, service_status, service_comparison, current_product_invoice_id, current_service_invoice_id")
    .eq("project_id", projectId).eq("dispatch_id", dispatchId).eq(slot, invoiceId).maybeSingle();
  if (reconciliation.error) throw new Error("No fue posible consultar el resultado de conciliación de la factura.");
  if (!reconciliation.data) return null; // Never display a newer invoice's result for an older PDF.
  if (type === "SERVICE") {
    return { status: reconciliation.data.service_status as string, comparison: comparisonFromServiceSummary(serviceReconciliationSummary(reconciliation.data)) };
  }
  const mixed = type === "MIXED" && reconciliation.data.current_service_invoice_id === invoiceId;
  const attempt = await client.from("dispatch_reconciliation_attempts")
    .select(mixed
      ? "comparison_quantity, comparison_unit_code, comparison_basis, invoiced_quantity, invoice_unit_code, difference, product_amount_comparison"
      : "comparison_quantity, comparison_unit_code, comparison_basis, invoiced_quantity, invoice_unit_code, difference")
    .eq("project_id", projectId).eq("dispatch_id", dispatchId).eq("product_invoice_id", invoiceId)
    .order("attempt_number", { ascending: false }).limit(1).maybeSingle<ProductAttempt>();
  if (attempt.error) throw new Error("No fue posible consultar la diferencia de Producto.");
  const product = mixed && attempt.data && "product_amount_comparison" in attempt.data
    ? comparisonFromServiceSummary(serviceReconciliationSummary({ service_comparison: attempt.data.product_amount_comparison }), "PRODUCT_TOTAL") : null;
  const service = mixed ? comparisonFromServiceSummary(serviceReconciliationSummary(reconciliation.data)) : null;
  return {
    status: reconciliation.data.status as string,
    serviceStatus: mixed ? reconciliation.data.service_status as string : undefined,
    mixedComparison: product && service ? combinedInvoiceComparison(product, service) : undefined,
    comparison: attempt.data ? compareProductInvoice({
      comparison_basis: attempt.data.comparison_basis,
      comparison_quantity: attempt.data.comparison_quantity === null ? null : Number(attempt.data.comparison_quantity),
      comparison_unit_code: attempt.data.comparison_unit_code,
      invoiced_quantity: Number(attempt.data.invoiced_quantity), normalized_unit: attempt.data.invoice_unit_code,
      difference: attempt.data.difference === null ? null : Number(attempt.data.difference),
    }) : null,
  };
}
