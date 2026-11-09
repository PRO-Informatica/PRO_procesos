"use client";

import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { bulkGuideDraft } from "../bulk-guide-draft";
import { guideSourceLabel, renderGuidePdfPage, type GuideSource } from "../guide-sources";
import { automaticGuideCrop, automaticGuideOrientation, prepareGuideImage, rotatedGuideImage, type PreparedGuideImage } from "../image-preparation";
import { isVisionTemplateType, VISION_TEMPLATE_LABELS, type VisionTemplateType } from "../template-classifier";
import { GuideImagePreview } from "./guide-image-preview";
import type { GuidePhotoCaptureHandle, GuidePhotoResult } from "./guide-photo-capture";

type Entry = {
  source: GuideSource; captureId?: string; prepared?: PreparedGuideImage;
  adjustments?: Record<string, unknown>;
  reading?: GuidePhotoResult; type: VisionTemplateType;
  confirmed: boolean; qualityAccepted: boolean; skipped: boolean; saved: boolean; error: string;
};
type Phase = "scanning" | "classification" | "ready" | "review" | "complete";

async function responseData(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw Error(payload.error || "No se pudo leer esta página. Intenta de nuevo.");
  return payload;
}

export const GuideBulkScan = forwardRef<GuidePhotoCaptureHandle, {
  sources: GuideSource[]; url: string; disabled: boolean;
  onRead: (result: GuidePhotoResult) => void; onReset: (usingPhoto: boolean) => void;
  onBusy: (busy: boolean) => void; onDone: () => void;
}>(function GuideBulkScan({ sources, url, disabled, onRead, onReset, onBusy, onDone }, ref) {
  const [entries, setEntries] = useState<Entry[]>(() => sources.map((source) => ({ source, type: "DISPATCH_GUIDE", confirmed: false, qualityAccepted: false, skipped: false, saved: false, error: "" })));
  const entriesRef = useRef(entries);
  const [phase, setPhase] = useState<Phase>("scanning"), [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false), [stage, setStage] = useState("");
  const running = useRef(false), active = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const captures = useRef(new Set<string>()), previews = useRef(new Set<string>());
  const callbacks = useRef({ onRead, onReset, onBusy, onDone });
  useEffect(() => { callbacks.current = { onRead, onReset, onBusy, onDone }; }, [onRead, onReset, onBusy, onDone]);
  function update(position: number, patch: Partial<Entry>) {
    entriesRef.current = entriesRef.current.map((entry, i) => i === position ? { ...entry, ...patch } : entry);
    if (active.current) setEntries(entriesRef.current);
  }
  async function discard(id: string) {
    await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ captureId: id }) }).catch(() => undefined);
    captures.current.delete(id);
  }
  function checkActive() { if (!active.current) throw Error("Carga cerrada."); }
  async function readPage(position: number) {
    let entry = entriesRef.current[position];
    // Keep completed reads/capture IDs for retry. Each request is bounded to one
    // page, and the server also caches EXTRACTED captures after network failures.
    if (entry.reading || entry.skipped) return;
    let original: File | undefined;
    if (!entry.prepared || !entry.captureId) {
      setStage(`Preparando página ${position + 1} de ${sources.length}…`);
      original = await renderGuidePdfPage(entry.source); checkActive();
    }
    if (!entry.prepared) {
      let canvas = await rotatedGuideImage(original!, 0);
      try {
        const turns = automaticGuideOrientation(canvas);
        if (turns) { canvas.width = canvas.height = 0; canvas = await rotatedGuideImage(original!, turns); }
        checkActive();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        checkActive();
        const boundary = automaticGuideCrop(canvas);
        const prepared = await prepareGuideImage(canvas, boundary.crop, "auto");
        previews.current.add(prepared.preview);
        checkActive();
        update(position, { prepared, adjustments: { turns, crop: boundary.crop, cropMode: boundary.detected ? "automatic" : "full", enhance: prepared.enhanced, quality: prepared.quality } });
      } finally { canvas.width = canvas.height = 0; }
    }
    entry = entriesRef.current[position];
    if (!entry.captureId) {
      const target = await responseData(await fetch(`${url}&action=prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: original!.name, mimeType: original!.type, size: original!.size }) }));
      captures.current.add(target.captureId);
      if (!active.current) { await discard(target.captureId); checkActive(); }
      update(position, { captureId: target.captureId });
      try {
        const upload = await createClient().storage.from(target.bucket).uploadToSignedUrl(target.path, target.token, original!, { contentType: original!.type, upsert: false });
        if (upload.error) throw upload.error;
      } catch {
        await discard(target.captureId); update(position, { captureId: undefined });
        throw Error("No se pudo cargar la página original. Reintenta esta página.");
      }
    }
    checkActive();
    entry = entriesRef.current[position];
    setStage(`Leyendo y clasificando página ${position + 1} de ${sources.length}…`);
    const data = new FormData();
    data.set("captureId", entry.captureId!); data.set("image", entry.prepared!.file); data.set("manual", "false");
    data.set("adjustments", JSON.stringify({ ...entry.adjustments, preparationVersion: "automatic-v2", parserVersion: "guides-controls-v3", bulk: true, pdf: { fileName: entry.source.file.name.slice(0, 200), pageNumber: entry.source.pageNumber, totalPages: entry.source.totalPages } }));
    const reading = await responseData(await fetch(url, { method: "POST", body: data })) as GuidePhotoResult;
    checkActive();
    // As in the individual flow, rotate only the display after Vision has read
    // the text. Preserve the input file/hash and the complete original evidence.
    if (reading.imageRotation && [1, 2, 3].includes(reading.imageRotation)) {
      let canvas: HTMLCanvasElement | undefined;
      try {
        canvas = await rotatedGuideImage(entry.prepared!.file, reading.imageRotation);
        const blob = await new Promise<Blob | null>((resolve) => canvas!.toBlob(resolve, "image/jpeg", .9));
        if (blob && active.current) {
          const preview = URL.createObjectURL(blob); previews.current.add(preview);
          update(position, { prepared: { ...entry.prepared!, preview } });
        }
      } catch { /* A preview failure must not repeat a successful OCR request. */ }
      finally { if (canvas) canvas.width = canvas.height = 0; }
    }
    checkActive();
    update(position, { reading, type: isVisionTemplateType(reading.draft.details.documentType) ? reading.draft.details.documentType : "DISPATCH_GUIDE", error: "" });
  }
  async function scan() {
    if (running.current || disabled) return;
    running.current = true; setBusy(true); setPhase("scanning"); callbacks.current.onBusy(true);
    try {
      for (let i = 0; i < sources.length; i++) {
        if (!active.current) break;
        setIndex(i);
        try { await readPage(i); }
        catch (cause) { if (active.current) update(i, { error: cause instanceof Error ? cause.message : "No se pudo leer esta página." }); }
      }
      if (active.current) { setIndex(Math.max(0, entriesRef.current.findIndex((entry) => !entry.skipped && !entry.confirmed))); setPhase("classification"); }
    } finally {
      running.current = false;
      if (active.current) { setBusy(false); setStage(""); callbacks.current.onBusy(false); }
      else { for (const id of captures.current) void discard(id); for (const preview of previews.current) URL.revokeObjectURL(preview); }
    }
  }
  useEffect(() => {
    active.current = true;
    // Deferring one tick avoids duplicate OCR requests under Strict Mode's
    // setup/cleanup replay. Never start a second runner while one is active.
    const timer = setTimeout(() => { void scan(); }, 0);
    const owned = captures.current, urls = previews.current;
    return () => {
      clearTimeout(timer); active.current = false;
      // An in-flight extraction must settle before discarding its capture.
      // The server deliberately protects captures while they are PROCESSING.
      if (!running.current) for (const id of owned) void discard(id);
      for (const preview of urls) URL.revokeObjectURL(preview);
    };
    // A batch has a fixed source list and endpoint for its mounted lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, url]);
  useEffect(() => {
    if (phase === "scanning") return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }, [phase, index]);
  useEffect(() => {
    if (phase !== "review") return;
    const entry = entriesRef.current[index];
    const draft = entry.reading && bulkGuideDraft(entry.reading, entry.type);
    if (draft) callbacks.current.onRead({ ...entry.reading!, draft });
  }, [phase, index]);
  useImperativeHandle(ref, () => ({ saved() {
    const entry = entriesRef.current[index];
    if (phase !== "review" || !entry || entry.saved) return;
    if (entry.captureId) captures.current.delete(entry.captureId);
    update(index, { saved: true });
    const next = entriesRef.current.findIndex((item) => item.confirmed && !item.skipped && !item.saved);
    callbacks.current.onReset(true);
    if (next < 0) setPhase("complete"); else setIndex(next);
  }, focusPending() {
    heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "start" }); return true;
  } }));
  const current = entries[index], working = busy || disabled;
  const confirmed = entries.filter((entry) => entry.confirmed && !entry.skipped).length;
  const failed = entries.filter((entry) => entry.error && !entry.skipped).length;
  const saved = entries.filter((entry) => entry.saved).length;
  const skipped = entries.filter((entry) => entry.skipped).length;
  function continueClassification() {
    const next = entriesRef.current.findIndex((entry, i) => i > index && !entry.skipped);
    const pending = entriesRef.current.findIndex((entry) => !entry.confirmed && !entry.skipped);
    if (next >= 0) setIndex(next); else if (pending >= 0) setIndex(pending); else setPhase("ready");
  }
  async function skip() {
    if (working) return;
    update(index, { skipped: true, error: "" });
    continueClassification();
    if (current.captureId) await discard(current.captureId);
  }
  const canAccept = current?.reading && bulkGuideDraft(current.reading, current.type) && (!current.prepared?.quality.warnings.length || current.qualityAccepted);
  return <section className="min-w-0 space-y-4 rounded-xl border border-border bg-surface p-3 sm:p-4" aria-labelledby="bulk-scan-heading">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h4 ref={heading} id="bulk-scan-heading" tabIndex={-1} className="font-semibold">Escaneo masivo</h4><p className="mt-1 break-words text-xs text-foreground-muted">{sources[0].file.name} · {entries.length} página(s)</p></div><span className="text-xs text-foreground-muted" aria-live="polite">{confirmed} clasificada(s) · {saved} guardada(s) · {skipped} omitida(s)</span></div>
    <ol className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3" aria-label="Pasos del escaneo masivo">{["Leer PDF", "Confirmar tipos", "Revisar y guardar"].map((label, i) => {
      const step = phase === "scanning" ? 0 : phase === "classification" || phase === "ready" ? 1 : 2;
      return <li key={label} aria-current={step === i ? "step" : undefined} className={`rounded-lg border px-3 py-2 ${step === i ? "border-brand bg-brand-soft font-semibold text-brand-strong" : "border-border text-foreground-muted"}`}>{i + 1}. {label}</li>;
    })}</ol>
    {phase === "scanning" && <div className="space-y-2" role="status"><p className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 shrink-0 animate-spin" />{stage || "Iniciando lectura del PDF…"}</p><progress aria-label="Páginas leídas" className="w-full" max={entries.length} value={entries.filter((entry) => entry.reading || entry.error || entry.skipped).length} /><p className="text-xs text-foreground-muted">Se lee cada página una vez. No se guarda ninguna guía durante este paso.</p></div>}
    {phase === "classification" && current && <>
      <p className="text-sm font-semibold" role="status">Confirmar tipo · Página {current.source.pageNumber} de {entries.length}</p>
      {current.prepared && <GuideImagePreview key={current.prepared.preview} src={current.prepared.preview} alt={`Página ${current.source.pageNumber} para clasificar`} />}
      {current.error && <p role="alert" className="break-words rounded-lg bg-destructive-soft p-3 text-sm text-destructive">{current.error}</p>}
      {current.reading && <div className="space-y-2"><label className="form-label" htmlFor="bulk-document-type">Tipo detectado · confirma o cambia la selección</label><select id="bulk-document-type" className="form-input" value={current.type} disabled={working} onChange={(event) => update(index, { type: event.target.value as VisionTemplateType, confirmed: false })}>{Object.entries(VISION_TEMPLATE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select>
        {!bulkGuideDraft(current.reading, current.type) && <p role="alert" className="text-sm text-destructive">No se obtuvo la lectura de este formato. Reintenta la página con la opción individual.</p>}
      </div>}
      {current.prepared && current.prepared.quality.warnings.length > 0 && <div className="space-y-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-950"><ul className="list-inside list-disc">{current.prepared.quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={working} checked={current.qualityAccepted} onChange={(event) => update(index, { qualityAccepted: event.target.checked })} />Revisé la foto y deseo continuar con esta calidad.</label></div>}
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={working || !entries.some((entry, i) => i < index && !entry.skipped)} onClick={() => setIndex(entries.map((entry, i) => !entry.skipped && i < index ? i : -1).filter((i) => i >= 0).at(-1)!)}><ChevronLeft className="size-4" />Anterior</Button><Button disabled={working || !canAccept} onClick={() => { update(index, { confirmed: true }); continueClassification(); }}>Aceptar tipo y continuar<ChevronRight className="size-4" /></Button><Button variant="ghost" disabled={working} onClick={() => void skip()}>Omitir página</Button></div>
    </>}
    {failed > 0 && phase === "classification" && <Button variant="secondary" disabled={working} onClick={() => void scan()}>Reintentar {failed} página(s) con error</Button>}
    {phase === "ready" && <div className="space-y-3"><p className="text-sm text-success" role="status">Clasificación terminada: {confirmed} guía(s) lista(s) para revisar.</p><p className="text-xs text-foreground-muted">Los datos ya se leyeron. Ahora se preparan los formularios con el tipo que confirmaste, sin repetir OCR. Revisa, corrige y guarda cada guía para avanzar.</p><ul className="max-h-48 space-y-2 overflow-y-auto text-xs" aria-label="Clasificación confirmada">{entries.filter((entry) => !entry.skipped).map((entry) => <li key={entry.source.id} className="break-words">Página {entry.source.pageNumber} · {VISION_TEMPLATE_LABELS[entry.type]}</li>)}</ul><div className="flex flex-wrap gap-2"><Button disabled={working || confirmed === 0} onClick={() => { setIndex(entries.findIndex((entry) => entry.confirmed && !entry.skipped)); setPhase("review"); }}>Revisar {confirmed} guía(s)</Button><Button variant="secondary" disabled={working || confirmed === 0} onClick={() => { setIndex(entries.findIndex((entry) => !entry.skipped)); setPhase("classification"); }}>Revisar clasificación</Button></div></div>}
    {phase === "review" && current && <div className="space-y-3"><p className="break-words text-sm font-semibold" role="status">Revisando guía {saved + 1} de {confirmed} · {guideSourceLabel(current.source)}</p><p className="text-sm">{VISION_TEMPLATE_LABELS[current.type]}</p><p className="text-xs text-foreground-muted">Revisa el formulario de abajo. Completa los datos del residente y guarda para pasar a la siguiente guía.</p>{current.prepared && <details className="min-w-0 rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">Ver foto de esta guía</summary><GuideImagePreview key={current.prepared.preview} src={current.prepared.preview} alt={`Foto de página ${current.source.pageNumber} en revisión`} /></details>}</div>}
    {phase === "complete" && <p role="status" className="text-sm text-success">Escaneo terminado. {saved} guía(s) y sus evidencias guardadas.</p>}
    {phase !== "scanning" && <Button variant="ghost" disabled={working} onClick={() => callbacks.current.onDone()}>{phase === "complete" ? "Terminar escaneo masivo" : "Descartar pendientes y salir del escaneo masivo"}</Button>}
  </section>;
});
