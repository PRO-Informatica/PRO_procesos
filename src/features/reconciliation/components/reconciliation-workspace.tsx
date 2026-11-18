"use client";

import { Pagination } from "@/components/ui/pagination";
import { Scale, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";
import { StatusBadge, type BadgeTone } from "@/components/ui/badge";
import { formatBatchQuantity } from "@/features/batches/formatters";
import { IndicatorFilter } from "@/features/dashboard/components/indicator-filter";
import type { DashboardListScope } from "@/features/dashboard/details";
import type { ProjectSummary } from "@/features/projects/types";
import { formatStatusLabel } from "@/lib/status-labels";

import { ServiceReconciliationSummaryCard } from "./service-reconciliation-summary";
import type { GlobalReconciliationData, GlobalReconciliationItem } from "../types";

const PAGE_SIZE = 10;
const billingLabels = {
  pendingInvoices: "Por cargar factura",
  pendingReconciliation: "Por conciliar",
  reinvoicing: "Refacturación",
  reconciled: "Conciliados",
};

function tone(status: string): BadgeTone {
  if (status === "RECONCILED" || status === "reconciled") return "success";
  if (["WITH_DIFFERENCES", "PENDING_REINVOICING", "reinvoicing"].includes(status)) return "warning";
  if (status === "PENDING_RECONCILIATION" || status === "pendingReconciliation") return "info";
  return "neutral";
}

function DocumentCompleteness({ item }: { item: GlobalReconciliationItem }) {
  return <div className="space-y-1 text-xs">
    <p><span className="text-foreground-muted">Producto:</span> <strong>{item.hasProductInvoice ? "Cargado" : "Pendiente"}</strong></p>
    <p><span className="text-foreground-muted">Servicio:</span> <strong>{item.hasServiceInvoice ? "Cargado" : item.requiresServiceInvoice ? "Pendiente" : "No requerido"}</strong></p>
  </div>;
}

function ReconciliationBasis({ item }: { item: GlobalReconciliationItem }) {
  return <div>
    <p className="whitespace-nowrap font-semibold tabular-nums">{item.comparisonQuantity === null ? "Pendiente" : `${formatBatchQuantity(item.comparisonQuantity)} ${item.comparisonUnitCode}`}</p>
    <p className="mt-1 text-xs text-foreground-muted">{item.comparisonSource === "PROGRAMMED_QUANTITY" ? "Cantidad programada" : "Volumen real"}</p>
  </div>;
}

function ProductStatus({ item }: { item: GlobalReconciliationItem }) {
  return <div><StatusBadge label={formatStatusLabel(item.reconciliationStatus)} tone={tone(item.reconciliationStatus)} />
    <p className="mt-1 text-xs text-foreground-muted">Diferencia: {item.difference === null ? "—" : formatBatchQuantity(item.difference)}</p></div>;
}

function ServiceStatus({ item }: { item: GlobalReconciliationItem }) {
  return !item.requiresServiceInvoice && !item.hasServiceInvoice
    ? <span className="text-xs text-foreground-muted">No requerido · Concreto directo</span>
    : item.serviceReconciliation && <ServiceReconciliationSummaryCard summary={item.serviceReconciliation} />;
}

function ReconciliationAction({ item, batch }: { item: GlobalReconciliationItem; batch: string }) {
  const batchId = batch || item.batchId;
  return <Link href={batchId ? `/batches/${batchId}` : `/dispatches/${item.dispatchId}`} className="secondary-button w-full whitespace-nowrap px-3 text-xs">
    {batchId ? "Ver conciliación" : "Ver despacho"}
  </Link>;
}

export function ReconciliationWorkspace({ project, data, dashboardScope }: {
  project: ProjectSummary; data: GlobalReconciliationData; dashboardScope?: DashboardListScope;
}) {
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState(dashboardScope?.batchId ?? "");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const selectedBatchCode = data.batches.find(item => item.id === batch)?.code;
  const filtered = useMemo(() => data.items.filter(item =>
    (!dashboardScope || dashboardScope.recordIds.includes(item.dispatchId)) &&
    (!query || [item.dispatchId, `DSP-${item.dispatchId.slice(0, 8)}`, item.orderNumber, item.programmingCode, item.supplierName].some(value => value.toLowerCase().includes(query.trim().toLowerCase()))) &&
    (!batch || item.batchIds.includes(batch)) && (!status || item.billingStatus === status),
  ), [data.items, query, batch, status, dashboardScope]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visibleItems = filtered.slice(start, start + PAGE_SIZE);

  return <MotionPage className="mx-auto w-full min-w-0 max-w-[1600px] space-y-5 pb-10">
    {dashboardScope && <IndicatorFilter scope={dashboardScope} clearHref="/reconciliation" />}
    <MotionSection>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">Control global · {project.name}</p>
      <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Conciliación por despacho</h1>
      <p className="mt-2 text-sm text-foreground-muted">Producto y Servicio determinan el estado del despacho. Concreto directo conserva la excepción de Servicio.</p>
    </MotionSection>
    <MotionSection className="rounded-xl border border-border bg-surface p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-foreground-muted" /><input aria-label="Buscar conciliaciones" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} className="form-input pl-9" placeholder="Despacho, pedido o proveedor" /></label>
        <select aria-label="Filtrar por lote" value={batch} onChange={event => { setBatch(event.target.value); setPage(1); }} className="form-input"><option value="">Todos los lotes</option>{data.batches.map(item => <option key={item.id} value={item.id}>{item.code}</option>)}</select>
        <select aria-label="Filtrar por estado del despacho" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className="form-input"><option value="">Todos los estados</option>{Object.entries(billingLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </div>
    </MotionSection>
    <MotionSection className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Despachos</h2><span className="text-xs text-foreground-muted" aria-live="polite">{filtered.length} resultado(s)</span>
      </div>
      {filtered.length ? <>
        <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[1120px] text-left text-sm">
          <thead className="bg-muted/60 text-[10px] uppercase text-foreground-muted"><tr>
            {["Despacho / pedido", "Proveedor / lote", "Estado", "Base de conciliación", "Documentos", "Producto", "Servicio", "Acciones"].map(label => <th key={label} className="p-4">{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border">{visibleItems.map(item => <tr key={item.id} className="align-middle hover:bg-muted/25">
            <td className="p-4"><Link href={`/dispatches/${item.dispatchId}`} className="whitespace-nowrap font-semibold text-brand-strong">DSP-{item.dispatchId.slice(0, 8).toUpperCase()}</Link><p className="mt-1 text-xs text-foreground-muted">Pedido {item.orderNumber}</p><p className="mt-1 text-[10px] text-foreground-muted">{item.programmingCode}</p></td>
            <td className="p-4"><p className="font-medium">{item.supplierName}</p><p className="mt-1 text-xs text-foreground-muted">{selectedBatchCode ?? item.batchCode}</p></td>
            <td className="p-4"><StatusBadge label={billingLabels[item.billingStatus]} tone={tone(item.billingStatus)} /></td>
            <td className="p-4"><ReconciliationBasis item={item} /></td>
            <td className="p-4"><DocumentCompleteness item={item} /></td>
            <td className="p-4"><ProductStatus item={item} /></td>
            <td className="min-w-56 p-4"><ServiceStatus item={item} /></td>
            <td className="w-44 p-4"><ReconciliationAction item={item} batch={batch} /></td>
          </tr>)}</tbody>
        </table></div>
        <div className="divide-y divide-border lg:hidden">{visibleItems.map(item => <article key={item.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/dispatches/${item.dispatchId}`} className="font-semibold text-brand-strong">DSP-{item.dispatchId.slice(0, 8).toUpperCase()}</Link><StatusBadge label={billingLabels[item.billingStatus]} tone={tone(item.billingStatus)} /></div>
          <p className="mt-2 text-sm font-medium">{item.supplierName}</p><p className="mt-1 text-xs text-foreground-muted">Pedido {item.orderNumber} · {selectedBatchCode ?? item.batchCode}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-muted/45 p-3 text-xs">
            <div><dt className="mb-2 text-foreground-muted">Base de conciliación</dt><dd><ReconciliationBasis item={item} /></dd></div>
            <div><dt className="mb-2 text-foreground-muted">Documentos</dt><dd><DocumentCompleteness item={item} /></dd></div>
            <div className="col-span-2"><dt className="mb-2 text-foreground-muted">Conciliación Producto</dt><dd><ProductStatus item={item} /></dd></div>
            <div className="col-span-2"><dt className="mb-2 text-foreground-muted">Conciliación Servicio</dt><dd><ServiceStatus item={item} /></dd></div>
          </dl><div className="mt-3"><ReconciliationAction item={item} batch={batch} /></div>
        </article>)}</div>
      </> : <div className="p-4 sm:p-6"><EmptyState icon={Scale} title="Sin conciliaciones" description="No hay despachos que coincidan con los filtros seleccionados." /></div>}
      <Pagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} ariaLabel="Paginación de conciliaciones" className="border-t border-border" />
    </MotionSection>
  </MotionPage>;
}
