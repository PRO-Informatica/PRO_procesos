import { AlertTriangle } from "lucide-react";

import { formatBatchQuantity } from "@/features/batches/formatters";
import { formatDispatchMoney } from "@/features/dispatches/catalog-estimates";

import type { UniversalInvoiceComparison } from "../reconciliation-comparison";

export function InvoiceComparisonAlert({ comparison, saved, duplicate }: {
  comparison: UniversalInvoiceComparison | null | undefined;
  saved: boolean;
  duplicate: boolean;
}) {
  const service = comparison?.basis === "SERVICE_TOTAL";
  const format = (value: number | null, unit: string | null) => value === null ? "No disponible" : service && unit
    ? formatDispatchMoney(value, unit) : `${formatBatchQuantity(value)} ${unit ?? ""}`.trim();
  return <div role="alert" className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
    <p className="flex items-start gap-2 font-semibold"><AlertTriangle aria-hidden="true" className="size-4 shrink-0" />{saved ? "Factura guardada con diferencias" : duplicate ? "Factura ya registrada con diferencias" : "Diferencia detectada antes de conciliar"}</p>
    {comparison ? <>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="min-w-0"><dt>{service ? "Estimado de servicios" : comparison.basis === "PROGRAMMED_QUANTITY" ? "Cantidad programada" : "Volumen Real"}</dt><dd className="mt-1 break-words font-semibold">{format(comparison.expected, comparison.expectedUnit)}</dd></div>
        <div className="min-w-0"><dt>{service ? "Total factura" : "Cantidad facturada"}</dt><dd className="mt-1 break-words font-semibold">{format(comparison.invoiced, comparison.invoiceUnit)}</dd></div>
        <div className="min-w-0"><dt>Diferencia</dt><dd className="mt-1 break-words font-semibold">{comparison.difference === null ? "No comparable" : format(comparison.difference, comparison.expectedUnit)}</dd></div>
      </dl>
      {comparison.difference === null && <p className="mt-2">Revisa que el estimado esté completo y que las unidades o monedas coincidan.</p>}
    </> : <p className="mt-2">La conciliación detectó diferencias. Revisa su detalle en el despacho o lote.</p>}
  </div>;
}
