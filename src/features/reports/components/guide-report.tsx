import { AlertTriangle, CalendarRange, CheckCircle2, Package, Truck } from "lucide-react";
import { programmingStatusTone } from "@/features/programming/formatters";
import type { ProgrammingEffectiveStatus } from "@/features/programming/types";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";
import { formatStatusLabel } from "@/lib/status-labels";

import { GeneralReportFilters } from "./report-filters";
import { ReportSections } from "./report-sections";

import { reportSearchParams } from "../filters";
import type { GuideReportData, GuideReportFilters } from "../types";
import { DispatchReportCard } from "./dispatch-report-card";
import { ReportExportActions } from "./report-export-actions";
import { ReportResultsPagination } from "./report-results-pagination";
import { ProjectScopedReportLink } from "./project-scoped-report-link";

function quantity(value: number) { return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 3 }).format(value); }
function dateTime(value: string, timezone: string) { return new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value)); }


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

  return <MotionPage className="mx-auto max-w-[1500px]"><MotionSection className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-brand-strong">{universal ? "Gestión multi-proyecto" : "Control operacional"}</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{universal ? "Reportería Universal" : "Reportería"}</h1><p className="mt-2 max-w-3xl text-sm text-foreground-muted">{universal ? `Información general de tus ${projectCount} proyecto(s) autorizado(s), con exportación consolidada.` : "Trazabilidad de Programaciones, Despachos, Lotes, Facturas y Conciliación."}</p></div><ReportExportActions query={reportParams.toString()} /></MotionSection>

    <ReportSections universal={universal} />
    <GeneralReportFilters key={reportParams.toString()} filters={filters} options={data.filters} />

    <MotionSection className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi icon={CalendarRange} label="Programaciones" value={data.programming.length} /><Kpi icon={Truck} label="Despachos" value={dispatchCount} /><Kpi icon={CheckCircle2} label="Conciliados" value={reconciled} tone="success" /><Kpi icon={AlertTriangle} label="Con diferencias / pendientes" value={pendingOrDifferent} tone="warning" /></MotionSection>

    <MotionSection className="mt-4">{!data.programming.length ? <div className="rounded-xl border border-border bg-surface p-6"><EmptyState title="Sin Programaciones" description="No hay Programaciones que coincidan con el rango de fechas y los filtros seleccionados." /></div> : <ReportResultsPagination key={reportParams.toString()}>{data.programming.map((program) => <article key={program.id} className="overflow-hidden rounded-xl border border-border bg-surface"><header className="flex flex-col gap-4 border-b border-border px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><ProjectScopedReportLink projectId={program.projectId} href={`/programming/${program.id}`} className="font-mono text-sm font-semibold text-brand-strong hover:underline disabled:cursor-wait disabled:opacity-60">{program.code}</ProjectScopedReportLink><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${programmingStatusTone(program.status as ProgrammingEffectiveStatus)}`}>{formatStatusLabel(program.status)}</span></div><p className="mt-1.5 text-sm font-semibold text-foreground">{program.supplierName}</p><p className="mt-1 text-xs text-foreground-muted">{dateTime(program.scheduledAt, program.timezone)} · {quantity(program.confirmedQuantity ?? program.requestedQuantity)} {program.unitCode} · {program.projectName} · {program.companyName} · {program.castingElementLabel}</p></div><div className="flex items-center gap-3"><span className="inline-flex items-center gap-1.5 text-xs text-foreground-muted"><Package className="size-3.5" />{program.dispatches.length} despacho(s)</span><ProjectScopedReportLink projectId={program.projectId} href={`/programming/${program.id}`} className="ghost-button text-xs disabled:cursor-wait disabled:opacity-60">Ver programación</ProjectScopedReportLink></div></header>
      {!program.dispatches.length ? <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div className="flex items-center gap-2 text-sm text-foreground-muted"><Truck className="size-4" /><span>Sin despacho asociado</span></div><ProjectScopedReportLink projectId={program.projectId} href={`/programming/${program.id}`} className="secondary-button w-full text-xs disabled:cursor-wait disabled:opacity-60 sm:w-auto">Ver programación</ProjectScopedReportLink></div> : <div className="space-y-3 p-3 sm:p-4">{program.dispatches.map((dispatch) => <DispatchReportCard key={dispatch.dispatchId} dispatch={dispatch} />)}</div>}
    </article>)}</ReportResultsPagination>}</MotionSection>
  </MotionPage>;
}
