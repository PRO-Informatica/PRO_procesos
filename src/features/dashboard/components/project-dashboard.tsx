import { AlertTriangle, ArrowRight, CalendarCheck, CalendarDays, CheckCircle2, Clock3, FolderKanban, PackageCheck, ReceiptText, RefreshCcw, Truck } from "lucide-react";
import Link from "next/link";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionItem, MotionList } from "@/components/motion/motion-list";
import { MotionSection } from "@/components/motion/motion-section";
import { AnimatedProgress } from "@/components/feedback/animated-progress";
import { isSupervisorOnly } from "@/features/projects/access-policy";
import type { ProjectSummary } from "@/features/projects/types";
import { formatStatusLabel } from "@/lib/status-labels";
import { formatDateRange, formatQuantity } from "../formatters";
import { dashboardDetailHref, type DashboardDetailView } from "../details";
import type { ProjectDashboardData } from "../types";
import { ProjectReconciliationChart, WeeklyVolumeChart } from "./dashboard-charts";
import { RecentActivity } from "./recent-activity";

type Focus = "GENERAL" | "PLANNING" | "SUPERVISOR" | "PURCHASING";
function focus(roleCodes: string[]): Focus { if (roleCodes.some((role) => ["COMPANY_ADMIN", "PLATFORM_ADMIN"].includes(role))) return "GENERAL"; if (roleCodes.includes("PURCHASING")) return "PURCHASING"; if (roleCodes.includes("SUPERVISOR")) return "SUPERVISOR"; return "PLANNING"; }
const focusLabel = { GENERAL: "Visión general", PLANNING: "Enfoque de planificación", SUPERVISOR: "Enfoque de supervisión", PURCHASING: "Enfoque de compras" };
function Metric({ title, value, detail, icon, href }: { title: string; value: string; detail: React.ReactNode; icon: React.ReactNode; href: string }) {
  return <article className="h-full rounded-xl border border-border bg-surface p-4 transition hover:border-brand/30 sm:p-5">
    <Link href={href} prefetch={false} className="group flex min-h-16 items-start justify-between gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
      <div className="min-w-0"><h2 className="text-xs font-medium text-foreground-muted group-hover:text-brand-strong">{title}</h2><p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p></div>
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">{icon}</div>
    </Link>
    <div className="mt-1 text-xs leading-6 text-foreground-muted">{detail}</div>
  </article>;
}
function Attention({ href, label, value, icon }: { href: string; label: string; value: number; icon: React.ReactNode }) { return <Link href={href} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 transition hover:border-brand/30 hover:bg-brand-soft/20"><span className="grid size-9 place-items-center rounded-lg bg-destructive-soft text-destructive">{icon}</span><span className="min-w-0 flex-1 text-sm font-medium text-foreground">{label}</span><strong className="text-lg text-destructive">{value}</strong><ArrowRight className="size-4 text-foreground-muted" /></Link>; }

export function ProjectDashboard({ project, roleCodes, data, reinvoicing }: {
  project: ProjectSummary;
  roleCodes: string[];
  data: ProjectDashboardData;
  reinvoicing?: React.ReactNode;
}) {
  const mode = focus(roleCodes);
  const supervisor = isSupervisorOnly(roleCodes);
  const href = (view: DashboardDetailView) => dashboardDetailHref(project.id, view);
  const week = data.metrics.week;
  const attention = supervisor ? data.metrics.attention.overdueProgramming > 0 : Object.values(data.metrics.attention).some((value) => value > 0);
  return <MotionPage className="mx-auto max-w-[1500px]">
    <MotionSection className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-brand-strong">Dashboard operacional</p>
          <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-foreground-muted">{focusLabel[mode]}</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{project.name}</h1>
        <p className="mt-2 text-sm text-foreground-muted">{project.companyName} · Semana {formatDateRange(data.weekStart, data.weekEnd, data.timezone)}</p>
      </div>
      <div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground-muted">
          <Clock3 aria-hidden="true" className="size-4 text-brand-strong" />{data.timezone}
        </span>
      </div>
    </MotionSection>

    <MotionList className={`mt-5 grid gap-3 sm:grid-cols-2 ${supervisor ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}>
      <MotionItem><Metric href={href("today")} title="Programaciones de hoy" value={String(data.metrics.today.total)} detail={<Link href={href("today")} className="hover:underline">{`${formatQuantity(data.metrics.today.programmedM3)} M3 · ${data.metrics.today.completed} completadas · ${data.metrics.today.pending} pendientes`}</Link>} icon={<CalendarDays className="size-4" />} /></MotionItem>
      <MotionItem><Metric href={href("week")} title="Programaciones de la semana" value={`${data.metrics.week.completed} / ${data.metrics.week.total}`} detail={<Link href={href("weekCompleted")} className="hover:underline">{data.metrics.week.compliance}% de cumplimiento</Link>} icon={<CalendarCheck className="size-4" />} /></MotionItem>
      <MotionItem><Metric href={href("receivedMonth")} title="Ejecución del mes" value={`${data.metrics.month.execution}%`} detail={<><Link href={href("receivedMonth")} className="hover:underline">{formatQuantity(data.metrics.month.receivedM3)} recibidos</Link>{" de "}<Link href={href("month")} className="hover:underline">{formatQuantity(data.metrics.month.programmedM3)} M3 programados</Link></>} icon={<Truck className="size-4" />} /></MotionItem>
      {!supervisor && <MotionItem><Metric href={href("reconciled")} title="Pedidos completados" value={String(data.metrics.orders.completed)} detail={<><Link href={href("pendingOrders")} className="hover:underline">{data.metrics.orders.pending} pendientes</Link>{" · "}<Link href={href("reinvoicing")} className="hover:underline">{data.metrics.orders.reinvoicing} en refacturación</Link></>} icon={<PackageCheck className="size-4" />} /></MotionItem>}
    </MotionList>

    <div className="mt-4 grid gap-4 xl:grid-cols-12">
      <MotionSection className={`min-w-0 rounded-xl border border-border bg-surface p-4 sm:p-5 ${supervisor ? "xl:col-span-12" : "xl:col-span-7"}`}>
        <Link href={href("weekCompleted")} className="block rounded-lg hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Cumplimiento semanal</h2>
              <p className="mt-1 text-xs text-foreground-muted">Programaciones completadas</p>
            </div>
            <strong className="text-2xl">{week.compliance}%</strong>
          </div>
          <AnimatedProgress className="mt-4" value={week.compliance} label="Cumplimiento semanal" continuous />
        </Link>
        <p className="mt-2 text-xs leading-6 text-foreground-muted">
          <Link href={href("weekCompleted")} className="hover:underline">{week.completed} completadas</Link>{" de "}
          <Link href={href("week")} className="hover:underline">{week.total}</Link>{" · "}
          <Link href={href("weekPending")} className="hover:underline">{week.pending} pendientes</Link>
        </p>
        <div className="mt-6 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm text-foreground">Programado vs recibido por día</h3>
            <div className="flex gap-3 text-[10px] text-foreground-muted">
              <span><i className="mr-1 inline-block size-2 rounded-full bg-brand" />Programado</span>
              <span><i className="mr-1 inline-block size-2 rounded-full bg-foreground-muted" />Recibido</span>
            </div>
          </div>
          <WeeklyVolumeChart days={data.weekDays} projectId={project.id} />
        </div>
      </MotionSection>
      {!supervisor && <MotionSection className="min-w-0 rounded-xl border border-border bg-surface p-4 sm:p-5 xl:col-span-5">
        <ProjectReconciliationChart totals={data.projectReconciliation} projectId={project.id} projectName={project.name} />
      </MotionSection>}
    </div>

    {reinvoicing && <MotionSection className="mt-4 min-w-0">{reinvoicing}</MotionSection>}

    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <MotionSection className="rounded-xl border border-border bg-surface p-4 sm:p-5"><div className="flex items-center gap-2">{attention ? <AlertTriangle className="size-4 text-destructive" /> : <CheckCircle2 className="size-4 text-success" />}<h2 className="font-semibold text-foreground">Requieren atención</h2></div><div className="mt-4 grid gap-2">{!attention ? <p className="rounded-lg bg-success-soft p-4 text-sm font-medium text-success">Sin alertas operativas importantes.</p> : <>{!supervisor && data.metrics.attention.reinvoicing > 0 && <Attention href={href("reinvoicing")} label="Pedidos en refacturación" value={data.metrics.attention.reinvoicing} icon={<RefreshCcw className="size-4" />} />}{data.metrics.attention.overdueProgramming > 0 && <Attention href={href("overdue")} label="Programaciones vencidas" value={data.metrics.attention.overdueProgramming} icon={<CalendarDays className="size-4" />} />}{!supervisor && data.metrics.attention.pendingInvoice > 0 && <Attention href={href("pendingInvoices")} label="Pedidos pendientes de factura" value={data.metrics.attention.pendingInvoice} icon={<ReceiptText className="size-4" />} />}</>}</div></MotionSection>
      <RecentActivity items={supervisor ? data.activity.filter((item) => ["programming", "dispatch", "dispatch_guide"].includes(item.entityType)) : data.activity} timezone={data.timezone} />
    </div>

    {!supervisor && data.currentBatch && <MotionSection className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand-strong"><FolderKanban className="size-4" /></span><div><p className="font-semibold text-foreground">{data.currentBatch.code}</p><p className="mt-1 text-xs text-foreground-muted">Lote semanal · {data.currentBatch.activeGuideCount} guías activas · {formatStatusLabel(data.currentBatch.status)}</p></div></div><Link href={`/batches/${data.currentBatch.id}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-foreground">Ver lote <ArrowRight className="size-3.5" /></Link></MotionSection>}
  </MotionPage>;
}
