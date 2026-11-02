import { StatusBadge } from "@/components/ui/badge";
import { formatDispatchMoney } from "@/features/dispatches/formatters";
import type { ServiceReconciliationSummary } from "@/features/invoices/service-reconciliation";
import { formatStatusLabel } from "@/lib/status-labels";

export function ServiceReconciliationSummaryCard({ summary }: { summary: ServiceReconciliationSummary }) {
  const evaluated = Boolean(summary.checkedAt);
  return <div className="min-w-0 space-y-2 text-xs">
    <StatusBadge label={formatStatusLabel(summary.status)} tone={summary.status === "RECONCILED" ? "success" : ["WITH_DIFFERENCES", "PENDING_REINVOICING"].includes(summary.status) ? "warning" : "neutral"} />
    {evaluated && <dl className="space-y-1">
      <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-foreground-muted">Estimado de servicios</dt><dd className="font-semibold">{summary.complete && summary.estimatedTotal !== null ? formatDispatchMoney(summary.estimatedTotal, summary.currency) : "Estimación incompleta"}</dd></div>
      <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-foreground-muted">Total factura</dt><dd className="font-semibold">{summary.invoiceTotal === null ? "—" : formatDispatchMoney(summary.invoiceTotal, summary.invoiceCurrency)}</dd></div>
      <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-foreground-muted">Diferencia</dt><dd className="font-semibold">{summary.difference === null ? "No comparable" : formatDispatchMoney(summary.difference, summary.currency)}</dd></div>
    </dl>}
  </div>;
}
