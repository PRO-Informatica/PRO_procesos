"use client";

import { ChevronRight, FolderKanban, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";
import type { ProjectSummary } from "@/features/projects/types";

import { formatBatchDate } from "../formatters";
import type { BatchPageData } from "../types";
import { CreateBatchDialog } from "./batch-dialogs";
import { BatchStatusBadge } from "./batch-status-badge";

export function BatchesWorkspace({ project, canCreate, data }: { project: ProjectSummary; canCreate: boolean; data: BatchPageData }) {
  const [createOpen, setCreateOpen] = useState(false);
  return <MotionPage className="mx-auto max-w-[1500px] space-y-5 pb-10">
    <MotionSection className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">Gestión · Operación semanal</p><h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Lotes semanales</h1><p className="mt-2 text-sm text-foreground-muted">Agrupa despachos y gestiona sus facturas y conciliación en {project.name}.</p></div>{canCreate && <button type="button" onClick={() => setCreateOpen(true)} className="primary-button gap-2"><Plus className="size-4" /> Crear lote semanal</button>}</MotionSection>
    <MotionSection className="overflow-hidden rounded-xl border border-border bg-surface"><div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Lotes</h2><p className="mt-1 text-xs text-foreground-muted">Semana, estado y avance por despacho.</p></div>{data.history.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-muted/60 text-[10px] uppercase text-foreground-muted"><tr><th className="p-4">Código</th><th className="p-4">Semana</th><th className="p-4">Período contable</th><th className="p-4">Estado</th><th className="p-4">Despachos</th><th className="p-4">Conciliados / pendientes</th><th className="p-4"></th></tr></thead><tbody className="divide-y divide-border">{data.history.map((batch) => <tr key={batch.id} className={batch.isCurrent ? "bg-brand-soft/25" : ""}><td className="p-4 font-semibold">{batch.code}</td><td className="p-4">{formatBatchDate(batch.periodStart)} – {formatBatchDate(batch.periodEnd)}</td><td className="p-4">{formatBatchDate(batch.accountingPeriod)}</td><td className="p-4"><BatchStatusBadge status={batch.status} /></td><td className="p-4 font-semibold">{batch.activeDispatchCount}</td><td className="p-4"><span className="text-success">{batch.reconciledCount}</span> / <span className="text-foreground-muted">{batch.pendingCount}</span></td><td className="p-4 text-right"><Link href={`/batches/${batch.id}`} className="secondary-button text-xs">Ver lote <ChevronRight className="size-3.5" /></Link></td></tr>)}</tbody></table></div> : <div className="p-6"><EmptyState icon={FolderKanban} title="No existen lotes" description="Crea el primer lote semanal del proyecto." /></div>}</MotionSection>
    {createOpen && <CreateBatchDialog project={project} onClose={() => setCreateOpen(false)} />}
  </MotionPage>;
}
