"use client";

import { Camera, FileImage, LoaderCircle, RotateCw, ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { FULL_GUIDE_CROP, prepareGuideImage, rotatedGuideImage, validGuideCrop, type GuideCrop, type ImageQuality } from "../image-preparation";
import type { GuideOcrDraft } from "../guide-draft";

export type GuidePhotoResult = {
  captureId: string; draft: GuideOcrDraft; rawText: string;
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

export function GuidePhotoCapture({ projectId, dispatchId, disabled, onRead, onReset, onBusy }: {
  projectId: string; dispatchId: string; disabled: boolean;
  onRead: (result: GuidePhotoResult) => void; onReset: (usingPhoto: boolean) => void; onBusy: (busy: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null), cameraInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null), captureRef = useRef<string | null>(null);
  const dragRef = useRef<number | null>(null), selection = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [turns, setTurns] = useState(0), [sourceUrl, setSourceUrl] = useState("");
  const [crop, setCrop] = useState<GuideCrop>(FULL_GUIDE_CROP), [enhance, setEnhance] = useState(false);
  const [prepared, setPrepared] = useState<{ file: File; quality: ImageQuality; preview: string } | null>(null);
  const [acceptQuality, setAcceptQuality] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [stage, setStage] = useState("");
  const [read, setRead] = useState(false);
  const url = guideCaptureUrl(projectId, dispatchId);
  const working = disabled || busy;
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.preview); }, [prepared]);
  const discard = async () => {
    if (captureRef.current) await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ captureId: captureRef.current }) }).catch(() => undefined);
    captureRef.current = null;
  };
  useEffect(() => {
    if (!file) return;
    let active = true;
    let objectUrl: string | null = null;
    void rotatedGuideImage(file, turns).then(async (canvas) => {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(Error("No se pudo abrir la foto.")), "image/jpeg", 0.9));
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); canvasRef.current = canvas; setSourceUrl(objectUrl);
    }).catch(() => { if (active) setError("No se pudo abrir la foto. Usa JPG, PNG o WEBP."); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, turns]);

  const selectFile = async (next?: File) => {
    if (!next || working) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(next.type) || next.size < 1 || next.size > 10 * 1024 * 1024) {
      setError("Selecciona una foto JPG, PNG o WEBP de hasta 10 MiB."); return;
    }
    const current = ++selection.current;
    await discard(); if (selection.current !== current) return;
    canvasRef.current = null; onReset(true); setRead(false); setError(""); setFile(next); setTurns(0); setCrop(FULL_GUIDE_CROP); setPrepared(null); setSourceUrl("");
  };
  const changeCrop = (index: number, x: number, y: number) => {
    setCrop((current) => current.map((point, i) => i === index ? { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : point) as GuideCrop);
    setPrepared(null); setAcceptQuality(false);
  };
  const preview = async () => {
    if (!canvasRef.current || working) return;
    setBusy(true); onBusy(true); setError(""); setStage("Preparando imagen…");
    try {
      // Let the spinner paint before the bounded pixel processing starts.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      setPrepared(await prepareGuideImage(canvasRef.current, crop, enhance)); setAcceptQuality(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo preparar la foto."); }
    finally { setBusy(false); onBusy(false); setStage(""); }
  };
  const extract = async (manual = false) => {
    if (!file || !prepared || working || (!manual && prepared.quality.warnings.length > 0 && !acceptQuality)) return;
    setBusy(true); onBusy(true); setError("");
    try {
      if (!captureRef.current) {
        setStage("Guardando foto original en DEV…");
        const target = await readResponse(await fetch(`${url}&action=prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, mimeType: file.type, size: file.size }) }));
        captureRef.current = target.captureId;
        const uploaded = await createClient().storage.from(target.bucket).uploadToSignedUrl(target.path, target.token, file, { contentType: file.type, upsert: false });
        if (uploaded.error) { await discard(); throw Error("No se pudo cargar la foto original. Intenta de nuevo."); }
      }
      setStage(manual ? "Preparando revisión manual…" : "Leyendo con Google Vision…");
      const data = new FormData(); data.set("captureId", captureRef.current!); data.set("image", prepared.file); data.set("manual", String(manual));
      data.set("adjustments", JSON.stringify({ turns, crop, enhance, quality: prepared.quality, parserVersion: "mixto-v1" }));
      const result = await readResponse(await fetch(url, { method: "POST", body: data })) as GuidePhotoResult;
      onRead(result); setRead(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo leer la guía."); }
    finally { setBusy(false); onBusy(false); setStage(""); }
  };
  return <section className="min-w-0 space-y-3 rounded-xl border border-border bg-muted/20 p-3 sm:p-4" aria-labelledby="guide-photo-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="guide-photo-heading" className="font-semibold">Fotografiar guía · DEV</h3><p className="mt-1 text-xs text-foreground-muted">Incluye todos los bordes y evita sombras. La foto original se conserva como evidencia al guardar.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={working} onClick={() => cameraInput.current?.click()}><Camera className="size-4" />Tomar foto</Button><Button variant="secondary" disabled={working} onClick={() => fileInput.current?.click()}><FileImage className="size-4" />Elegir foto</Button></div>
    </div>
    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Elegir foto de guía" disabled={working} onChange={(event) => { void selectFile(event.target.files?.[0]); event.target.value = ""; }} />
    <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" aria-label="Tomar foto de guía" disabled={working} onChange={(event) => { void selectFile(event.target.files?.[0]); event.target.value = ""; }} />
    {sourceUrl && !read && <>
      <p className="text-xs text-foreground-muted">Gira hasta que las letras queden derechas. Mueve las cuatro esquinas para incluir solo esta guía; puedes usar las flechas del teclado.</p>
      <div className="mx-auto max-w-lg">
        <div className="relative overflow-hidden rounded-lg border border-border bg-black" onPointerMove={(event) => {
          if (dragRef.current === null || working) return;
          const rect = event.currentTarget.getBoundingClientRect(); changeCrop(dragRef.current, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
        }} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
          {/* A local blob preview must keep its original aspect ratio. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sourceUrl} alt="Guía a recortar" className="block h-auto w-full select-none" draggable={false} />
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={crop.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} fill="rgba(255,255,255,0.08)" stroke={validGuideCrop(crop) ? "#22c55e" : "#ef4444"} strokeWidth="0.6" /></svg>
          {crop.map((p, i) => <button key={i} type="button" disabled={working} aria-label={`Esquina ${["superior izquierda", "superior derecha", "inferior derecha", "inferior izquierda"][i]}`}
            className="absolute z-10 grid size-10 touch-none -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-emerald-700 text-xs font-bold text-white shadow focus-visible:outline-2 focus-visible:outline-white"
            style={{ left: `clamp(20px, ${p.x * 100}%, calc(100% - 20px))`, top: `clamp(20px, ${p.y * 100}%, calc(100% - 20px))` }}
            onPointerDown={(event) => { event.preventDefault(); dragRef.current = i; event.currentTarget.parentElement?.setPointerCapture(event.pointerId); }}
            onKeyDown={(event) => { const moves: Record<string, [number, number]> = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] }; const move = moves[event.key]; if (move) { event.preventDefault(); changeCrop(i, p.x + move[0], p.y + move[1]); } }}>{i + 1}</button>)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={working} onClick={() => { canvasRef.current = null; setSourceUrl(""); setTurns((n) => n + 1); setCrop(FULL_GUIDE_CROP); setPrepared(null); }}><RotateCw className="size-4" />Girar 90°</Button><Button variant="secondary" disabled={working} onClick={() => { setCrop(FULL_GUIDE_CROP); setPrepared(null); }}>Restablecer recorte</Button><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={enhance} disabled={working} onChange={(event) => { setEnhance(event.target.checked); setPrepared(null); }} />Mejorar contraste suave</label></div>
      <Button variant="secondary" disabled={working || !validGuideCrop(crop)} onClick={() => void preview()}>Preparar lectura</Button>
    </>}
    {prepared && <details className="min-w-0 rounded-lg border border-border p-3" open={!read}>
      <summary className="cursor-pointer text-sm font-semibold">{read ? "Ver foto procesada y ampliar" : "Comprueba la foto que se leerá"}</summary>
      <a href={prepared.preview} target="_blank" rel="noreferrer" className="mt-2 block" aria-label="Ampliar foto procesada">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={prepared.preview} alt="Recorte de la guía, con perspectiva corregida" className="max-h-80 w-full object-contain" />
      </a>
    </details>}
    {prepared && !read && <>
      {prepared.quality.warnings.length > 0 && <div role="alert" className="space-y-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-950"><ul className="list-inside list-disc">{prepared.quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={acceptQuality} disabled={working} onChange={(event) => setAcceptQuality(event.target.checked)} />Revisé la foto y deseo continuar con esta calidad.</label></div>}
      <div className="flex flex-wrap gap-2"><Button disabled={working || (prepared.quality.warnings.length > 0 && !acceptQuality)} onClick={() => void extract()}><ScanLine className="size-4" />Extraer datos</Button><Button variant="secondary" disabled={working} onClick={() => void extract(true)}>Completar manualmente desde la foto</Button></div>
    </>}
    {stage && <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" />{stage}</p>}
    {read && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">Foto lista. Revisa y corrige los campos siguientes antes de guardar.</p>}
    {file && <Button variant="secondary" disabled={working} onClick={async () => {
      await discard(); canvasRef.current = null; setFile(null); setSourceUrl(""); setPrepared(null); setRead(false); setError(""); onReset(false);
    }}>Descartar foto y volver a formulario vacío</Button>}
    {error && <p role="alert" className="break-words rounded-lg bg-destructive-soft p-3 text-sm text-destructive">{error}</p>}
  </section>;
}
