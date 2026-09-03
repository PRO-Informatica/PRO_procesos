"use client";

import { CalendarDays, ChevronRight, Plus, Search, Truck, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";
import type { ProjectSummary } from "@/features/projects/types";
import { formatStatusLabel } from "@/lib/status-labels";

import {
  formatDispatchDateTime,
  formatDispatchQuantity,
} from "../formatters";
import type {
  DispatchPageData,
  ProgrammingDispatchItem,
  ProgrammingDispatchStatus,
} from "../types";
import { DispatchStatusBadge } from "./dispatch-badges";
import { DispatchGuideDialog } from "./dispatch-guide-dialog";
import { StartDispatchDialog } from "./register-dispatch-dialog";

type DateMode = "day" | "week" | "month";
type DispatchFilter = "" | "NOT_STARTED" | "IN_EXECUTION" | "COMPLETED";

function localDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function matchesPeriod(value: string, anchor: string, mode: DateMode) {
  if (!anchor) return true;
  if (mode === "day") return value === anchor;
  if (mode === "month") return value.slice(0, 7) === anchor.slice(0, 7);
  const selected = new Date(`${anchor}T12:00:00Z`);
  const weekday = selected.getUTCDay() || 7;
  const start = new Date(selected);
  start.setUTCDate(selected.getUTCDate() - weekday + 1);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const current = new Date(`${value}T12:00:00Z`);
  return current >= start && current <= end;
}

function DispatchActions({
  item,
  canCreate,
  canModify,
  onStart,
  onAddGuide,
}: {
  item: ProgrammingDispatchItem;
  canCreate: boolean;
  canModify: boolean;
  onStart: () => void;
  onAddGuide: () => void;
}) {
  if (!item.dispatchId) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Link href={`/programming/${item.programmingId}`} className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted">Ver programación</Link>
        {canCreate && <button type="button" onClick={onStart} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong"><Plus className="size-4" /> Iniciar despacho</button>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Link href={`/dispatches/${item.dispatchId}`} className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted">Ver despacho</Link>
      {item.dispatchStatus === "IN_EXECUTION" && canModify && <button type="button" onClick={onAddGuide} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong"><Plus className="size-4" /> Agregar guía</button>}
    </div>
  );
}

export function DispatchesWorkspace({
  project,
  canCreate,
  canModify,
  data,
  receiverName,
}: {
  project: ProjectSummary;
  canCreate: boolean;
  canModify: boolean;
  data: DispatchPageData;
  receiverName: string;
}) {
  const [programmingStatus, setProgrammingStatus] = useState<ProgrammingDispatchStatus | "">("");
  const [dispatchStatus, setDispatchStatus] = useState<DispatchFilter>("");
  const [dateMode, setDateMode] = useState<DateMode>("day");
  const [date, setDate] = useState("");
  const [code, setCode] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [startItem, setStartItem] = useState<ProgrammingDispatchItem | null>(null);
  const [guideItem, setGuideItem] = useState<ProgrammingDispatchItem | null>(null);

  const filtered = useMemo(() => data.items.filter((item) => {
    const itemDate = localDate(item.scheduledAt, project.timezone || "America/Guatemala");
    const statusMatches = dispatchStatus === ""
      || (dispatchStatus === "NOT_STARTED" ? !item.dispatchId : item.dispatchStatus === dispatchStatus);
    return (
      (!programmingStatus || item.programmingStatus === programmingStatus)
      && statusMatches
      && (!code || item.programmingCode.toLowerCase().includes(code.trim().toLowerCase()))
      && matchesPeriod(itemDate, date, dateMode)
    );
  }), [code, data.items, date, dateMode, dispatchStatus, programmingStatus, project.timezone]);
  const selected = data.items.find((item) => item.programmingId === selectedId) ?? null;
  const hasFilters = Boolean(programmingStatus || dispatchStatus || date || code);
  const clearFilters = () => {
    setProgrammingStatus("");
    setDispatchStatus("");
    setDate("");
    setCode("");
  };

  return (
    <MotionPage className="mx-auto max-w-[1600px] space-y-5 pb-10">
      <MotionSection>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">Operación · Despachos en obra</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Despachos</h1>
        <p className="mt-2 text-sm text-foreground-muted">Gestiona una operación progresiva por programación, con múltiples guías y productos.</p>
      </MotionSection>

      <MotionSection className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground-muted">Filtros</p>{hasFilters && <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-strong"><X className="size-3.5" /> Limpiar</button>}</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_0.8fr_1fr_1.2fr]">
          <select aria-label="Estado programación" value={programmingStatus} onChange={(event) => setProgrammingStatus(event.target.value as ProgrammingDispatchStatus | "")} className="form-input"><option value="">Estado programación</option><option value="CONFIRMED">Confirmada</option><option value="IN_EXECUTION">En ejecución</option></select>
          <select aria-label="Estado despacho" value={dispatchStatus} onChange={(event) => setDispatchStatus(event.target.value as DispatchFilter)} className="form-input"><option value="">Estado despacho</option><option value="NOT_STARTED">Sin iniciar</option><option value="IN_EXECUTION">En ejecución</option><option value="COMPLETED">Completado</option></select>
          <select aria-label="Periodo de fecha" value={dateMode} onChange={(event) => setDateMode(event.target.value as DateMode)} className="form-input"><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option></select>
          <div className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" /><input aria-label="Fecha" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="form-input pl-10" /></div>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" /><input aria-label="Código programación" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Código programación" className="form-input pl-10" /></div>
        </div>
      </MotionSection>

      <MotionSection className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4 sm:px-6"><h2 className="font-semibold">Programaciones listas para despachar</h2><p className="mt-1 text-xs text-foreground-muted">Programaciones confirmadas o actualmente en ejecución</p></div>
        {!filtered.length ? <div className="p-6"><EmptyState icon={Truck} title="No hay programaciones disponibles" description={hasFilters ? "Ajusta los filtros para ver otros resultados." : "Las programaciones confirmadas aparecerán aquí."} /></div> : (
          <>
            <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-muted/60 text-[10px] uppercase tracking-[0.08em] text-foreground-muted"><tr><th className="px-5 py-3">Código programación</th><th className="px-5 py-3">Estado programación</th><th className="px-5 py-3">Proveedor</th><th className="px-5 py-3">Fecha</th><th className="px-5 py-3">Estado despacho</th><th className="px-5 py-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-border">{filtered.map((item) => <tr key={item.programmingId} onClick={() => setSelectedId(item.programmingId)} className={`cursor-pointer hover:bg-muted/35 ${selectedId === item.programmingId ? "bg-brand-soft/35" : ""}`}><td className="px-5 py-4 font-mono text-xs font-semibold text-brand-strong">{item.programmingCode}</td><td className="px-5 py-4">{formatStatusLabel(item.programmingStatus)}</td><td className="px-5 py-4 font-medium">{item.supplierName}</td><td className="px-5 py-4 text-foreground-muted">{formatDispatchDateTime(item.scheduledAt, project.timezone)}</td><td className="px-5 py-4">{item.dispatchStatus ? <DispatchStatusBadge status={item.dispatchStatus} /> : <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground-muted">Sin iniciar</span>}</td><td className="px-5 py-4" onClick={(event) => event.stopPropagation()}><DispatchActions item={item} canCreate={canCreate} canModify={canModify} onStart={() => setStartItem(item)} onAddGuide={() => setGuideItem(item)} /></td></tr>)}</tbody></table></div>
            <div className="divide-y divide-border lg:hidden">{filtered.map((item) => <article key={item.programmingId} className="p-4" onClick={() => setSelectedId(item.programmingId)}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-xs font-semibold text-brand-strong">{item.programmingCode}</p><p className="mt-1 truncate font-semibold">{item.supplierName}</p><p className="mt-1 text-xs text-foreground-muted">{formatDispatchDateTime(item.scheduledAt, project.timezone)}</p></div>{item.dispatchStatus ? <DispatchStatusBadge status={item.dispatchStatus} /> : <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold">Sin iniciar</span>}</div><div className="mt-4" onClick={(event) => event.stopPropagation()}><DispatchActions item={item} canCreate={canCreate} canModify={canModify} onStart={() => setStartItem(item)} onAddGuide={() => setGuideItem(item)} /></div></article>)}</div>
          </>
        )}
      </MotionSection>

      {selected?.dispatchId && <MotionSection className="overflow-hidden rounded-xl border border-border bg-surface"><div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6"><div><h2 className="font-semibold">Despacho {selected.programmingCode}</h2><p className="mt-1 text-xs text-foreground-muted">Estado: {selected.dispatchStatus ? formatStatusLabel(selected.dispatchStatus) : "Sin iniciar"}</p></div><Link href={`/dispatches/${selected.dispatchId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-strong">Ver detalle <ChevronRight className="size-4" /></Link></div>{selected.guides.length ? <><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-muted/45 text-xs text-foreground-muted"><tr><th className="px-5 py-3">Guía</th><th className="px-5 py-3">Volumen</th><th className="px-5 py-3">Productos</th><th className="px-5 py-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-border">{selected.guides.map((guide) => <tr key={guide.id}><td className="px-5 py-4 font-semibold">{guide.guideNumber}</td><td className="px-5 py-4">{formatDispatchQuantity(guide.quantity)} {guide.unitCode}</td><td className="px-5 py-4">{guide.productCount}</td><td className="px-5 py-4 text-right"><Link href={`/dispatches/${selected.dispatchId}#guides`} className="text-xs font-semibold text-brand-strong">Ver / Editar</Link></td></tr>)}</tbody></table></div><div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold">Total según guías: {formatDispatchQuantity(selected.guideTotal)} {selected.unitCode}</p>{selected.dispatchStatus === "IN_EXECUTION" && canModify && <button type="button" onClick={() => setGuideItem(selected)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white"><Plus className="size-4" /> Agregar guía</button>}</div></> : <div className="p-5"><EmptyState title="Sin guías registradas" description="Este despacho aún no tiene entregas documentadas." action={selected.dispatchStatus === "IN_EXECUTION" && canModify ? <button type="button" onClick={() => setGuideItem(selected)} className="primary-button"><Plus className="size-4" /> Agregar guía</button> : undefined} /></div>}</MotionSection>}

      {startItem && <StartDispatchDialog projectId={project.id} timezone={project.timezone || "America/Guatemala"} receiverName={receiverName} programming={startItem} onClose={() => setStartItem(null)} />}
      {guideItem?.dispatchId && guideItem.version && <DispatchGuideDialog projectId={project.id} programmingId={guideItem.programmingId} dispatchId={guideItem.dispatchId} expectedVersion={guideItem.version} programmedUnitCode={guideItem.unitCode} units={data.units} onClose={() => setGuideItem(null)} />}
    </MotionPage>
  );
}
