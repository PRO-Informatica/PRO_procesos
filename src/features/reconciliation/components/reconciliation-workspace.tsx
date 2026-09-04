"use client";

import { Scale, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import { StatusBadge } from "@/components/ui/badge";
import { formatBatchQuantity } from "@/features/batches/formatters";
import type { ProjectSummary } from "@/features/projects/types";
import { formatStatusLabel } from "@/lib/status-labels";

import type { GlobalReconciliationData } from "../types";

export function ReconciliationWorkspace({ project, data }: { project: ProjectSummary; data: GlobalReconciliationData }) {
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState("");
  const [status, setStatus] = useState("");
  const statuses = [...new Set(data.items.map((item) => item.reconciliationStatus))].sort();
  const filtered = useMemo(() => data.items.filter((item) => (!query || [item.orderNumber, item.programmingCode, item.supplierName].some((value) => value.toLowerCase().includes(query.toLowerCase()))) && (!batch || item.batchId === batch) && (!status || item.reconciliationStatus === status)), [data.items, query, batch, status]);
  return <MotionPage className="mx-auto max-w-[1500px] space-y-5 pb-10">
    <header><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">Control global · {project.name}</p><h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Conciliación por despacho</h1><p className="mt-2 text-sm text-foreground-muted">Compara la factura de producto contra el Volumen Real oficial del despacho.</p></header>
    <section className="rounded-xl border border-border bg-surface p-4"><div className="grid gap-3 md:grid-cols-3"><label className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-foreground-muted" /><input aria-label="Buscar conciliaciones" value={query} onChange={(event) => setQuery(event.target.value)} className="form-input pl-9" placeholder="Despacho, pedido o proveedor" /></label><select aria-label="Filtrar por lote" value={batch} onChange={(event) => setBatch(event.target.value)} className="form-input"><option value="">Todos los lotes</option>{data.batches.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select><select aria-label="Filtrar por estado" value={status} onChange={(event) => setStatus(event.target.value)} className="form-input"><option value="">Todos los estados</option>{statuses.map((item) => <option key={item} value={item}>{formatStatusLabel(item)}</option>)}</select></div></section>
    <section className="overflow-hidden rounded-xl border border-border bg-surface">{filtered.length ? <>
      <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-muted/60 text-[10px] uppercase text-foreground-muted"><tr><th className="p-4">Despacho</th><th className="p-4">Lote</th><th className="p-4">Pedido</th><th className="p-4">Proveedor</th><th className="p-4">Volumen Real</th><th className="p-4">Facturas</th><th className="p-4">Estado / diferencia</th><th className="p-4"></th></tr></thead><tbody className="divide-y divide-border">{filtered.map((item) => <tr key={item.id}><td className="p-4 font-semibold text-brand-strong">{item.programmingCode}</td><td className="p-4">{item.batchCode}</td><td className="p-4">{item.orderNumber}</td><td className="p-4">{item.supplierName}</td><td className="p-4 font-semibold">{formatBatchQuantity(item.realVolume)} {item.unitCode}</td><td className="p-4">{item.invoiceCount}/2</td><td className="p-4"><StatusBadge label={formatStatusLabel(item.reconciliationStatus)} tone={item.reconciliationStatus === "RECONCILED" ? "success" : item.reconciliationStatus === "WITH_DIFFERENCES" ? "warning" : "neutral"} /><p className="mt-1 text-xs text-foreground-muted">Diferencia: {item.difference === null ? "—" : formatBatchQuantity(item.difference)}</p></td><td className="p-4 text-right"><Link href={`/batches/${item.batchId}`} className="primary-button text-xs">Ver conciliación</Link></td></tr>)}</tbody></table></div>
      <div className="divide-y divide-border lg:hidden">{filtered.map((item) => <article key={item.id} className="p-4"><div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-brand-strong">{item.programmingCode}</p><p className="mt-1 truncate text-sm font-medium text-foreground">{item.supplierName}</p></div><StatusBadge label={formatStatusLabel(item.reconciliationStatus)} tone={item.reconciliationStatus === "RECONCILED" ? "success" : item.reconciliationStatus === "WITH_DIFFERENCES" ? "warning" : "neutral"} /></div><dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-muted/45 p-3 text-xs"><div><dt className="text-foreground-muted">Volumen Real</dt><dd className="mt-1 font-semibold text-foreground">{formatBatchQuantity(item.realVolume)} {item.unitCode}</dd></div><div><dt className="text-foreground-muted">Cantidad facturada</dt><dd className="mt-1 font-semibold text-foreground">{item.invoiceCount}/2 facturas</dd></div><div><dt className="text-foreground-muted">Diferencia</dt><dd className="mt-1 font-semibold text-foreground">{item.difference === null ? "—" : formatBatchQuantity(item.difference)}</dd></div><div><dt className="text-foreground-muted">Pedido / lote</dt><dd className="mt-1 break-words font-medium text-foreground">{item.orderNumber} · {item.batchCode}</dd></div></dl><Link href={`/batches/${item.batchId}`} className="primary-button mt-4 w-full text-xs">Ver conciliación</Link></article>)}</div>
    </> : <div className="p-4 sm:p-6"><EmptyState icon={Scale} title="Sin conciliaciones" description="Ajusta los filtros o abre un lote para cargar facturas." /></div>}</section>
  </MotionPage>;
}
