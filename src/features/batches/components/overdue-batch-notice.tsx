import { AlertTriangle, ChevronRight } from "lucide-react";
import Link from "next/link";

import { formatBatchDate } from "../formatters";
import { batchWeekEnd } from "../period-policy";
import type { OverdueBatchAlerts } from "../types";

export function OverdueBatchNotice({ overdue }: { overdue: OverdueBatchAlerts }) {
  if (!overdue.total) return null;
  return <section role="alert" aria-label="Lotes pendientes de cierre" className="rounded-xl border border-brand/25 bg-brand-soft p-4 text-foreground sm:p-5">
    <div className="flex items-start gap-3">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-brand-strong" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-brand-strong">{overdue.total === 1 ? "Tienes un lote pendiente de cierre" : `Tienes ${overdue.total} lotes pendientes de cierre`}</h2>
        <p className="mt-1 text-sm">{overdue.total === 1 ? "Su semana ya terminó. Debes cerrarlo" : "Sus semanas ya terminaron. Debes cerrarlos"} manualmente antes de crear un lote de otra semana. Los despachos pendientes continuarán en el siguiente período.</p>
        <ul className="mt-3 divide-y divide-brand/15">
          {overdue.batches.map((batch) => <li key={batch.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm"><strong className="break-all">{batch.code}</strong><span className="mt-1 block text-xs text-foreground-muted">{formatBatchDate(batch.periodStart)} – {formatBatchDate(batch.periodEnd)} · Semana terminada el {formatBatchDate(batchWeekEnd(batch.periodStart))}</span></div>
            <Link href={`/batches/${batch.id}`} className="secondary-button min-h-11 shrink-0 gap-1 self-start text-xs sm:self-auto">Ver lote <ChevronRight className="size-3.5" /></Link>
          </li>)}
        </ul>
        {overdue.total > overdue.batches.length && <p className="mt-2 text-xs text-foreground-muted">Se muestran los {overdue.batches.length} lotes más antiguos de {overdue.total} pendientes.</p>}
      </div>
    </div>
  </section>;
}
