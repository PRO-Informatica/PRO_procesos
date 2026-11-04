"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GUIDE_FIELDS, type GuideDetails, type GuideField, type GuideOcrDraft } from "../guide-draft";
import { guideCaptureUrl } from "./guide-photo-capture";
import type { DispatchCatalogOption } from "@/features/dispatches/types";
import { formatDispatchMoney } from "@/features/dispatches/formatters";

// Commercial observations belong to selection options only. They never become
// the guide description or the guide's own handwritten observations field.
export function GuideOcrVariants({ items, disabled, onSelect }: { items: DispatchCatalogOption[]; disabled: boolean; onSelect: (item: DispatchCatalogOption) => void }) {
  if (items.length < 2) return null;
  return <div className="space-y-2" aria-label="Variantes del catálogo">{items.map((item) => <button type="button" key={item.id} disabled={disabled} className="block min-h-11 w-full rounded-lg border border-amber-300 bg-surface p-3 text-left text-sm text-foreground" onClick={() => onSelect(item)}>{item.code} · {item.description || item.reference} · {item.observations || "Sin observaciones"} · {item.unitCode || "Sin UM"} · {formatDispatchMoney(item.price, item.currency)}</button>)}</div>;
}

export function GuideOcrDetails({ value, onChange, disabled, draft }: {
  value: GuideDetails; onChange: (key: GuideField, value: string) => void; disabled: boolean; draft: GuideOcrDraft;
}) {
  return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-border p-3 sm:p-4">
    <legend className="px-2 font-semibold">Datos de la fotografía</legend>
    <p className="text-xs text-foreground-muted">Compara con la foto. El pedido no restringe la asociación; valida proyecto y dirección.</p>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      {(Object.entries(GUIDE_FIELDS) as [GuideField, string][]).filter(([key]) => key !== "guideDate").map(([key, label]) => {
        const score = draft.confidence[key];
        const uncertain = score !== undefined && (score === null || score < 0.8);
        return <div key={key} className={`min-w-0 ${["workAddress", "observations"].includes(key) ? "sm:col-span-2" : ""}`}>
          <label className="form-label" htmlFor={`ocr-${key}`}>{label}{["projectName", "workAddress"].includes(key) ? " *" : ""}{uncertain && <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">Revisar lectura</span>}</label>
          <textarea id={`ocr-${key}`} rows={key === "observations" ? 3 : key === "workAddress" ? 2 : 1} required={["projectName", "workAddress"].includes(key)} maxLength={key === "observations" ? 4000 : 500}
            value={value[key]} onChange={(event) => onChange(key, event.target.value)} className={`form-input min-w-0 resize-y ${uncertain ? "border-amber-400" : ""}`} />
        </div>;
      })}
    </div>
    <p className="text-xs text-foreground-muted">Horas leídas: carga «{draft.rawTimes.loading || "Sin lectura"}» · llegada «{draft.rawTimes.arrival || "Sin lectura"}» · salida «{draft.rawTimes.departure || "Sin lectura"}». Se aceptan 6 pm y 15:10; confirma las horas en los campos del camión.</p>
  </fieldset>;
}

export function SavedGuideOcrDetails({ projectId, dispatchId, guideId }: { projectId: string; dispatchId: string; guideId: string }) {
  const router = useRouter();
  const [result, setResult] = useState<{ captureId: string; canRetry: boolean; details?: GuideDetails; originalUrl?: string; rawText?: string } | null>(null);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${guideCaptureUrl(projectId, dispatchId)}&guideId=${encodeURIComponent(guideId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw Error(data.error); setResult(data.capture); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo cargar la lectura de la foto."); });
    return () => controller.abort();
  }, [projectId, dispatchId, guideId]);
  if (!result) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null;
  return <details className="min-w-0 rounded-xl border border-border p-4"><summary className="cursor-pointer font-semibold">Datos originales de la captura revisada</summary>
    {result.originalUrl && <a className="mt-3 block text-sm text-brand-strong underline" href={result.originalUrl} target="_blank" rel="noreferrer">Abrir foto original y ampliar</a>}
    {result.canRetry && <button type="button" disabled={retrying} className="secondary-button mt-3 min-h-11" onClick={async () => {
      setRetrying(true); setError("");
      try {
        const response = await fetch(guideCaptureUrl(projectId, dispatchId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ captureId: result.captureId, expectedVersion: 1, reviewed: true }) });
        const data = await response.json(); if (!response.ok) throw Error(data.error || "No se pudo adjuntar la foto.");
        setResult((current) => current ? { ...current, canRetry: false } : current); router.refresh();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo adjuntar la foto."); }
      finally { setRetrying(false); }
    }}>{retrying ? "Adjuntando…" : "Reintentar foto pendiente"}</button>}
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{Object.entries(GUIDE_FIELDS).map(([key, label]) => <div className="min-w-0" key={key}><dt className="text-foreground-muted">{label}</dt><dd className="break-words whitespace-pre-wrap">{result.details?.[key as GuideField] || "Sin dato"}</dd></div>)}</dl>
    {result.rawText && <details className="mt-3"><summary className="cursor-pointer text-sm">Texto extraído por Vision</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{result.rawText}</pre></details>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </details>;
}
