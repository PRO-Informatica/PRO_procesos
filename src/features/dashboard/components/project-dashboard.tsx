import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Clock3,
  FileWarning,
  FolderKanban,
  History,
  PackageCheck,
  ReceiptText,
  RefreshCcw,
  ShieldCheck,
  Truck,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";
import type { ProjectSummary } from "@/features/projects/types";
import { formatStatusLabel } from "@/lib/status-labels";

import {
  formatAccountingPeriod,
  formatBatchStatus,
  formatDashboardActivity,
  formatDashboardDateTime,
  formatDashboardTime,
  formatDateRange,
  formatProgrammingStatus,
  formatQuantity,
} from "../formatters";
import type {
  DashboardProgramming,
  ProgrammingStatus,
  ProjectDashboardData,
} from "../types";

type DashboardFocus = "GENERAL" | "PLANNING" | "PURCHASING" | "AUTHORIZATION";

function resolveFocus(roleCodes: string[]): DashboardFocus {
  if (roleCodes.includes("COMPANY_ADMIN")) return "GENERAL";
  if (roleCodes.includes("FINAL_AUTHORIZER")) return "AUTHORIZATION";
  if (roleCodes.includes("PURCHASING")) return "PURCHASING";
  if (roleCodes.some((role) => role === "RECEPTION" || role === "RESIDENT")) {
    return "PLANNING";
  }
  return "GENERAL";
}

const focusLabels: Record<DashboardFocus, string> = {
  GENERAL: "Visión general",
  PLANNING: "Enfoque operativo",
  PURCHASING: "Enfoque de Compras",
  AUTHORIZATION: "Enfoque de autorización",
};

function statusTone(status: ProgrammingStatus) {
  if (status === "COMPLETED") return "bg-success-soft text-success";
  if (status === "CANCELLED") return "bg-destructive-soft text-destructive";
  if (status === "IN_EXECUTION") return "bg-brand-soft text-brand-strong";
  return "bg-muted text-foreground-muted";
}

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="min-w-0 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground-muted">{label}</p>
          <p className="mt-2 truncate text-2xl font-semibold tracking-tight text-foreground">
            {value}
          </p>
          <p className="mt-1 text-xs text-foreground-muted">{detail}</p>
        </div>
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">
          {icon}
        </div>
      </div>
    </article>
  );
}

function AlertItem({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "warning" | "danger";
}) {
  const classes =
    tone === "danger"
      ? "bg-destructive-soft text-destructive"
      : tone === "warning"
        ? "bg-brand-soft text-brand-strong"
        : "bg-muted text-foreground-muted";

  return (
    <div className={`rounded-lg px-3 py-3 ${classes}`}>
      <p className="text-xl font-semibold">{value}</p>
      <p className="mt-0.5 text-[11px] font-medium leading-4">{label}</p>
    </div>
  );
}

function ProgrammingItem({
  item,
  timezone,
}: {
  item: DashboardProgramming;
  timezone: string;
}) {
  return (
    <li className="relative grid grid-cols-[3.5rem_1fr] gap-3 pb-5 last:pb-0 sm:grid-cols-[4.5rem_1fr]">
      <div className="relative">
        <span className="relative z-10 inline-flex rounded-md bg-muted px-2 py-1 font-mono text-xs font-semibold text-foreground">
          {formatDashboardTime(item.scheduledAt, timezone)}
        </span>
        <span className="absolute bottom-[-1.25rem] left-5 top-7 w-px bg-border last:hidden" />
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-muted/35 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground" title={item.supplierName}>
              {item.supplierName}
            </p>
            <p className="mt-1 font-mono text-[10px] text-foreground-muted">
              #{item.id.slice(0, 8)}
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusTone(item.status)}`}>
            {formatProgrammingStatus(item.status)}
          </span>
        </div>
        <p className="mt-3 text-sm font-semibold text-foreground">
          {formatQuantity(item.quantity)} {item.unitCode}
        </p>
      </div>
    </li>
  );
}

export function ProjectDashboard({
  project,
  roleCodes,
  data,
}: {
  project: ProjectSummary;
  roleCodes: string[];
  data: ProjectDashboardData;
}) {
  const focus = resolveFocus(roleCodes);
  const purchasingFirst = focus === "PURCHASING" || focus === "AUTHORIZATION";
  const hasAlerts =
    data.metrics.reinvoicingCount > 0 ||
    data.metrics.openDiscrepancyCount > 0 ||
    data.metrics.pendingReviewBatchCount > 0 ||
    data.metrics.pendingAuthorizationBatchCount > 0;

  return (
    <MotionPage className="mx-auto max-w-[1440px]">
      <MotionSection className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
              Dashboard operacional
            </p>
            <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-foreground-muted">
              {focusLabels[focus]}
            </span>
          </div>
          <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {project.name}
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            {project.companyName} · {project.code} · Semana {formatDateRange(data.weekStart, data.weekEnd, data.timezone)}
          </p>
        </div>
        <div className="shrink-0 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground-muted">
          <Clock3 aria-hidden="true" className="mr-2 inline size-4 text-brand-strong" />
          {data.timezone}
        </div>
      </MotionSection>

      <MotionSection
        className={`mt-5 rounded-xl border p-4 sm:p-5 ${
          hasAlerts
            ? "border-brand/20 bg-surface"
            : "border-success/20 bg-success-soft/45"
        }`}
      >
        <div className="flex items-center gap-2">
          {hasAlerts ? (
            <AlertTriangle aria-hidden="true" className="size-4 text-brand-strong" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
          )}
          <h2 className="text-sm font-semibold text-foreground">
            {hasAlerts ? "Pendientes que requieren atención" : "Sin alertas críticas en este momento"}
          </h2>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <AlertItem
            label="Refacturaciones"
            value={data.metrics.reinvoicingCount}
            tone={data.metrics.reinvoicingCount > 0 ? "danger" : "neutral"}
          />
          <AlertItem
            label="Discrepancias abiertas"
            value={data.metrics.openDiscrepancyCount}
            tone={data.metrics.openDiscrepancyCount > 0 ? "warning" : "neutral"}
          />
          <AlertItem label="Lotes en revisión" value={data.metrics.pendingReviewBatchCount} />
          <AlertItem
            label="Autorizaciones finales"
            value={data.metrics.pendingAuthorizationBatchCount}
            tone={data.metrics.pendingAuthorizationBatchCount > 0 ? "warning" : "neutral"}
          />
        </div>
      </MotionSection>

      <MotionSection className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="Programado hoy"
          value={`${formatQuantity(data.metrics.programmedTodayM3)} M3`}
          detail={`${data.metrics.programmingTodayCount} programaciones`}
          icon={<CalendarDays aria-hidden="true" className="size-4" />}
        />
        <MetricCard
          label="Recibido hoy"
          value={`${formatQuantity(data.metrics.dispatchedTodayM3)} M3`}
          detail={`${data.metrics.dispatchTodayCount} despachos con guía`}
          icon={<Truck aria-hidden="true" className="size-4" />}
        />
        <MetricCard
          label="Programaciones de la semana"
          value={String(data.metrics.programmingWeekCount)}
          detail={formatDateRange(data.weekStart, data.weekEnd, data.timezone)}
          icon={<CalendarRange aria-hidden="true" className="size-4" />}
        />
        <MetricCard
          label="Facturas pendientes"
          value={String(data.metrics.pendingInvoiceCount)}
          detail="Registradas, con match o en revisión"
          icon={<ReceiptText aria-hidden="true" className="size-4" />}
        />
      </MotionSection>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-12">
        <MotionSection
          className="overflow-hidden rounded-xl border border-border bg-surface xl:col-span-8"
          style={{ order: purchasingFirst ? 2 : 1 } as React.CSSProperties}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border p-4 sm:p-5">
            <div>
              <h2 className="text-base font-semibold text-foreground">Planificación de hoy</h2>
              <p className="mt-1 text-xs text-foreground-muted">
                Resumen conectado al futuro módulo Calendario + Kanban.
              </p>
            </div>
            <Link
              href="/programming"
              className="hidden shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground-muted transition hover:bg-muted hover:text-foreground sm:inline-flex"
            >
              Ver planificación
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>

          <div className="border-b border-border p-3 sm:p-5">
            <div className="grid grid-cols-7 gap-1.5" aria-label="Resumen semanal de programaciones">
              {data.weekDays.map((day) => (
                <div
                  key={day.date}
                  className={`min-w-0 rounded-lg border px-1.5 py-2 text-center sm:px-2 sm:py-3 ${
                    day.isToday
                      ? "border-brand/30 bg-brand-soft"
                      : "border-border bg-muted/40"
                  }`}
                >
                  <p className={`text-[10px] font-semibold uppercase ${day.isToday ? "text-brand-strong" : "text-foreground-muted"}`}>
                    {day.shortLabel}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{day.programmingCount}</p>
                  <p className="mt-0.5 truncate text-[9px] text-foreground-muted sm:text-[10px]">
                    {formatQuantity(day.programmedM3)} M3
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {data.programmingToday.length ? (
              <ol>
                {data.programmingToday.slice(0, 6).map((item) => (
                  <ProgrammingItem key={item.id} item={item} timezone={data.timezone} />
                ))}
              </ol>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <CalendarDays aria-hidden="true" className="mx-auto size-5 text-foreground-muted" />
                <p className="mt-3 text-sm font-semibold text-foreground">Sin programaciones para hoy</p>
                <p className="mt-1 text-xs text-foreground-muted">
                  La mini semana mantiene visible el resto de la planificación.
                </p>
              </div>
            )}
            <Link
              href="/programming"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs font-semibold text-foreground-muted transition hover:bg-muted hover:text-foreground sm:hidden"
            >
              Ver planificación
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
        </MotionSection>

        <MotionSection
          className="overflow-hidden rounded-xl border border-border bg-surface xl:col-span-4"
          style={{ order: purchasingFirst ? 1 : 2 } as React.CSSProperties}
        >
          <div className="border-b border-border p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <FolderKanban aria-hidden="true" className="size-4 text-brand-strong" />
              <h2 className="text-base font-semibold text-foreground">Lote semanal actual</h2>
            </div>
          </div>
          {data.currentBatch ? (
            <div className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-semibold text-foreground">
                    {data.currentBatch.code}
                  </p>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {formatDateRange(data.currentBatch.periodStart, data.currentBatch.periodEnd, data.timezone)}
                  </p>
                </div>
                <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-semibold text-brand-strong">
                  {formatBatchStatus(data.currentBatch.status)}
                </span>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-muted p-3">
                  <dt className="text-[10px] text-foreground-muted">Guías activas</dt>
                  <dd className="mt-1 text-lg font-semibold text-foreground">{data.currentBatch.activeGuideCount}</dd>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <dt className="text-[10px] text-foreground-muted">Facturas pendientes</dt>
                  <dd className="mt-1 text-lg font-semibold text-foreground">{data.currentBatch.pendingInvoiceCount}</dd>
                </div>
                <div className="rounded-lg bg-destructive-soft p-3">
                  <dt className="text-[10px] text-destructive">Refacturación</dt>
                  <dd className="mt-1 text-lg font-semibold text-destructive">{data.currentBatch.reinvoicingCount}</dd>
                </div>
                <div className="rounded-lg bg-brand-soft p-3">
                  <dt className="text-[10px] text-brand-strong">Autorización final</dt>
                  <dd className="mt-1 text-lg font-semibold text-brand-strong">{data.currentBatch.pendingAuthorizationCount}</dd>
                </div>
              </dl>
              <div className="mt-4 rounded-lg border border-border p-3">
                <p className="text-[10px] uppercase tracking-wide text-foreground-muted">Período contable</p>
                <p className="mt-1 text-sm font-semibold capitalize text-foreground">
                  {formatAccountingPeriod(data.currentBatch.accountingPeriod, data.timezone)}
                </p>
              </div>
              <p className="mt-4 text-[11px] leading-5 text-foreground-muted">
                Se muestran estados persistidos. No se calcula un porcentaje ni se duplica la lógica de preparación de guía.
              </p>
            </div>
          ) : (
            <div className="p-4 sm:p-5">
              <EmptyState
                title="Sin lote para la semana actual"
                description="El lote aparecerá cuando exista uno cuyo período incluya la fecha operacional de hoy."
              />
            </div>
          )}
        </MotionSection>
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <MotionSection className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <FileWarning aria-hidden="true" className="size-4 text-brand-strong" />
              <h2 className="text-base font-semibold text-foreground">Facturación</h2>
            </div>
            <p className="mt-1 text-xs text-foreground-muted">Indicadores del flujo vigente.</p>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <div className="bg-surface p-4">
              <ReceiptText aria-hidden="true" className="size-4 text-foreground-muted" />
              <p className="mt-3 text-xl font-semibold text-foreground">{data.metrics.pendingInvoiceCount}</p>
              <p className="mt-1 text-[11px] text-foreground-muted">Pendientes</p>
            </div>
            <div className="bg-surface p-4">
              <RefreshCcw aria-hidden="true" className="size-4 text-destructive" />
              <p className="mt-3 text-xl font-semibold text-destructive">{data.metrics.reinvoicingCount}</p>
              <p className="mt-1 text-[11px] text-foreground-muted">Refacturación</p>
            </div>
            <div className="bg-surface p-4">
              <AlertTriangle aria-hidden="true" className="size-4 text-brand-strong" />
              <p className="mt-3 text-xl font-semibold text-foreground">{data.metrics.openDiscrepancyCount}</p>
              <p className="mt-1 text-[11px] text-foreground-muted">Discrepancias</p>
            </div>
          </div>
          <p className="border-t border-border p-4 text-[11px] leading-5 text-foreground-muted">
            La coincidencia guía ↔ factura es automática. No existe aprobación del Resident en esta etapa.
          </p>
        </MotionSection>

        <MotionSection className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle aria-hidden="true" className="size-4 text-brand-strong" />
              <h2 className="text-base font-semibold text-foreground">Incidencias recientes</h2>
            </div>
          </div>
          {data.incidents.length ? (
            <ul className="divide-y divide-border">
              {data.incidents.map((incident) => (
                <li key={incident.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">{incident.typeName}</p>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[9px] font-semibold text-foreground-muted">
                      {formatStatusLabel(incident.responsibility)}
                    </span>
                  </div>
                  {incident.notes && (
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-foreground-muted">{incident.notes}</p>
                  )}
                  <p className="mt-2 text-[10px] text-foreground-muted">
                    {formatDashboardDateTime(incident.createdAt, data.timezone)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-6 text-center">
              <PackageCheck aria-hidden="true" className="mx-auto size-5 text-success" />
              <p className="mt-3 text-sm font-semibold text-foreground">Sin incidencias recientes</p>
            </div>
          )}
        </MotionSection>

        <MotionSection className="overflow-hidden rounded-xl border border-border bg-surface lg:col-span-2 xl:col-span-1">
          <div className="border-b border-border p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <History aria-hidden="true" className="size-4 text-brand-strong" />
              <h2 className="text-base font-semibold text-foreground">Actividad reciente</h2>
            </div>
          </div>
          {data.activity.length ? (
            <ul className="divide-y divide-border">
              {data.activity.map((event) => (
                <li key={event.id} className="flex gap-3 p-4">
                  <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-foreground-muted">
                    {event.entityType === "batch" ? (
                      <ShieldCheck aria-hidden="true" className="size-3.5" />
                    ) : (
                      <History aria-hidden="true" className="size-3.5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold leading-5 text-foreground">
                      {formatDashboardActivity(event.action)}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-foreground-muted" title={event.actorName}>
                      {event.actorName} · {formatDashboardDateTime(event.createdAt, data.timezone)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-6 text-center">
              <History aria-hidden="true" className="mx-auto size-5 text-foreground-muted" />
              <p className="mt-3 text-sm font-semibold text-foreground">Sin actividad registrada</p>
            </div>
          )}
        </MotionSection>
      </div>
    </MotionPage>
  );
}
