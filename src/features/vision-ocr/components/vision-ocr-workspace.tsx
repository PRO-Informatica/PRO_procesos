"use client";

import { AlertTriangle, Check, Clipboard, FileImage, RotateCcw, ScanText, TableProperties, Upload, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { Button } from "@/components/ui/button";
import type { ParsedVisionDocument } from "@/features/vision-ocr/document-parser";
import type { ParsedDispatchGuideDocument } from "@/features/vision-ocr/document-parser";
import {
  analyzeVisionTemplate,
  VISION_TEMPLATE_LABELS,
  type LocalTemplateAnalysis,
  type VisionTemplateType,
} from "@/features/vision-ocr/template-classifier";
import {
  formatFileSize,
  isAllowedVisionImageType,
  VISION_OCR_ACCEPT,
  VISION_OCR_MAX_BYTES,
} from "@/features/vision-ocr/vision-ocr";

type OcrResponse = { success: true; text: string; templateType: VisionTemplateType; document: ParsedVisionDocument } | { success: false; error: string };

const FIELD_LABELS: Array<{ key: keyof Pick<ParsedDispatchGuideDocument, "customerName" | "projectName" | "workAddress" | "dispatchGuideNumber" | "orderNumber">; label: string }> = [
  { key: "customerName", label: "Nombre del cliente" },
  { key: "projectName", label: "Proyecto" },
  { key: "workAddress", label: "Dirección de obra" },
  { key: "dispatchGuideNumber", label: "Guía de despacho" },
  { key: "orderNumber", label: "No. de pedido" },
];

type DisplayField = { label: string; value: string | null; wide?: boolean };

function FieldsGrid({ fields }: { fields: DisplayField[] }) {
  return (
    <dl className="mt-2 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
      {fields.map(({ label, value, wide }) => (
        <div key={label} className={`min-w-0 bg-surface px-3 py-3 ${wide ? "sm:col-span-2" : ""}`}>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">{label}</dt>
          <dd className={`mt-1 whitespace-pre-wrap break-words text-sm font-semibold ${value ? "text-foreground" : "text-foreground-muted"}`}>
            {value ?? "No identificado"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DispatchGuideResult({ document }: { document: ParsedDispatchGuideDocument }) {
  return (
    <>
      <section aria-labelledby="guide-general-data">
        <h3 id="guide-general-data" className="text-xs font-semibold uppercase tracking-[.12em] text-foreground-muted">Datos generales</h3>
        <FieldsGrid fields={FIELD_LABELS.map(({ key, label }) => ({ label, value: document[key], wide: key === "workAddress" }))} />
      </section>
      <section aria-labelledby="guide-products">
        <div className="flex items-center justify-between gap-3">
          <h3 id="guide-products" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-foreground-muted">
            <TableProperties aria-hidden="true" className="size-4" /> Productos
          </h3>
          <span className="text-xs text-foreground-muted">{document.items.length} fila(s)</span>
        </div>
        {document.items.length ? (
          <>
            <div className="mt-2 hidden overflow-x-auto rounded-lg border border-border sm:block">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-foreground-muted">
                  <tr><th className="px-3 py-2.5">Cantidad</th><th className="px-3 py-2.5">UM</th><th className="px-3 py-2.5">Código producto</th><th className="px-3 py-2.5">Descripción</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {document.items.map((item, index) => (
                    <tr key={`${item.productCode}-${index}`}>
                      <td className="px-3 py-2.5 font-semibold">{item.quantity}</td><td className="px-3 py-2.5">{item.unit || "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs font-semibold">{item.productCode}</td><td className="px-3 py-2.5">{item.description || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border sm:hidden">
              {document.items.map((item, index) => (
                <article key={`${item.productCode}-${index}`} className="bg-surface p-3">
                  <div className="flex items-start justify-between gap-3"><strong className="font-mono text-xs">{item.productCode}</strong><span className="text-sm font-semibold">{item.quantity} {item.unit}</span></div>
                  <p className="mt-1 text-sm text-foreground-muted">{item.description || "Sin descripción identificada"}</p>
                </article>
              ))}
            </div>
          </>
        ) : <p className="mt-2 rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-foreground-muted">No se identificaron productos.</p>}
      </section>
    </>
  );
}

function OperationResult({ document }: { document: Exclude<ParsedVisionDocument, ParsedDispatchGuideDocument> }) {
  if (document.templateType === "MIXTO_OPERATION") {
    return (
      <section aria-labelledby="mixto-operation-data">
        <h3 id="mixto-operation-data" className="text-xs font-semibold uppercase tracking-[.12em] text-foreground-muted">Pedido / control operación</h3>
        <FieldsGrid fields={[
          { label: "Fecha", value: document.date }, { label: "Pedido por", value: document.orderedBy },
          { label: "Pedido No.", value: document.orderNumber }, { label: "No.", value: document.equipmentNumber },
          { label: "Tipo de concreto", value: document.concreteType }, { label: "Volumen estimado", value: document.estimatedVolume },
          { label: "Volumen real", value: document.realVolume },
          { label: "Curado por Mixto Listo", value: document.curedByMixto === null ? null : document.curedByMixto ? "Sí" : "No" },
        ]} />
      </section>
    );
  }
  return (
    <section aria-labelledby="panexus-operation-data">
      <h3 id="panexus-operation-data" className="text-xs font-semibold uppercase tracking-[.12em] text-foreground-muted">Pedido / control operación Panexus</h3>
      <FieldsGrid fields={[
        { label: "Fecha", value: document.date }, { label: "Código", value: document.code },
        { label: "Hora inicio bombeo", value: document.pumpingStartTime },
        { label: "Hora finalización bombeo", value: document.pumpingEndTime }, { label: "No.", value: document.equipmentNumber },
        { label: "Tipo de concreto", value: document.concreteType }, { label: "Volumen estimado", value: document.estimatedVolume },
        { label: "Volumen real", value: document.realVolume }, { label: "Observaciones", value: document.observations, wide: true },
      ]} />
    </section>
  );
}

export function VisionOcrWorkspace() {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const selectionSequenceRef = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [document, setDocument] = useState<ParsedVisionDocument | null>(null);
  const [templateAnalysis, setTemplateAnalysis] = useState<LocalTemplateAnalysis | null>(null);
  const [analyzingTemplate, setAnalyzingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const replacePreview = (next: File | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextUrl = next ? URL.createObjectURL(next) : null;
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
  };

  const selectFile = async (next: File | null) => {
    const selectionSequence = selectionSequenceRef.current + 1;
    selectionSequenceRef.current = selectionSequence;
    setText(null);
    setDocument(null);
    setTemplateAnalysis(null);
    setAnalyzingTemplate(false);
    setCopied(false);
    if (!next) {
      replacePreview(null);
      setFile(null);
      setError(null);
      return;
    }
    if (!next.size) {
      replacePreview(null);
      setError("La imagen está vacía.");
      setFile(null);
      return;
    }
    if (next.size > VISION_OCR_MAX_BYTES) {
      replacePreview(null);
      setError("La imagen supera el límite permitido de 7 MiB.");
      setFile(null);
      return;
    }
    if (!isAllowedVisionImageType(next.type)) {
      replacePreview(null);
      setError("Selecciona una imagen JPG, PNG o WEBP.");
      setFile(null);
      return;
    }
    setError(null);
    setFile(next);
    replacePreview(next);
    setAnalyzingTemplate(true);
    try {
      const analysis = await analyzeVisionTemplate(next);
      if (selectionSequenceRef.current === selectionSequence) setTemplateAnalysis(analysis);
    } catch {
      if (selectionSequenceRef.current === selectionSequence) {
        setError("No fue posible identificar localmente la plantilla de la imagen.");
      }
    } finally {
      if (selectionSequenceRef.current === selectionSequence) setAnalyzingTemplate(false);
    }
  };

  const clear = () => {
    selectionSequenceRef.current += 1;
    replacePreview(null);
    setFile(null);
    setText(null);
    setDocument(null);
    setTemplateAnalysis(null);
    setAnalyzingTemplate(false);
    setError(null);
    setCopied(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const submit = async () => {
    if (!file || !templateAnalysis || pending) return;
    setPending(true);
    setError(null);
    setText(null);
    try {
      const formData = new FormData();
      formData.set("image", file);
      formData.set("templateType", templateAnalysis.templateType);
      formData.set("mixtoCuredBySupplier", templateAnalysis.mixtoCuredBySupplier === null ? "unknown" : String(templateAnalysis.mixtoCuredBySupplier));
      const response = await fetch("/api/vision-ocr", { method: "POST", body: formData });
      const payload = await response.json() as OcrResponse;
      if (!response.ok || !payload.success) {
        setError(payload.success ? "No fue posible extraer el texto." : payload.error);
        return;
      }
      setText(payload.text);
      setDocument(payload.document);
      setTemplateAnalysis((current) => current ? { ...current, templateType: payload.templateType } : current);
    } catch {
      setError("No fue posible conectar con el servicio OCR. Intenta nuevamente.");
    } finally {
      setPending(false);
    }
  };

  const copyText = async () => {
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("No fue posible copiar el texto automáticamente.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-brand-strong">Herramienta interna · DEV</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">Prueba Google Vision OCR</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
          Selecciona una guía o control de operación. La plantilla se identifica localmente antes de ejecutar DOCUMENT_TEXT_DETECTION; el resultado es una ayuda de revisión y no se guarda.
        </p>
      </header>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <h2 className="flex items-center gap-2 font-semibold"><FileImage aria-hidden="true" className="size-4 text-brand-strong" />Imagen</h2>
            <p className="mt-1 text-xs text-foreground-muted">JPG, PNG o WEBP · máximo 7 MiB</p>
          </div>
          <div className="p-4 sm:p-5">
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept={VISION_OCR_ACCEPT}
              className="sr-only"
              disabled={pending}
              onChange={(event) => void selectFile(event.target.files?.[0] ?? null)}
            />

            {file && previewUrl ? (
              <div className="space-y-4">
                <div className="relative flex min-h-72 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/30 p-3">
                  <Image src={previewUrl} alt={`Vista previa de ${file.name}`} width={1200} height={900} unoptimized className="max-h-[30rem] w-auto max-w-full object-contain" />
                </div>
                <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-muted/25 p-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong"><FileImage aria-hidden="true" className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" title={file.name}>{file.name}</p>
                    <p className="mt-0.5 text-xs text-foreground-muted">{formatFileSize(file.size)} · {file.type}</p>
                  </div>
                  <button type="button" className="icon-button" aria-label="Quitar imagen" disabled={pending} onClick={clear}><X aria-hidden="true" className="size-4" /></button>
                </div>
                <div className="rounded-lg border border-border bg-muted/25 px-3 py-2 text-xs" aria-live="polite">
                  {analyzingTemplate ? (
                    <span className="text-foreground-muted">Identificando plantilla localmente…</span>
                  ) : templateAnalysis ? (
                    <><span className="font-semibold text-foreground">Plantilla detectada:</span> <span className="text-foreground-muted">{VISION_TEMPLATE_LABELS[templateAnalysis.templateType]}</span></>
                  ) : null}
                </div>
              </div>
            ) : (
              <label
                htmlFor={inputId}
                onDragEnter={(event) => { event.preventDefault(); if (!pending) setDragActive(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  if (!pending) void selectFile(event.dataTransfer.files?.[0] ?? null);
                }}
                className={`flex min-h-72 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-5 text-center transition-colors ${dragActive ? "border-brand bg-brand-soft/55" : "border-border bg-muted/20 hover:border-brand/45 hover:bg-brand-soft/25"}`}
              >
                <span className="grid size-12 place-items-center rounded-xl bg-brand-soft text-brand-strong"><Upload aria-hidden="true" className="size-6" /></span>
                <strong className="mt-4 text-sm">Selecciona o arrastra una imagen</strong>
                <span className="mt-1 text-xs text-foreground-muted">El archivo se enviará únicamente cuando presiones “Extraer texto”.</span>
              </label>
            )}

            {error && <p role="alert" className="mt-4 rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive">{error}</p>}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <LoadingButton type="button" loading={pending || analyzingTemplate} loadingLabel={analyzingTemplate ? "Identificando..." : "Procesando..."} disabled={!file || !templateAnalysis} onClick={() => void submit()} className="w-full sm:w-auto">
                <ScanText aria-hidden="true" className="size-4" /> Extraer texto
              </LoadingButton>
              <Button type="button" variant="secondary" disabled={pending || (!file && text === null && !error)} onClick={clear} className="w-full sm:w-auto">
                <RotateCcw aria-hidden="true" className="size-4" /> Limpiar
              </Button>
            </div>
          </div>
        </section>

        <section className="flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
            <div>
              <h2 className="font-semibold">Datos identificados</h2>
              <p className="mt-1 text-xs text-foreground-muted">Información ordenada según la plantilla detectada.</p>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 p-4 sm:p-5">
            {text === null || document === null ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 text-center">
                <ScanText aria-hidden="true" className="size-8 text-foreground-muted" />
                <p className="mt-3 text-sm font-semibold">Aún no hay un resultado</p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-foreground-muted">Selecciona una imagen y ejecuta el OCR para organizar los datos según su plantilla.</p>
              </div>
            ) : (
              <div className="min-w-0 flex-1 space-y-5">
                <div className="flex gap-3 rounded-lg border border-warning/25 bg-warning-soft px-4 py-3 text-sm">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
                  <p><strong>Revisión requerida.</strong> Compara los valores con la imagen; el OCR puede confundir caracteres o escritura manual.</p>
                </div>

                {document.warnings.length > 0 && (
                  <ul className="space-y-1 rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive" aria-label="Advertencias de extracción">
                    {document.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                )}

                {document.templateType === "DISPATCH_GUIDE"
                  ? <DispatchGuideResult document={document} />
                  : <OperationResult document={document} />}

                <details className="group overflow-hidden rounded-lg border border-border">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                    Ver texto original de Google Vision
                  </summary>
                  <div className="border-t border-border p-3">
                    <div className="mb-2 flex justify-end">
                      <Button type="button" variant="ghost" onClick={() => void copyText()} className="shrink-0">
                        {copied ? <Check aria-hidden="true" className="size-4 text-success" /> : <Clipboard aria-hidden="true" className="size-4" />}
                        {copied ? "Copiado" : "Copiar texto"}
                      </Button>
                    </div>
                    <textarea aria-label="Texto original detectado por Google Vision" readOnly value={text} className="form-input min-h-64 resize-y whitespace-pre-wrap font-mono text-xs leading-5" />
                  </div>
                </details>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
