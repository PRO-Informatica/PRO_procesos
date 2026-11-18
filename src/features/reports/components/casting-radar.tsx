"use client";

import { Pagination } from "@/components/ui/pagination";
import { useState } from "react";
import { FileSpreadsheet, FlaskConical, Radar, ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingButton } from "@/components/feedback/loading-button";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";
import { notify } from "@/lib/notify";
import { MAX_RADAR_DISPATCHES, radarDate, radarLocalDate, radarSearchParams, type RadarData, type RadarFilters } from "../radar";
import { DispatchReportFilters } from "./report-filters";
import { DispatchReportCard } from "./dispatch-report-card";
import { ReportSections } from "./report-sections";

const PAGE_SIZE = 8;
export function CastingRadar({ data, filters, universal = false, report = "radar" }: { data: RadarData; filters: RadarFilters; universal?: boolean; report?: "radar" | "concrete" }) {
  const concrete = report === "concrete";
  const route = concrete ? "/reports/concrete-control" : "/reports/radar";
  const title = concrete ? "Sistema de control" : "Radar de fundición";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const pageCount = Math.max(1, Math.ceil(data.dispatches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = data.dispatches.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const query = radarSearchParams(filters, universal).toString();

  function toggle(id: string, checked: boolean) {
    if (checked && selected.size >= MAX_RADAR_DISPATCHES) {
      notify.error("Límite de selección", `Puedes exportar hasta ${MAX_RADAR_DISPATCHES} despachos por archivo.`);
      return;
    }
    setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  }

  async function download() {
    if (!selected.size || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(`${route}/export?${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dispatchIds: [...selected] }) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || `No fue posible generar el Excel de ${title.toLowerCase()}.`);
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${concrete ? "sistema-de-control" : "radar-fundicion"}-${filters.dateFrom}-${filters.dateTo}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify.success("Excel generado", concrete ? `${selected.size} despacho(s) en una sola hoja.` : `${selected.size} despacho(s), una hoja por despacho.`);
    } catch (error) {
      notify.error(`No se pudo descargar ${title.toLowerCase()}`, error instanceof Error ? error.message : "Intenta nuevamente.");
    } finally { setDownloading(false); }
  }

  return <MotionPage className="mx-auto min-w-0 max-w-[1500px]">
    <MotionSection className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-brand-strong">Control de despachos</p><h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{concrete ? <ClipboardList className="size-6 shrink-0 text-brand-strong" /> : <Radar className="size-6 shrink-0 text-brand-strong" />}{title}</h1><p className="mt-2 max-w-3xl text-sm text-foreground-muted">{concrete ? "Exporta una fila por despacho con su programación, productos, servicios y facturas." : "Selecciona uno o varios despachos y descarga un Excel con una hoja por despacho y el desglose completo de sus guías."}</p></div>
      <LoadingButton type="button" loading={downloading} loadingLabel="Generando Excel…" disabled={!selected.size} onClick={download} className="w-full shrink-0 sm:w-auto"><FileSpreadsheet className="size-4" />Exportar Excel ({selected.size})</LoadingButton>
    </MotionSection>
    <ReportSections universal={universal} radar={!concrete} concrete={concrete} />
    <DispatchReportFilters key={query} filters={filters} projects={data.projects} route={route} />
    <MotionSection className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-semibold text-foreground">{data.dispatches.length} despacho(s) · {selected.size} seleccionado(s)</p><p className="mt-1 text-xs text-foreground-muted">Máximo {MAX_RADAR_DISPATCHES} por descarga. La selección se conserva al cambiar de página.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className="secondary-button text-xs" disabled={!data.dispatches.length || downloading} onClick={() => setSelected(new Set(data.dispatches.slice(0, MAX_RADAR_DISPATCHES).map((dispatch) => dispatch.id)))}>{data.dispatches.length > MAX_RADAR_DISPATCHES ? `Seleccionar primeros ${MAX_RADAR_DISPATCHES}` : "Seleccionar todos"}</button><button type="button" className="ghost-button text-xs" disabled={!selected.size || downloading} onClick={() => setSelected(new Set())}>Quitar selección</button></div>
    </MotionSection>
    <div className="mt-3 flex items-center gap-2 text-xs text-foreground-muted"><span className="inline-flex items-center gap-1.5 rounded-md bg-[#FFE066] px-2 py-1 text-[#1A1A1A]"><FlaskConical className="size-3.5" />Laboratorio aplicado</span><span>{concrete ? "Los despachos con laboratorio se resaltan en amarillo en el Excel." : "Las guías con laboratorio se resaltan en amarillo en el Excel."}</span></div>
    <MotionSection className="mt-4 space-y-4">
      {!data.dispatches.length ? <div className="rounded-xl border border-border bg-surface p-6"><EmptyState title="Sin despachos" description="No se encontraron despachos con estos filtros. Prueba otro rango de fechas o limpia la búsqueda." /></div> : visible.map((dispatch) => <article key={dispatch.id} className="min-w-0 rounded-xl bg-surface">
        <DispatchReportCard dispatch={dispatch.summary}
          selection={<input type="checkbox" className="size-5 shrink-0 accent-red-600" checked={selected.has(dispatch.id)} disabled={downloading} onChange={(event) => toggle(dispatch.id, event.target.checked)} aria-label={`Seleccionar ${dispatch.code}`} />}
          context={<p className="mt-2 break-words text-xs text-foreground-muted">{dispatch.projectName} · {dispatch.supplierName} · {radarDate(radarLocalDate(dispatch.scheduledAt, dispatch.timezone))}</p>}
        />
      </article>)}
    </MotionSection>
    {pageCount > 1 && <Pagination page={currentPage} pageSize={PAGE_SIZE} total={data.dispatches.length} onPageChange={setPage} itemLabel="despachos" ariaLabel={`Paginación de despachos de ${title.toLowerCase()}`} className="mt-4 border border-border" />}
  </MotionPage>;
}
