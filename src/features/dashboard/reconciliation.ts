import { requiresServiceInvoice } from "../programming/invoice-policy.ts";

export type DashboardReconciliation = {
  dispatch_id: string;
  status: string;
  service_status: string | null;
  current_product_invoice_id: string | null;
  current_service_invoice_id: string | null;
};

export type DashboardBillingStatus = "pendingInvoices" | "pendingReconciliation" | "reinvoicing" | "reconciled";

// A dispatch occupies exactly one bucket. Issues on either current invoice take
// priority over missing invoices and completion, including optional services.
export function dashboardBillingStatus(
  reconciliation: DashboardReconciliation | undefined,
  deliveryModes: readonly string[] | null | undefined,
  billingComplete: boolean,
): DashboardBillingStatus {
  const needsService = requiresServiceInvoice(deliveryModes);
  const needsReinvoicing = (status: string | null | undefined) => status === "WITH_DIFFERENCES" || status === "PENDING_REINVOICING";
  if (needsReinvoicing(reconciliation?.status) || needsReinvoicing(reconciliation?.service_status)) return "reinvoicing";
  if (!reconciliation?.current_product_invoice_id || (needsService && !reconciliation.current_service_invoice_id)) return "pendingInvoices";
  // The authoritative completion result also checks operation completion and
  // pending recipient exceptions. A product-only match never suffices.
  if (billingComplete && reconciliation.status === "RECONCILED" && (!needsService || reconciliation.service_status === "RECONCILED")) return "reconciled";
  return "pendingReconciliation";
}
