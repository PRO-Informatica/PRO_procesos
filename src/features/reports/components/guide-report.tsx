import { AlertTriangle, CalendarRange, CheckCircle2, Truck } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";

import { GeneralReportFilters } from "./report-filters";
import { ReportSections } from "./report-sections";

import { reportSearchParams } from "../filters";
import type { GuideReportData, GuideReportFilters } from "../types";
import { DispatchTableRow } from "./report-table-rows";
import { ReportExportActions } from "./report-export-actions";
import { ReportResultsPagination } from "./report-results-pagination";

function Kpi({ icon: Icon, label, value, tone = "brand" }: { icon: typeof CalendarRange; label: string; value: number; tone?: "brand" | "success" | "warning" }) {
  const iconTone = tone === "success" ? "bg-success-soft text-success" : tone === "warning" ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" : "bg-brand-soft text-brand-strong";
  return <article className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4"><span className={`grid size-9 shrink-0 place-items-center rounded-lg ${iconTone}`}><Icon className="size-4" /></span><div><p className="text-xl font-semibold leading-none text-foreground">{value}</p><p className="mt-1.5 text-xs text-foreground-muted">{label}</p></div></article>;
}

export function GuideReport({ data, filters, universal = false, projectCount = 1 }: { data: GuideReportData; filters: GuideReportFilters; universal?: boolean; projectCount?: number }) {
  const dispatchCount = data.rows.length;
  const reconciled = data.rows.filter((row) => row.billingComplete).length;
  const pendingOrDifferent = data.rows.filter((row) => !row.billingComplete).length;
  const reportParams = reportSearchParams(filters);
  if (universal) reportParams.set("scope", "universal");

  return <MotionPage className="mx-auto min-w-0 max-w-[1500px]"><MotionSection className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-brand-strong">{universal ? "Gestión multi-proyecto" : "Control operacional"}</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{universal ? "Reportería Universal" : "Reportería"}</h1><p className="mt-2 max-w-3xl text-sm text-foreground-muted">{universal ? `Información general de tus ${projectCount} proyecto(s) autorizado(s), con exportación consolidada.` : "Trazabilidad de Programaciones, Despachos, Lotes, Facturas y Conciliación."}</p></div><ReportExportActions query={reportParams.toString()} /></MotionSection>

    <ReportSections universal={universal} />
    <GeneralReportFilters key={reportParams.toString()} filters={filters} options={data.filters} />

    <MotionSection className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi icon={CalendarRange} label="Programaciones" value={data.programming.length} /><Kpi icon={Truck} label="Despachos" value={dispatchCount} /><Kpi icon={CheckCircle2} label="Conciliados" value={reconciled} tone="success" /><Kpi icon={AlertTriangle} label="Con diferencias / pendientes" value={pendingOrDifferent} tone="warning" /></MotionSection>

    <MotionSection className="mt-4 min-w-0">
      {!data.rows.length ? (
        <div className="rounded-xl border border-border bg-surface p-6">
          <EmptyState title="Sin despachos" description="No hay despachos que coincidan con el rango de fechas y los filtros seleccionados." />
        </div>
      ) : (
        <ReportResultsPagination
          key={reportParams.toString()}
          results={data.rows.map((dispatch) => (
            <DispatchTableRow key={dispatch.dispatchId} dispatch={dispatch} />
          ))}
        />
      )}
    </MotionSection>
  </MotionPage>;
}
