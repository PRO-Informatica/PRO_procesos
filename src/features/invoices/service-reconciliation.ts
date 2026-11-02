export type ServiceReconciliationStatus = "NOT_STARTED" | "PENDING_RECONCILIATION" | "WITH_DIFFERENCES" | "PENDING_REINVOICING" | "RECONCILED";

export type ServiceReconciliationSummary = {
  status: ServiceReconciliationStatus;
  estimatedTotal: number | null;
  invoiceTotal: number | null;
  difference: number | null;
  currency: string;
  invoiceCurrency: string;
  complete: boolean;
  checkedAt: string | null;
};

export function serviceReconciliationSummary(row: {
  service_status?: string | null;
  service_comparison?: unknown;
  current_service_invoice_id?: string | null;
}): ServiceReconciliationSummary {
  const data = row.service_comparison && typeof row.service_comparison === "object"
    ? row.service_comparison as Record<string, unknown> : {};
  const money = (value: unknown) => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    status: (row.service_status === "NOT_STARTED" && row.current_service_invoice_id ? "PENDING_RECONCILIATION" : row.service_status || "NOT_STARTED") as ServiceReconciliationStatus,
    estimatedTotal: money(data.estimated_total),
    invoiceTotal: money(data.invoice_total),
    difference: money(data.difference),
    currency: typeof data.currency === "string" ? data.currency : "GTQ",
    invoiceCurrency: typeof data.invoice_currency === "string" ? data.invoice_currency : "GTQ",
    complete: data.snapshots_complete === true,
    checkedAt: typeof data.checked_at === "string" ? data.checked_at : null,
  };
}
