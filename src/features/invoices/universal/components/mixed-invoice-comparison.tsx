import { Badge } from "@/components/ui/badge";
import { formatDispatchMoney } from "@/features/dispatches/catalog-estimates";

import type { MixedInvoiceComparison, UniversalInvoiceComparison } from "../reconciliation-comparison";

function amount(value: number | null, currency: string | null) {
  return value === null ? "—" : formatDispatchMoney(value, currency ?? "GTQ");
}

function AmountRow({ label, comparison }: { label: string; comparison: UniversalInvoiceComparison }) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{label}</p>
        <Badge tone={comparison.matches ? "success" : comparison.difference === null ? "neutral" : "warning"}>
          {comparison.matches ? "Coincide" : comparison.difference === null ? "Por comparar" : "Con diferencias"}
        </Badge>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 tabular-nums">
        <div><dt className="text-foreground-muted">Estimado</dt><dd className="mt-0.5 font-medium">{amount(comparison.expected, comparison.expectedUnit)}</dd></div>
        <div><dt className="text-foreground-muted">Facturado</dt><dd className="mt-0.5 font-medium">{amount(comparison.invoiced, comparison.invoiceUnit)}</dd></div>
        <div><dt className="text-foreground-muted">Diferencia</dt><dd className="mt-0.5 font-medium">{amount(comparison.difference, comparison.expectedUnit)}</dd></div>
      </dl>
    </div>
  );
}

export function MixedInvoiceAmounts({ comparison }: { comparison: MixedInvoiceComparison }) {
  return (
    <section aria-label="Desglose de factura mixta" className="mt-3 divide-y divide-border rounded-lg border border-border bg-muted/20 text-xs">
      <AmountRow label="Producto" comparison={comparison.product} />
      <AmountRow label="Servicio" comparison={comparison.service} />
      <AmountRow label="Total" comparison={comparison.total} />
    </section>
  );
}
