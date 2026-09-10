"use client";

import { Building2, FileText, Globe2, Package, Trash2, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { MotionPage } from "@/components/motion/motion-page";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";

import type { UniversalCommitResult, UniversalInvoiceResult } from "../types";

type Entry = {
  id: string;
  file: File;
  phase: "SELECTED" | "CLASSIFYING" | "CLASSIFIED" | "SAVING" | "SAVED";
  result: UniversalInvoiceResult | UniversalCommitResult | null;
  projectId: string;
  dispatchId: string;
};

const MAX_FILES = 100;
const MAX_BYTES = 10 * 1024 * 1024;
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.NEXT_PUBLIC_UNIVERSAL_INVOICE_CONCURRENCY ?? 3)));

const toneByStatus: Record<string, BadgeTone> = {
  READY: "success",
  READY_WITH_DIFFERENCES: "warning",
  PROJECT_AMBIGUOUS: "warning",
  DISPATCH_AMBIGUOUS: "warning",
  DUPLICATE: "info",
  NO_ACTIVE_BATCH: "warning",
  SAVED: "success",
};

const labelByStatus: Record<string, string> = {
  READY: "Lista",
  READY_WITH_DIFFERENCES: "Con observaciones",
  PROJECT_NOT_FOUND: "Proyecto no encontrado",
  PROJECT_AMBIGUOUS: "Proyecto ambiguo",
  DISPATCH_NOT_FOUND: "Despacho no encontrado",
  DISPATCH_AMBIGUOUS: "Despacho ambiguo",
  NO_ACTIVE_BATCH: "Sin lote activo",
  UNKNOWN_TYPE: "Tipo desconocido",
  INVALID_FILE: "Archivo inválido",
  DUPLICATE: "Duplicada",
  ERROR: "Error",
  SAVED: "Procesada",
};

function sizeLabel(size: number) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

async function runPool<T>(items: T[], task: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const current = items[cursor];
      cursor += 1;
      await task(current);
    }
  }));
}

async function requestResult(
  endpoint: "classify" | "commit",
  entry: Entry,
): Promise<UniversalInvoiceResult | UniversalCommitResult> {
  const form = new FormData();
  form.set("file", entry.file);
  if (entry.projectId) form.set("projectId", entry.projectId);
  if (entry.dispatchId) form.set("dispatchId", entry.dispatchId);
  const response = await fetch(`/api/invoices/universal/${endpoint}`, { method: "POST", body: form });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || "No fue posible procesar el archivo.");
  return body;
}

function EntryCard({ entry, onChange, onRemove }: {
  entry: Entry;
  onChange: (entry: Entry) => void;
  onRemove: () => void;
}) {
  const pending = entry.phase === "CLASSIFYING" || entry.phase === "SAVING";
  const status = entry.phase === "SAVED" ? "SAVED" : entry.result?.status;
  return (
    <motion.article layout className="rounded-xl border border-border bg-surface p-3.5 sm:p-4" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong"><FileText className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 break-all text-sm font-semibold">{entry.file.name}</p>
            {status && <Badge tone={toneByStatus[status] ?? "danger"}>{labelByStatus[status] ?? status}</Badge>}
          </div>
          <p className="mt-1 text-xs text-foreground-muted">{sizeLabel(entry.file.size)}{entry.result?.invoiceNumber ? ` · Factura ${entry.result.invoiceNumber}` : ""}{entry.result?.detectedType && entry.result.detectedType !== "UNKNOWN" ? ` · ${entry.result.detectedType === "PRODUCT" ? "Producto" : "Servicio"}` : ""}</p>
          {entry.result?.message && <p className="mt-2 text-xs text-foreground-muted">{entry.result.message}</p>}
          {entry.result?.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-warning">{warning}</p>)}
          {entry.result?.status === "PROJECT_AMBIGUOUS" && (
            <label className="mt-3 block text-xs font-medium">Proyecto
              <select className="form-input mt-1" value={entry.projectId} onChange={(event) => onChange({ ...entry, projectId: event.target.value, dispatchId: "" })}>
                <option value="">Seleccionar proyecto</option>
                {entry.result.candidateProjects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
              </select>
            </label>
          )}
          {entry.result?.status === "DISPATCH_AMBIGUOUS" && entry.result.candidateDispatches.length > 0 && (
            <label className="mt-3 block text-xs font-medium">Despacho
              <select className="form-input mt-1" value={entry.dispatchId} onChange={(event) => onChange({ ...entry, dispatchId: event.target.value })}>
                <option value="">Seleccionar despacho</option>
                {entry.result.candidateDispatches.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
              </select>
            </label>
          )}
        </div>
        <button type="button" onClick={onRemove} disabled={pending} className="icon-button shrink-0" aria-label={`Quitar ${entry.file.name}`}><Trash2 className="size-4" /></button>
      </div>
    </motion.article>
  );
}

export function UniversalInvoicesWorkspace({ authorizedProjects }: { authorizedProjects: Array<{ id: string; code: string; name: string }> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const busy = entries.some((entry) => entry.phase === "CLASSIFYING" || entry.phase === "SAVING");
  const ready = entries.filter((entry) => entry.result && ["READY", "READY_WITH_DIFFERENCES"].includes(entry.result.status));
  const needsResolution = entries.filter((entry) =>
    (entry.result?.status === "PROJECT_AMBIGUOUS" && entry.projectId) ||
    (entry.result?.status === "DISPATCH_AMBIGUOUS" && entry.dispatchId),
  );

  const projectGroups = useMemo(() => {
    const map = new Map<string, {
      label: string;
      resolved: boolean;
      orders: Map<string, { label: string; entries: Entry[] }>;
    }>();
    for (const entry of entries) {
      const projectResolved = Boolean(entry.result?.projectLabel);
      const projectKey = entry.result?.projectId
        ? `project:${entry.result.projectId}`
        : entry.result?.projectLabel
          ? `project-label:${entry.result.projectLabel}`
          : "pending";
      const project = map.get(projectKey) ?? {
        label: entry.result?.projectLabel ?? "Pendientes de clasificación",
        resolved: projectResolved,
        orders: new Map<string, { label: string; entries: Entry[] }>(),
      };
      const orderKey = entry.result?.orderNumber
        ? `order:${entry.result.orderNumber}`
        : entry.result?.dispatchId
          ? `dispatch:${entry.result.dispatchId}`
          : "unresolved";
      const order = project.orders.get(orderKey) ?? {
        label: entry.result?.orderNumber
          ? `Pedido ${entry.result.orderNumber}`
          : entry.result?.dispatchLabel ?? (projectResolved ? "Sin pedido identificado" : "Archivos"),
        entries: [],
      };
      order.entries.push(entry);
      project.orders.set(orderKey, order);
      map.set(projectKey, project);
    }
    return [...map.entries()].map(([key, project]) => ({
      key,
      label: project.label,
      resolved: project.resolved,
      orders: [...project.orders.entries()].map(([orderKey, order]) => ({ key: orderKey, ...order })),
    }));
  }, [entries]);

  const addFiles = (files: File[]) => {
    const available = Math.max(0, MAX_FILES - entries.length);
    const selected = files.slice(0, available);
    setEntries((current) => [...current, ...selected.map((file) => ({ id: crypto.randomUUID(), file, phase: "SELECTED" as const, result: null, projectId: "", dispatchId: "" }))]);
    if (files.length > available) notify.warning("Límite alcanzado", `Máximo ${MAX_FILES} PDFs por carga.`);
  };

  const classify = async (targets = entries.filter((entry) => entry.phase !== "SAVED")) => {
    if (!targets.length) return;
    await runPool(targets, async (target) => {
      setEntries((current) => current.map((entry) => entry.id === target.id ? { ...entry, phase: "CLASSIFYING" } : entry));
      try {
        const latest = entries.find((entry) => entry.id === target.id) ?? target;
        const result = await requestResult("classify", latest);
        setEntries((current) => current.map((entry) => entry.id === target.id ? { ...entry, phase: "CLASSIFIED", result, projectId: result.projectId ?? entry.projectId, dispatchId: result.dispatchId ?? entry.dispatchId } : entry));
      } catch (error) {
        const message = error instanceof Error ? error.message : "No fue posible clasificar el archivo.";
        setEntries((current) => current.map((entry) => entry.id === target.id ? { ...entry, phase: "CLASSIFIED", result: { status: "ERROR", message, fileName: entry.file.name, fileSize: entry.file.size, detectedType: "UNKNOWN", invoiceNumber: null, orderNumber: null, projectId: null, projectLabel: null, dispatchId: null, dispatchLabel: null, batchId: null, batchLabel: null, candidateProjects: [], candidateDispatches: [], warnings: [] } } : entry));
      }
    });
  };

  const resolveSelections = async () => classify(needsResolution);

  const commit = async () => {
    const targets = entries.filter((entry) => entry.result && ["READY", "READY_WITH_DIFFERENCES"].includes(entry.result.status));
    await runPool(targets, async (target) => {
      setEntries((current) => current.map((entry) => entry.id === target.id ? { ...entry, phase: "SAVING" } : entry));
      try {
        const result = await requestResult("commit", target) as UniversalCommitResult;
        setEntries((current) => current.map((entry) => entry.id === target.id ? { ...entry, phase: result.saved ? "SAVED" : "CLASSIFIED", result } : entry));
      } catch (error) {
        notify.error("Error al procesar", error instanceof Error ? error.message : "Intenta nuevamente.");
        setEntries((current) => current.map((entry) => entry.id === target.id ? { ...entry, phase: "CLASSIFIED" } : entry));
      }
    });
    notify.success("Proceso finalizado", "Revisa el resultado por archivo.");
  };

  return (
    <MotionPage className="mx-auto max-w-[1500px] space-y-5 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">Gestión multi‑proyecto</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">Facturas Universal</h1><p className="mt-2 max-w-3xl text-sm text-foreground-muted">Clasifica PDFs por dirección, proyecto, pedido y despacho. Producto se concilia; Servicio se conserva como documento independiente.</p></div>
        <Badge tone="info">{authorizedProjects.length} proyecto(s) autorizado(s)</Badge>
      </header>

      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="sr-only" onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
        <motion.button type="button" disabled={busy || entries.length >= MAX_FILES} onClick={() => inputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragActive(false)} onDrop={(event) => { event.preventDefault(); setDragActive(false); addFiles(Array.from(event.dataTransfer.files).filter((file) => file.size <= MAX_BYTES)); }} animate={{ scale: dragActive ? 1.004 : 1 }} className={`flex min-h-40 w-full flex-col items-center justify-center rounded-xl border border-dashed px-4 text-center transition-colors ${dragActive ? "border-brand bg-brand-soft/50" : "border-border bg-muted/20 hover:border-brand/50 hover:bg-brand-soft/25"}`}>
          <Upload className="size-7 text-brand-strong" /><span className="mt-3 text-sm font-semibold">Selecciona o arrastra tus facturas PDF</span><span className="mt-1 text-xs text-foreground-muted">Hasta {MAX_FILES} archivos · 10 MiB por PDF · concurrencia {CONCURRENCY}</span>
        </motion.button>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {entries.length > 0 && <Button variant="ghost" onClick={() => setEntries([])} disabled={busy}><X className="size-4" /> Limpiar</Button>}
          {needsResolution.length > 0 && <LoadingButton type="button" variant="secondary" loading={busy} onClick={resolveSelections} loadingLabel="Resolviendo…"><Globe2 className="size-4" /> Resolver selección</LoadingButton>}
          <LoadingButton type="button" variant="secondary" loading={busy} disabled={!entries.length} onClick={() => classify()} loadingLabel="Clasificando…">Clasificar facturas</LoadingButton>
          <LoadingButton type="button" loading={busy} disabled={!ready.length} onClick={commit} loadingLabel="Conciliando…">Conciliar ({ready.length})</LoadingButton>
        </div>
      </section>

      <AnimatePresence initial={false}>
        {projectGroups.map((project) => {
          const fileCount = project.orders.reduce((total, order) => total + order.entries.length, 0);
          return (
            <motion.section layout key={project.key} className="overflow-hidden rounded-xl border border-border bg-surface" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="flex flex-col gap-2 border-b border-border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">
                    {project.resolved ? <Building2 className="size-4.5" /> : <FileText className="size-4.5" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-foreground-muted">{project.resolved ? "Proyecto" : "Por organizar"}</p>
                    <h2 className="truncate text-sm font-semibold sm:text-base">{project.label}</h2>
                  </div>
                </div>
                <Badge tone="info">{project.resolved
                  ? countLabel(project.orders.length, "pedido", "pedidos")
                  : countLabel(fileCount, "archivo", "archivos")}</Badge>
              </div>

              <div className="space-y-3 bg-muted/20 p-3 sm:p-4">
                {project.orders.map((order) => (
                  <section key={order.key} className="overflow-hidden rounded-xl border border-border bg-muted/25">
                    <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-3.5 py-2.5 sm:px-4">
                      <div className="flex min-w-0 items-center gap-2">
                        {project.resolved
                          ? <Package className="size-4 shrink-0 text-brand-strong" />
                          : <FileText className="size-4 shrink-0 text-brand-strong" />}
                        <h3 className="truncate text-sm font-semibold">{order.label}</h3>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-foreground-muted">{countLabel(order.entries.length, "factura", "facturas")}</span>
                    </div>
                    <div className="grid gap-3 p-3 lg:grid-cols-2">
                      {order.entries.map((entry) => (
                        <EntryCard
                          key={entry.id}
                          entry={entry}
                          onChange={(next) => setEntries((current) => current.map((item) => item.id === next.id ? next : item))}
                          onRemove={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </motion.section>
          );
        })}
      </AnimatePresence>
    </MotionPage>
  );
}
