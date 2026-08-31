"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  FileText,
  PackageOpen,
  ReceiptText,
  Truck,
  UserRound,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import type { ProjectSummary } from "@/features/projects/types";

import {
  formatDispatchDate,
  formatDispatchDateTime,
  formatDispatchQuantity,
  formatIdentifier,
} from "../formatters";
import type { DispatchDetail } from "../types";
import { DispatchResultBadge, DispatchStatusBadge } from "./dispatch-badges";

function DataPoint({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground-muted">{label}</dt>
      <dd className="mt-1.5 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof Truck;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-5 text-brand-strong" />
        <h2 className="font-semibold text-foreground">{title}</h2>
      </div>
      {count !== undefined && <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground-muted">{count}</span>}
    </div>
  );
}

export function DispatchDetailView({
  detail,
  project,
}: {
  detail: DispatchDetail;
  project: ProjectSummary;
}) {
  return (
    <MotionPage className="mx-auto w-full max-w-7xl space-y-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/dispatches" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted hover:text-foreground">
            <ArrowLeft aria-hidden="true" className="size-4" /> Volver a despachos
          </Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Detalle de despacho</h1>
            <DispatchStatusBadge status={detail.status} />
            <DispatchResultBadge result={detail.result} />
          </div>
          <p className="mt-2 font-mono text-xs text-foreground-muted">
            {formatIdentifier("DSP", detail.id)} · versión {detail.version} · {project.name}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
          <p className="text-xs text-foreground-muted">Guía asociada</p>
          <p className="mt-1 font-semibold text-foreground">{detail.guideNumber ?? "Sin guía"}</p>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
        <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex items-center gap-2"><Truck aria-hidden="true" className="size-5 text-brand-strong" /><h2 className="font-semibold text-foreground">Información operacional</h2></div>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <DataPoint label="Proveedor" value={detail.supplierName} />
            <DataPoint label="Programación" value={<Link href={`/programming/${detail.programmingId}`} className="font-mono text-brand-strong hover:underline">{detail.programmingCode}</Link>} />
            <DataPoint label="Estado programación" value={detail.programmingStatus.replaceAll("_", " ")} />
            <DataPoint label="Fecha programada" value={formatDispatchDateTime(detail.programmingScheduledAt, project.timezone)} />
            <DataPoint label="Creado por" value={detail.createdByName} />
            <DataPoint label="Creado" value={formatDispatchDateTime(detail.createdAt, project.timezone)} />
            <DataPoint label="Actualizado" value={formatDispatchDateTime(detail.updatedAt, project.timezone)} />
            <DataPoint label="Estado del proceso" value={<DispatchStatusBadge status={detail.status} />} />
            <DataPoint label="Resultado físico" value={<DispatchResultBadge result={detail.result} />} />
          </dl>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <div className="flex items-center gap-2"><ClipboardList aria-hidden="true" className="size-5 text-brand-strong" /><h2 className="font-semibold text-foreground">Guía y recepción</h2></div>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2">
            <DataPoint label="Número de guía" value={detail.guideNumber ?? "No registrada"} />
            <DataPoint label="Orden" value={detail.guideOrderNumber ?? "No registrada"} />
            <DataPoint label="Fecha de guía" value={formatDispatchDate(detail.guideDate)} />
            <DataPoint label="Cantidad total" value={detail.quantity === null ? "No registrada" : `${formatDispatchQuantity(detail.quantity)} ${detail.unitCode}`} />
            <DataPoint label="Receptor" value={detail.receivedByName ?? "No registrado"} />
            <DataPoint label="Carga" value={formatDispatchDateTime(detail.loadAt, project.timezone)} />
            <DataPoint label="Llegada" value={formatDispatchDateTime(detail.arrivalAt, project.timezone)} />
            <DataPoint label="Salida" value={formatDispatchDateTime(detail.departureAt, project.timezone)} />
          </dl>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface">
        <SectionHeader icon={PackageOpen} title="Productos de la guía" count={detail.guideLines.length} />
        {detail.guideLines.length ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-muted/60 text-[10px] uppercase tracking-[0.08em] text-foreground-muted"><tr><th className="px-5 py-3">#</th><th className="px-5 py-3">Código</th><th className="px-5 py-3">Descripción</th><th className="px-5 py-3 text-right">Cantidad</th><th className="px-5 py-3">UM</th></tr></thead>
                <tbody className="divide-y divide-border">{detail.guideLines.map((line) => <tr key={line.id}><td className="px-5 py-4 font-mono text-xs text-foreground-muted">{line.position}</td><td className="px-5 py-4 font-mono text-xs font-semibold text-foreground">{line.productCode}</td><td className="px-5 py-4 text-foreground">{line.productDescription}</td><td className="px-5 py-4 text-right font-semibold text-foreground">{formatDispatchQuantity(line.quantity)}</td><td className="px-5 py-4 font-semibold text-foreground">{line.unitCode}</td></tr>)}</tbody>
              </table>
            </div>
            <ol className="divide-y divide-border md:hidden">{detail.guideLines.map((line) => <li key={line.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-xs font-semibold text-brand-strong">{line.position} · {line.productCode}</p><p className="mt-1 text-sm text-foreground">{line.productDescription}</p></div><p className="shrink-0 font-semibold text-foreground">{formatDispatchQuantity(line.quantity)} {line.unitCode}</p></div></li>)}</ol>
          </>
        ) : <div className="p-5 sm:p-6"><EmptyState title="Sin líneas de guía" description="No hay productos visibles asociados a esta guía." /></div>}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <SectionHeader icon={AlertTriangle} title="Incidencias" count={detail.incidents.length} />
          {detail.incidents.length ? <ul className="divide-y divide-border">{detail.incidents.map((incident) => <li key={incident.id} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-foreground">{incident.typeName}</p><span className="text-xs text-foreground-muted">{formatDispatchDateTime(incident.createdAt, project.timezone)}</span></div><p className="mt-2 text-xs text-foreground-muted">Responsabilidad: {incident.responsibility} · Cargo: {incident.chargeApplicability}</p>{incident.notes && <p className="mt-2 text-sm leading-6 text-foreground">{incident.notes}</p>}<p className="mt-2 flex items-center gap-1.5 text-xs text-foreground-muted"><UserRound aria-hidden="true" className="size-3.5" /> {incident.reporterName}</p></li>)}</ul> : <div className="p-5 sm:p-6"><EmptyState title="Sin incidencias" description="Este despacho no tiene incidencias registradas." /></div>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <SectionHeader icon={FileText} title="Documentos autorizados" count={detail.documents.length} />
          {detail.documents.length ? <ul className="divide-y divide-border">{detail.documents.map((document) => <li key={document.id} className="px-5 py-4 sm:px-6"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-foreground">{document.fileName ?? document.category}</p><p className="mt-1 text-xs text-foreground-muted">{document.purpose} · {document.mimeType ?? "Tipo no disponible"}</p></div><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-foreground-muted">{document.uploadStatus ?? "Sin versión"}</span></div></li>)}</ul> : <div className="p-5 sm:p-6"><EmptyState title="Sin documentos visibles" description="No existen documentos vinculados que tu acceso permita consultar." /></div>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <SectionHeader icon={CalendarClock} title="Lotes" count={detail.batches.length} />
          {detail.batches.length ? <ul className="divide-y divide-border">{detail.batches.map((relation) => <li key={relation.relationId} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-foreground">{relation.code}</p><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${relation.removedAt ? "bg-muted text-foreground-muted" : "bg-success-soft text-success"}`}>{relation.removedAt ? "Histórico" : "Activo"}</span></div><p className="mt-2 text-xs text-foreground-muted">{formatDispatchDate(relation.periodStart)} — {formatDispatchDate(relation.periodEnd)} · período {relation.accountingPeriod}</p><p className="mt-1 text-xs text-foreground-muted">{relation.status} · asignación {relation.assignmentSource}</p></li>)}</ul> : <div className="p-5 sm:p-6"><EmptyState title="Sin lote" description="La guía todavía no tiene asignaciones de lote visibles." /></div>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <SectionHeader icon={ReceiptText} title="Facturas relacionadas" count={detail.invoices.length} />
          {detail.invoices.length ? <ul className="divide-y divide-border">{detail.invoices.map((invoice) => <li key={invoice.id} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-foreground">{invoice.number}</p><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-foreground-muted">{invoice.status}</span></div><p className="mt-2 text-xs text-foreground-muted">{invoice.invoiceType} · {formatDispatchDate(invoice.invoiceDate)}</p><p className="mt-2 font-semibold text-foreground">{invoice.currency} {formatDispatchQuantity(invoice.total)}</p></li>)}</ul> : <div className="p-5 sm:p-6"><EmptyState title="Sin facturas" description="No hay facturas relacionadas con esta guía." /></div>}
        </section>
      </div>
    </MotionPage>
  );
}
