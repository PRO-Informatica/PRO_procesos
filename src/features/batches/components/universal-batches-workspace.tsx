"use client";

import { ChevronLeft, ChevronRight, FolderKanban, LoaderCircle, Search } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";

import { formatBatchDate } from "../formatters";
import type {
  BatchDetail,
  BatchPageData,
  BatchPermissions,
  BatchSecondaryData,
  BatchSummary,
  UniversalBatchProject,
} from "../types";
import { BatchDetailView } from "./batch-detail-view";
import { BatchStatusBadge } from "./batch-status-badge";

type Selection = { projectId: string; batchId: string };
type DetailResponse<T> = { data?: T; message?: string };

function selectionKey(projectId: string, batchId: string) {
  return `${projectId}:${batchId}`;
}

async function requestData<T>(url: string, signal?: AbortSignal) {
  const startedAt = performance.now();
  const response = await fetch(url, { cache: "no-store", signal });
  const body = await response.json() as DetailResponse<T>;
  if (!response.ok || !body.data) throw new Error(body.message ?? "No fue posible cargar el lote.");
  return { data: body.data, requestDurationMs: Math.round((performance.now() - startedAt) * 10) / 10 };
}

function BatchOption({ batch, selected, pending, onSelect }: {
  batch: BatchSummary;
  selected: boolean;
  pending: boolean;
  onSelect: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return <motion.button
    type="button"
    onClick={onSelect}
    disabled={pending}
    className={`flex min-h-16 w-full cursor-pointer flex-col items-stretch justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors min-[420px]:flex-row min-[420px]:items-center sm:px-4 disabled:cursor-wait disabled:opacity-65 ${selected ? "border-brand bg-brand-soft/35 shadow-sm" : "border-border bg-surface hover:border-brand/35 hover:bg-muted/35"}`}
    aria-current={selected ? "true" : undefined}
    aria-busy={pending}
    animate={selected && !reduceMotion ? { scale: [1, 1.012, 1] } : { scale: 1 }}
    whileHover={reduceMotion ? undefined : { y: -2 }}
    whileTap={reduceMotion ? undefined : { scale: 0.985 }}
    transition={{ duration: reduceMotion ? 0 : 0.2 }}
  >
    <span className="min-w-0"><strong className="block truncate text-sm">{batch.code}</strong><span className="mt-1 block text-xs leading-5 text-foreground-muted">{formatBatchDate(batch.periodStart)} – {formatBatchDate(batch.periodEnd)} · {batch.activeDispatchCount} despacho(s)</span></span>
    <span className="flex shrink-0 items-center justify-between gap-2 min-[420px]:justify-end"><BatchStatusBadge status={batch.status} />{pending ? <LoaderCircle className="size-4 animate-spin text-brand-strong" /> : <ChevronRight className={`size-4 transition-transform ${selected ? "translate-x-0.5 text-brand-strong" : "text-foreground-muted"}`} />}</span>
  </motion.button>;
}

export function UniversalBatchesWorkspace({ projects }: { projects: UniversalBatchProject[] }) {
  const [projectEntries, setProjectEntries] = useState(projects);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<BatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const scrollToDetailRef = useRef(false);
  const selectionRef = useRef<Selection | null>(null);
  const detailCache = useRef(new Map<string, BatchDetail>());
  const pendingRequest = useRef<AbortController | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => () => pendingRequest.current?.abort(), []);

  useEffect(() => {
    if (!selectedDetail || !scrollToDetailRef.current) return;
    scrollToDetailRef.current = false;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    detailRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [reduceMotion, selectedDetail]);

  const loadCore = useCallback(async (next: Selection, force = false) => {
    const key = selectionKey(next.projectId, next.batchId);
    const cached = detailCache.current.get(key);
    if (cached && !force) {
      pendingRequest.current?.abort();
      pendingRequest.current = null;
      setDetailLoading(false);
      setSelectedDetail(cached);
      setDetailError(null);
      console.info("[Lotes Universal] detalle reutilizado", { requests: 0, cacheHit: true, projectId: next.projectId, batchId: next.batchId });
      return cached;
    }

    pendingRequest.current?.abort();
    const controller = new AbortController();
    pendingRequest.current = controller;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const result = await requestData<BatchDetail>(`/api/batches/universal/detail?projectId=${encodeURIComponent(next.projectId)}&batchId=${encodeURIComponent(next.batchId)}`, controller.signal);
      detailCache.current.set(key, result.data);
      if (selectionRef.current?.projectId === next.projectId && selectionRef.current?.batchId === next.batchId) setSelectedDetail(result.data);
      console.info("[Lotes Universal] detalle cargado", {
        requests: 1,
        cacheHit: false,
        requestDurationMs: result.requestDurationMs,
        queries: result.data.loadMetrics.queryCount,
        queryStages: result.data.loadMetrics.stageCount,
        queryDurationMs: result.data.loadMetrics.durationMs,
      });
      return result.data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      if (selectionRef.current?.projectId === next.projectId && selectionRef.current?.batchId === next.batchId) {
        setSelectedDetail(null);
        setDetailError(error instanceof Error ? error.message : "No fue posible cargar el lote.");
      }
      return null;
    } finally {
      if (pendingRequest.current === controller) {
        pendingRequest.current = null;
        setDetailLoading(false);
      }
    }
  }, []);

  function selectBatch(projectId: string, batchId: string) {
    const next = { projectId, batchId };
    selectionRef.current = next;
    setSelected(next);
    setSelectedDetail(detailCache.current.get(selectionKey(projectId, batchId)) ?? null);
    scrollToDetailRef.current = true;
    void loadCore(next);
  }

  const loadSecondary = useCallback(async () => {
    const current = selectionRef.current;
    if (!current) throw new Error("Selecciona un lote.");
    const key = selectionKey(current.projectId, current.batchId);
    const cached = detailCache.current.get(key);
    if (cached?.secondaryLoaded) return { removedRelations: cached.removedRelations, preview: cached.preview, loadMetrics: cached.loadMetrics } satisfies BatchSecondaryData;
    const result = await requestData<BatchSecondaryData>(`/api/batches/universal/detail?projectId=${encodeURIComponent(current.projectId)}&batchId=${encodeURIComponent(current.batchId)}&section=secondary`);
    const core = detailCache.current.get(key);
    if (core) {
      const merged = { ...core, ...result.data, secondaryLoaded: true };
      detailCache.current.set(key, merged);
      if (selectionRef.current?.projectId === current.projectId && selectionRef.current?.batchId === current.batchId) setSelectedDetail(merged);
    }
    console.info("[Lotes Universal] datos secundarios cargados", { requests: 1, requestDurationMs: result.requestDurationMs, queries: result.data.loadMetrics.queryCount, queryStages: result.data.loadMetrics.stageCount });
    return result.data;
  }, []);

  const refreshSelected = useCallback(async () => {
    const current = selectionRef.current;
    if (!current) return;
    detailCache.current.delete(selectionKey(current.projectId, current.batchId));
    const [detailResult, projectResult] = await Promise.all([
      loadCore(current, true),
      requestData<BatchPageData>(`/api/batches/universal/project?projectId=${encodeURIComponent(current.projectId)}`),
    ]);
    setProjectEntries((entries) => entries.map((entry) => entry.project.id === current.projectId ? { ...entry, batches: projectResult.data.history } : entry));
    if (!detailResult) throw new Error("La acción se completó, pero no fue posible actualizar el detalle.");
  }, [loadCore]);

  const normalizedSearch = search.trim().toLocaleLowerCase("es-GT");
  const visibleProjects = useMemo(() => projectEntries.map((entry) => ({
    ...entry,
    batches: entry.batches.filter((batch) => (statusFilter === "ALL" || batch.status === statusFilter) && (!normalizedSearch || batch.code.toLocaleLowerCase("es-GT").includes(normalizedSearch))),
  })).filter((entry) => projectFilter === "ALL" || entry.project.id === projectFilter), [normalizedSearch, projectEntries, projectFilter, statusFilter]);
  const hasResults = visibleProjects.some(({ batches }) => batches.length > 0);
  const selectedEntry = selected ? projectEntries.find(({ project }) => project.id === selected.projectId) ?? null : null;
  const permissions: BatchPermissions | null = selectedEntry ? {
    canCreate: selectedEntry.permissions.includes("batch.create"),
    canModify: selectedEntry.permissions.includes("batch.modify"),
    canCreateInvoice: selectedEntry.permissions.includes("invoice.create"),
    canMatchInvoice: selectedEntry.permissions.includes("invoice.match"),
    canReviewInvoice: selectedEntry.permissions.includes("invoice.review"),
  } : null;

  function moveCarousel(direction: -1 | 1) {
    const carousel = carouselRef.current;
    if (!carousel) return;
    carousel.scrollBy({ left: direction * Math.min(carousel.clientWidth * 0.86, 520), behavior: reduceMotion ? "auto" : "smooth" });
  }

  return <MotionPage className="mx-auto max-w-[1600px] space-y-5 pb-10">
    <MotionSection className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">Gestión multi-proyecto</p><h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Lotes Universal</h1><p className="mt-2 max-w-2xl text-sm leading-5 text-foreground-muted">Selecciona un proyecto y gestiona su lote sin salir de esta página.</p></div><span className="w-fit rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-foreground-muted">{projectEntries.length} proyecto(s) autorizado(s)</span></MotionSection>

    <MotionSection className="rounded-xl border border-border bg-surface p-4 sm:p-5"><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,.45fr)_minmax(10rem,.35fr)]"><label className="relative"><span className="sr-only">Buscar lote</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar código de lote" className="form-input pl-10" /></label><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="form-input" aria-label="Filtrar por proyecto"><option value="ALL">Todos los proyectos</option>{projectEntries.map(({ project }) => <option key={project.id} value={project.id}>{project.name} · {project.code}</option>)}</select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="form-input" aria-label="Filtrar por estado"><option value="ALL">Todos los estados</option><option value="OPEN">Abiertos</option><option value="CLOSED">Cerrados</option></select></div></MotionSection>

    <MotionSection className="space-y-3">
      <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Proyectos y lotes</h2><p className="mt-1 text-xs text-foreground-muted"><span className="sm:hidden">Desliza horizontalmente.</span><span className="hidden sm:inline">Desliza horizontalmente o utiliza las flechas.</span></p></div>{visibleProjects.length > 1 && <div className="hidden shrink-0 gap-2 sm:flex"><button type="button" onClick={() => moveCarousel(-1)} className="grid size-11 cursor-pointer place-items-center rounded-lg border border-border bg-surface text-foreground-muted transition-colors hover:border-brand/35 hover:text-foreground active:bg-muted" aria-label="Proyecto anterior"><ChevronLeft className="size-5" /></button><button type="button" onClick={() => moveCarousel(1)} className="grid size-11 cursor-pointer place-items-center rounded-lg border border-border bg-surface text-foreground-muted transition-colors hover:border-brand/35 hover:text-foreground active:bg-muted" aria-label="Proyecto siguiente"><ChevronRight className="size-5" /></button></div>}</div>
      <div ref={carouselRef} className="flex touch-pan-x snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2 sm:gap-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleProjects.map(({ project, batches }, index) => <motion.article key={project.id} className={`min-w-0 shrink-0 snap-start overflow-hidden rounded-xl border bg-surface shadow-sm ${project.id === selected?.projectId ? "border-brand/55" : "border-border"} basis-[calc(100%-0.5rem)] sm:basis-[28rem] lg:basis-[31rem]`} initial={reduceMotion ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2, delay: reduceMotion ? 0 : Math.min(index * 0.035, 0.14) }}><div className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5"><span className="min-w-0"><strong className="block truncate">{project.name}</strong><span className="mt-1 block truncate text-xs text-foreground-muted">{project.code} · {project.companyName}</span></span><span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground-muted">{batches.length} lote(s)</span></div><div className="p-3 sm:p-4">{batches.length ? <div className={`space-y-2 overflow-y-auto overscroll-contain ${batches.length > 3 ? "max-h-[14rem] pr-1 [scrollbar-gutter:stable]" : ""}`}>{batches.map((batch) => <BatchOption key={batch.id} batch={batch} selected={batch.id === selected?.batchId && project.id === selected.projectId} pending={detailLoading && batch.id === selected?.batchId && project.id === selected.projectId} onSelect={() => selectBatch(project.id, batch.id)} />)}</div> : <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-foreground-muted">No existen lotes para este proyecto.</p>}</div></motion.article>)}
      </div>
      {!hasResults && (normalizedSearch || projectFilter !== "ALL" || statusFilter !== "ALL") && <EmptyState icon={FolderKanban} title="Sin resultados" description="No existen lotes que coincidan con los filtros seleccionados." />}
    </MotionSection>

    <div ref={detailRef} className="scroll-mt-20" aria-live="polite">
    <AnimatePresence mode="wait" initial={false}>
      {detailLoading && !selectedDetail ? <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><MotionSection className="grid min-h-48 place-items-center rounded-xl border border-border bg-surface px-4"><span className="flex items-center gap-2 text-sm text-foreground-muted"><LoaderCircle className="size-5 animate-spin" /> Cargando detalle del lote…</span></MotionSection></motion.div> : detailError ? <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><MotionSection><EmptyState icon={FolderKanban} title="No fue posible cargar el lote" description={detailError} /></MotionSection></motion.div> : selectedDetail && selectedEntry && permissions ? <motion.div key={selectedDetail.id} initial={false}><section className="rounded-xl border border-border bg-surface p-3 sm:p-5"><BatchDetailView detail={selectedDetail} project={selectedEntry.project} permissions={permissions} embedded loadSecondary={loadSecondary} onDataChanged={refreshSelected} /></section></motion.div> : <motion.div key="empty-detail" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}><MotionSection><EmptyState icon={FolderKanban} title="Selecciona un lote" description="Los despachos y acciones del lote elegido aparecerán aquí, dentro de la misma página." /></MotionSection></motion.div>}
    </AnimatePresence>
    </div>
  </MotionPage>;
}
