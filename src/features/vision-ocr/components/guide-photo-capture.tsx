"use client";

import { Camera, FileImage, FileText, LoaderCircle, RotateCw, ScanLine } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { automaticGuideCrop, automaticGuideOrientation, FULL_GUIDE_CROP, prepareGuideImage, rotatedGuideImage, validGuideCrop, type GuideCrop, type PreparedGuideImage } from "../image-preparation";
import type { GuideOcrDraft } from "../guide-draft";
import { GuideImagePreview } from "./guide-image-preview";
import { GuidePagePicker } from "./guide-page-picker";
import { countGuidePdfPages, GUIDE_BATCH_MAX_BYTES, GUIDE_QUEUE_LIMIT, guideSourceLabel, renderGuidePdfPage, validateGuideSource, type GuideSource } from "../guide-sources";

export type GuidePhotoResult = {
  captureId: string; draft: GuideOcrDraft; rawText: string; imageRotation?: number;
  project: { name: string; code: string; address: string; additionalAddresses: string[] };
};
export function guideCaptureUrl(projectId: string, dispatchId: string) {
  return `/api/vision-ocr/guides?projectId=${encodeURIComponent(projectId)}&dispatchId=${encodeURIComponent(dispatchId)}`;
}
async function readResponse(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw Error(payload.error || "No se pudo procesar la fotografía.");
  return payload;
}

export type GuidePhotoCaptureHandle = { saved: () => void; focusPending: () => boolean };
export const GuidePhotoCapture = forwardRef<GuidePhotoCaptureHandle, {
  projectId: string; dispatchId: string; disabled: boolean;
  onRead: (result: GuidePhotoResult) => void; onReset: (usingPhoto: boolean) => void; onBusy: (busy: boolean) => void;
}>(function GuidePhotoCapture({ projectId, dispatchId, disabled, onRead, onReset, onBusy }, ref) {
  const fileInput = useRef<HTMLInputElement>(null), cameraInput = useRef<HTMLInputElement>(null), pdfInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null), captureRef = useRef<string | null>(null);
  const automaticTurns = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dragRef = useRef<number | null>(null), selection = useRef(0);
  const callbacks = useRef({ onReset, onBusy });
  useEffect(() => { callbacks.current = { onReset, onBusy }; }, [onReset, onBusy]);
  const [sources, setSources] = useState<GuideSource[]>([]);
  const [pageChoices, setPageChoices] = useState<GuideSource[]>([]);
  const [savedCount, setSavedCount] = useState(0), [skippedCount, setSkippedCount] = useState(0);
  const current = sources[0];
  const [file, setFile] = useState<File | null>(null);
  const [turns, setTurns] = useState(0), [sourceUrl, setSourceUrl] = useState("");
  const [crop, setCrop] = useState<GuideCrop>(FULL_GUIDE_CROP);
  const [cropMode, setCropMode] = useState<"automatic" | "full" | "manual">("full");
  const [prepared, setPrepared] = useState<PreparedGuideImage | null>(null);
  const [acceptQuality, setAcceptQuality] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [stage, setStage] = useState("");
  const [read, setRead] = useState(false);
  const url = guideCaptureUrl(projectId, dispatchId);
  const working = disabled || busy;
  useEffect(() => () => { selection.current++; }, []);
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.preview); }, [prepared]);
  const discard = async () => {
    if (captureRef.current) await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ captureId: captureRef.current }) }).catch(() => undefined);
    captureRef.current = null;
  };
  const resetImage = () => {
    canvasRef.current = null; setFile(null); setSourceUrl(""); setTurns(0); setCrop(FULL_GUIDE_CROP);
    setPrepared(null); setCropMode("full"); setAcceptQuality(false); setRead(false); setError(""); setStage("");
  };
  useImperativeHandle(ref, () => ({ saved() {
    // Called only after guide + evidence succeeded, including an idempotent
    // retry. Never discard the saved capture or advance on a failed save.
    captureRef.current = null; resetImage();
    setSavedCount((count) => count + 1); setSources((items) => items.slice(1));
    onReset(sources.length > 1);
  }, focusPending() {
    if (!current) return false;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "start" });
    return true;
  } }));
  useEffect(() => {
    if (!current) return;
    const token = ++selection.current;
    let cancelled = false;
    const load = async () => {
      callbacks.current.onReset(true); setBusy(true); callbacks.current.onBusy(true);
      setStage(current.pageNumber ? `Abriendo página ${current.pageNumber} de ${current.totalPages}…` : "Abriendo foto…");
      try {
        const image = current.pageNumber ? await renderGuidePdfPage(current) : current.file;
        if (!cancelled && token === selection.current) setFile(image);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo abrir la página. Puedes omitirla.");
      } finally {
        if (!cancelled) { setBusy(false); callbacks.current.onBusy(false); setStage(""); }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [current]);
  useEffect(() => {
    if (!file) return;
    let active = true;
    let objectUrl: string | null = null;
    setBusy(true); callbacks.current.onBusy(true); setStage("Acomodando imagen automáticamente…");
    void (async () => {
      let canvas = await rotatedGuideImage(file, 0);
      automaticTurns.current = automaticGuideOrientation(canvas);
      const appliedTurns = (automaticTurns.current + turns) % 4;
      if (appliedTurns) canvas = await rotatedGuideImage(file, appliedTurns);
      if (!active) return;
      // Let the progress indicator paint before local pixel analysis.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!active) return;
      const boundary = automaticGuideCrop(canvas);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(Error("No se pudo abrir la foto.")), "image/jpeg", 0.9));
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); canvasRef.current = canvas; setSourceUrl(objectUrl);
      setCrop(boundary.crop); setCropMode(boundary.detected ? "automatic" : "full");
      // Explicit manual rotation keeps the corner editor open. Normal intake
      // goes straight to the corrected preview; no mandatory crop click.
      if (turns === 0) {
        const ready = await prepareGuideImage(canvas, boundary.crop, "auto");
        if (active) setPrepared(ready); else URL.revokeObjectURL(ready.preview);
      }
    })().catch(() => { if (active) setError("No se pudo preparar la foto. Usa JPG, PNG o WEBP e intenta de nuevo."); })
      .finally(() => { if (active) { setBusy(false); callbacks.current.onBusy(false); setStage(""); } });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, turns]);

  const addFiles = async (files: File[], pdf = false) => {
    if (!files.length || working) return;
    setBusy(true); onBusy(true); setError(""); setStage(pdf ? "Revisando páginas del PDF…" : "Revisando fotos…");
    const token = selection.current;
    try {
      if (files.length + sources.length > GUIDE_QUEUE_LIMIT) throw Error(`Puedes tener hasta ${GUIDE_QUEUE_LIMIT} fotos o páginas pendientes.`);
      const uniqueFiles = new Set([...sources.map((source) => source.file), ...files]);
      if ([...uniqueFiles].reduce((sum, source) => sum + source.size, 0) > GUIDE_BATCH_MAX_BYTES) throw Error("La carga supera 100 MiB. Agrega un grupo más pequeño.");
      const added: GuideSource[] = [];
      for (const selected of files) {
        const validation = validateGuideSource(selected, pdf);
        if (validation) throw Error(`${selected.name}: ${validation}`);
        const pages = pdf ? await countGuidePdfPages(selected) : 1;
        for (let page = 1; page <= pages; page++) added.push({ id: crypto.randomUUID(), file: selected, ...(pdf ? { pageNumber: page, totalPages: pages } : {}) });
        if (sources.length + added.length > GUIDE_QUEUE_LIMIT) throw Error(`Puedes tener hasta ${GUIDE_QUEUE_LIMIT} fotos o páginas pendientes. Divide el PDF o la selección.`);
      }
      if (selection.current !== token) return;
      if (!sources.length) { resetImage(); onReset(true); }
      if (pdf) setPageChoices(added);
      else setSources((items) => [...items, ...added]);
    } catch (cause) { if (selection.current === token) setError(cause instanceof Error ? cause.message : "No se pudo agregar la carga."); }
    finally { if (selection.current === token) { setBusy(false); onBusy(false); setStage(""); } }
  };
  const skip = async (all = false) => {
    if (working) return;
    setBusy(true); onBusy(true);
    try {
      await discard(); selection.current++; resetImage();
      setSkippedCount((count) => count + (all ? sources.length : 1));
      setSources((items) => all ? [] : items.slice(1)); onReset(!all && sources.length > 1);
    } finally { setBusy(false); onBusy(false); }
  };
  const changeCrop = (index: number, x: number, y: number) => {
    setCrop((current) => current.map((point, i) => i === index ? { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : point) as GuideCrop);
    setCropMode("manual"); setPrepared(null); setAcceptQuality(false);
  };
  const preview = async () => {
    if (!canvasRef.current || working) return;
    setBusy(true); onBusy(true); setError(""); setStage("Preparando imagen…");
    try {
      // Let the spinner paint before the bounded pixel processing starts.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      setPrepared(await prepareGuideImage(canvasRef.current, crop, "auto")); setAcceptQuality(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo preparar la foto."); }
    finally { setBusy(false); onBusy(false); setStage(""); }
  };
  const extract = async () => {
    if (!file || !prepared || working || (prepared.quality.warnings.length > 0 && !acceptQuality)) return;
    setBusy(true); onBusy(true); setError("");
    try {
      if (!captureRef.current) {
        setStage("Guardando foto original en DEV…");
        const target = await readResponse(await fetch(`${url}&action=prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, mimeType: file.type, size: file.size }) }));
        captureRef.current = target.captureId;
        const uploaded = await createClient().storage.from(target.bucket).uploadToSignedUrl(target.path, target.token, file, { contentType: file.type, upsert: false });
        if (uploaded.error) { await discard(); throw Error("No se pudo cargar la foto original. Intenta de nuevo."); }
      }
      setStage("Leyendo con Google Vision…");
      const data = new FormData(); data.set("captureId", captureRef.current!); data.set("image", prepared.file); data.set("manual", "false");
      data.set("adjustments", JSON.stringify({ turns: (automaticTurns.current + turns) % 4, crop, cropMode, enhance: prepared.enhanced, preparationVersion: "automatic-v2", quality: prepared.quality, parserVersion: "mixto-v3", ...(current?.pageNumber ? { pdf: { fileName: current.file.name.slice(0, 200), pageNumber: current.pageNumber, totalPages: current.totalPages } } : {}) }));
      const result = await readResponse(await fetch(url, { method: "POST", body: data })) as GuidePhotoResult;
      // Vision already read sideways/upside-down text. Rotate the review photo
      // using that same result, keeping the exact OCR input/hash unchanged.
      if (result.imageRotation && [1, 2, 3].includes(result.imageRotation)) {
        try {
          const upright = await rotatedGuideImage(prepared.file, result.imageRotation);
          const blob = await new Promise<Blob | null>((resolve) => upright.toBlob(resolve, "image/jpeg", .9));
          if (blob) setPrepared({ ...prepared, preview: URL.createObjectURL(blob) });
        } catch { /* A preview failure must never discard a successful OCR read. */ }
      }
      onRead(result); setRead(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo leer la guía."); }
    finally { setBusy(false); onBusy(false); setStage(""); }
  };
  return <section className="min-w-0 space-y-3 rounded-xl border border-border bg-muted/20 p-3 sm:p-4" aria-labelledby="guide-photo-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 ref={headingRef} tabIndex={-1} id="guide-photo-heading" className="font-semibold">Cargar guías con OCR · DEV</h3><p className="mt-1 text-xs text-foreground-muted">Revisa y guarda una guía por vez, con todos sus productos y servicios.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={working || pageChoices.length > 0 || Boolean(current)} onClick={() => cameraInput.current?.click()}><Camera className="size-4" />Tomar foto</Button><Button variant="secondary" disabled={working || pageChoices.length > 0 || Boolean(current)} onClick={() => fileInput.current?.click()}><FileImage className="size-4" />Subir fotos</Button><Button variant="secondary" disabled={working || pageChoices.length > 0 || Boolean(current)} onClick={() => pdfInput.current?.click()}><FileText className="size-4" />Subir PDF</Button></div>
    </div>
    <details className="text-xs text-foreground-muted"><summary className="cursor-pointer py-2">Formatos y límites</summary><p>Hasta 20 fotos o páginas pendientes. Fotos JPG, PNG o WEBP de hasta 10 MiB; PDF de hasta 20 MiB y 20 páginas, con una guía por página. Se conserva la foto original o cada página completa como imagen de evidencia al guardar. Los formatos Pedido / Control de operación de Mixto Listo y Panexus quedan pendientes.</p></details>
    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Elegir foto de guía" disabled={working} onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <input ref={pdfInput} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="Elegir PDF de guías" disabled={working} onChange={(event) => { void addFiles(Array.from(event.target.files ?? []), true); event.target.value = ""; }} />
    <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" aria-label="Tomar foto de guía" disabled={working} onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    {(pageChoices.length > 0 || current) && <ol className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" aria-label="Pasos de carga de guías">
      {["Seleccionar", "Preparar imagen", "Procesar", "Revisar"].map((label, index) => {
        const step = pageChoices.length ? 0 : read ? 3 : prepared ? 2 : 1;
        return <li key={label} aria-current={index === step ? "step" : undefined} className={`rounded-lg border px-3 py-2 ${index === step ? "border-brand bg-brand-soft font-semibold text-brand-strong" : "border-border text-foreground-muted"}`}>{index + 1}. {label}</li>;
      })}
    </ol>}
    {pageChoices.length > 0 && <GuidePagePicker sources={pageChoices} disabled={working} onAccept={(selected) => {
      setSources((items) => [...items, ...selected]); setPageChoices([]);
    }} onCancel={() => { setPageChoices([]); if (!current) onReset(false); }} />}
    {(savedCount > 0 || skippedCount > 0) && <p role="status" className="text-sm text-foreground-muted">{savedCount} guardada(s) · {skippedCount} omitida(s) · {sources.length} pendiente(s)</p>}
    {current && pageChoices.length === 0 && <div className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-3">
      <p className="break-words text-sm font-semibold" role="status">Revisando: {guideSourceLabel(current)}</p>
      <p className="text-xs leading-5 text-foreground-muted">{sources.length} guía(s) en cola. Acepta la imagen, revisa sus datos y guarda para pasar a la siguiente.</p>
      {sources.length > 1 && <details><summary className="cursor-pointer text-sm">Ver cola ({sources.length})</summary><ol className="mt-2 max-h-40 list-inside list-decimal space-y-1 overflow-y-auto text-xs text-foreground-muted" aria-label="Cola de guías">{sources.map((source) => <li key={source.id} className="break-words">{guideSourceLabel(source)}</li>)}</ol></details>}
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={working} onClick={() => void skip()}>Omitir esta {current.pageNumber ? "página" : "foto"}</Button><Button variant="ghost" disabled={working} onClick={() => void skip(true)}>Descartar cola y volver a formulario vacío</Button></div>
    </div>}
    {sourceUrl && !prepared && !read && !pageChoices.length && <>
      <p className="text-xs text-foreground-muted">Gira hasta que las letras queden derechas. Mueve las cuatro esquinas para incluir solo esta guía; puedes usar las flechas del teclado.</p>
      <div className="mx-auto w-fit max-w-full">
        <div className="relative overflow-hidden rounded-lg border border-border bg-black" onPointerMove={(event) => {
          if (dragRef.current === null || working) return;
          const rect = event.currentTarget.getBoundingClientRect(); changeCrop(dragRef.current, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
        }} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
          {/* A local blob preview must keep its original aspect ratio. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sourceUrl} alt="Guía a recortar" className="block max-h-[55dvh] w-auto max-w-full select-none object-contain" draggable={false} />
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={crop.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} fill="rgba(255,255,255,0.08)" stroke={validGuideCrop(crop) ? "var(--success)" : "#ef4444"} strokeWidth="0.6" /></svg>
          {crop.map((p, i) => <button key={i} type="button" disabled={working} aria-label={`Esquina ${["superior izquierda", "superior derecha", "inferior derecha", "inferior izquierda"][i]}`}
            className="absolute z-10 grid size-10 touch-none -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-success text-xs font-bold text-white shadow focus-visible:outline-2 focus-visible:outline-white"
            style={{ left: `clamp(20px, ${p.x * 100}%, calc(100% - 20px))`, top: `clamp(20px, ${p.y * 100}%, calc(100% - 20px))` }}
            onPointerDown={(event) => { event.preventDefault(); dragRef.current = i; event.currentTarget.parentElement?.setPointerCapture(event.pointerId); }}
            onKeyDown={(event) => { const moves: Record<string, [number, number]> = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] }; const move = moves[event.key]; if (move) { event.preventDefault(); changeCrop(i, p.x + move[0], p.y + move[1]); } }}>{i + 1}</button>)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={working} onClick={() => { canvasRef.current = null; setSourceUrl(""); setTurns((n) => n + 1); setCrop(FULL_GUIDE_CROP); setPrepared(null); }}><RotateCw className="size-4" />Girar 90°</Button><Button variant="secondary" disabled={working} onClick={() => { setCrop(FULL_GUIDE_CROP); setCropMode("manual"); setPrepared(null); }}>Usar foto completa</Button></div>
      <Button variant="secondary" disabled={working || !validGuideCrop(crop)} onClick={() => void preview()}>Aplicar ajustes</Button>
    </>}
    {prepared && !read && !pageChoices.length && <p role="status" className="text-xs text-foreground-muted">{cropMode === "automatic" ? "Recorte y perspectiva preparados automáticamente." : cropMode === "manual" ? "Ajustes aplicados." : "Se conservó la foto completa al no detectar un borde seguro."} Puedes ajustar la imagen si hace falta.</p>}
    {prepared && !pageChoices.length && <details className="min-w-0 rounded-lg border border-border p-3" open={!read}>
      <summary className="cursor-pointer text-sm font-semibold">{read ? "Ver foto procesada y ampliar" : "Comprueba la foto que se leerá"}</summary>
      <GuideImagePreview key={prepared.preview} src={prepared.preview} alt="Recorte de la guía, con perspectiva corregida" />
    </details>}
    {prepared && !read && !pageChoices.length && <>
      {prepared.quality.warnings.length > 0 && <div role="alert" className="space-y-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-950"><ul className="list-inside list-disc">{prepared.quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={acceptQuality} disabled={working} onChange={(event) => setAcceptQuality(event.target.checked)} />Revisé la foto y deseo continuar con esta calidad.</label></div>}
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={working} onClick={() => { setPrepared(null); setAcceptQuality(false); }}>Ajustar imagen</Button><Button disabled={working || (prepared.quality.warnings.length > 0 && !acceptQuality)} onClick={() => void extract()}><ScanLine className="size-4" />Aceptar foto y extraer datos</Button></div>
    </>}
    {stage && <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" />{stage}</p>}
    {read && <p role="status" className="text-sm text-success">Lectura lista. Revisa la guía, corrige los campos y confirma antes de guardar.</p>}
    {error && <p role="alert" className="break-words rounded-lg bg-destructive-soft p-3 text-sm text-destructive">{error}</p>}
  </section>;
});
