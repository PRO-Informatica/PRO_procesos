import Link from "next/link";
import { ArrowLeft, X } from "lucide-react";
import type { DashboardListScope } from "../details";

export function IndicatorFilter({ scope, clearHref }: { scope: DashboardListScope; clearHref: string }) {
  return <div className="flex flex-col gap-3 rounded-xl border border-brand/20 bg-brand-soft/40 p-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0"><Link href="/" className="mb-2 inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-brand-strong"><ArrowLeft className="size-3.5" /> Volver al inicio</Link>
      <p className="font-semibold">{scope.label}</p><p className="mt-1 text-xs text-foreground-muted">{scope.description}</p></div>
    <Link href={clearHref} className="secondary-button shrink-0 gap-1.5 text-xs"><X className="size-3.5" /> Quitar filtro del indicador</Link>
  </div>;
}
